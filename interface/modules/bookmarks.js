import { api, bus } from './api.js';
import { h, clear, newId, toast, reportError, confirmDialog, promptDialog, formDialog, emptyState } from './ui.js';
import { icon } from './icons.js';

export const ROOT_FOLDER = 'root';
export const PINNED_FOLDER = 'pinned';

let data = { version: 1, folders: [], items: [] };
let readError = new Error('Bookmarks have not been loaded. Writes are blocked.');
let operations = Promise.resolve();

function serialize(operation) {
  const result = operations.then(operation);
  // Keep the queue usable after a failure without hiding it from the caller.
  operations = result.catch(() => {});
  return result;
}

function validateDocument(stored) {
  if (stored === null) return { version: 1, folders: [], items: [] };
  const invalid = () => new Error('The bookmarks document is damaged or unsupported. Writes are blocked to protect it.');
  if (!stored || (stored.version !== undefined && stored.version !== 1)
    || !Array.isArray(stored.folders) || !Array.isArray(stored.items)) throw invalid();

  const folderIds = new Set([ROOT_FOLDER, PINNED_FOLDER]);
  const folders = stored.folders.map((folder) => {
    if (!folder || typeof folder.id !== 'string' || !folder.id || folderIds.has(folder.id)
      || typeof folder.name !== 'string') throw invalid();
    folderIds.add(folder.id);
    return { ...folder };
  });
  const itemIds = new Set();
  const items = stored.items.map((item) => {
    const url = safeUrl(item?.url);
    if (!item || typeof item.id !== 'string' || !item.id || itemIds.has(item.id)
      || typeof item.title !== 'string' || !url
      || (item.folderId !== undefined && typeof item.folderId !== 'string')
      || (item.pinned !== undefined && typeof item.pinned !== 'boolean')
      || (item.createdAt !== undefined && (typeof item.createdAt !== 'string' || !Number.isFinite(Date.parse(item.createdAt))))) throw invalid();
    itemIds.add(item.id);
    return {
      ...item, url,
      folderId: item.folderId !== PINNED_FOLDER && folderIds.has(item.folderId) ? item.folderId : ROOT_FOLDER,
      pinned: item.pinned ?? false,
    };
  });
  return { version: 1, folders, items };
}

export async function loadBookmarks() {
  // Reads share the mutation queue, so a reload cannot replace an in-flight save.
  return serialize(async () => {
    try {
      const next = validateDocument(await api.readDocument('bookmarks'));
      data = next;
      readError = null;
      return structuredClone(data);
    } catch (error) {
      readError = error;
      throw error;
    }
  });
}

function mutate(operation) {
  return serialize(() => {
    if (readError) throw readError;
    return operation(structuredClone(data));
  });
}

async function persist(next) {
  await api.writeDocument('bookmarks', next);
  data = next;
  bus.dispatchEvent(new Event('bookmarks-changed'));
}

export function listFolders() {
  return [...data.folders].sort((a, b) => a.name.localeCompare(b.name));
}

export function folderName(id) {
  if (id === ROOT_FOLDER) return 'All bookmarks';
  if (id === PINNED_FOLDER) return 'Pinned';
  return data.folders.find((folder) => folder.id === id)?.name ?? 'All bookmarks';
}

export function listItems(folderId = ROOT_FOLDER, query = '') {
  const needle = query.trim().toLowerCase();
  return data.items
    .filter((item) => folderId === ROOT_FOLDER || (folderId === PINNED_FOLDER ? item.pinned : item.folderId === folderId))
    .filter((item) => !needle || item.title.toLowerCase().includes(needle) || item.url.toLowerCase().includes(needle))
    .sort((a, b) => a.title.localeCompare(b.title));
}

export function pinnedItems(limit = 8) {
  return data.items.filter((item) => item.pinned).slice(0, limit);
}

export function countItems() {
  return data.items.length;
}

export async function addItem({ title, url, folderId = ROOT_FOLDER }) {
  return mutate(async (next) => {
    const address = safeUrl(url);
    if (!address) throw new Error('Only HTTP and HTTPS bookmarks are supported.');
    const existing = next.items.find((item) => item.url === address);
    if (existing) return existing;
    const item = { id: newId(), title: title || address, url: address, folderId, pinned: false, createdAt: new Date().toISOString() };
    next.items.push(item);
    await persist(next);
    render();
    return item;
  });
}

export async function updateItem(id, patch) {
  return mutate(async (next) => {
    const item = next.items.find((entry) => entry.id === id);
    if (!item) return null;
    Object.assign(item, patch);
    await persist(next);
    return item;
  });
}

export async function deleteItem(id) {
  return mutate(async (next) => {
    next.items = next.items.filter((item) => item.id !== id);
    await persist(next);
  });
}

export async function addFolder(name) {
  return mutate(async (next) => {
    const folder = { id: newId(), name };
    next.folders.push(folder);
    await persist(next);
    return folder;
  });
}

export async function renameFolder(id, name) {
  return mutate(async (next) => {
    const folder = next.folders.find((entry) => entry.id === id);
    if (!folder) return;
    folder.name = name;
    await persist(next);
  });
}

export async function deleteFolder(id) {
  return mutate(async (next) => {
    next.folders = next.folders.filter((folder) => folder.id !== id);
    next.items.forEach((item) => { if (item.folderId === id) item.folderId = ROOT_FOLDER; });
    await persist(next);
  });
}

export function exportJson() {
  return JSON.stringify({ application: 'Surge Portable', version: 1, exportedAt: new Date().toISOString(), ...data }, null, 2);
}

export async function importJson(text) {
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed?.items)) throw new Error('That file does not contain Surge bookmarks.');
  return mutate(async (next) => {
    const folders = Array.isArray(parsed.folders) ? parsed.folders : [];
    const folderIds = new Set([ROOT_FOLDER, ...next.folders.map((folder) => folder.id)]);
    let added = 0;
    for (const folder of folders) {
      if (typeof folder?.id !== 'string' || !folder.id || folder.id === PINNED_FOLDER || folderIds.has(folder.id)) continue;
      next.folders.push({ id: folder.id, name: String(folder.name ?? 'Folder') });
      folderIds.add(folder.id);
    }
    for (const item of parsed.items) {
      const url = safeUrl(item?.url);
      if (!url || next.items.some((existing) => existing.url === url)) continue;
      next.items.push({ id: newId(), title: String(item.title ?? url), url,
        folderId: folderIds.has(item.folderId) ? item.folderId : ROOT_FOLDER,
        pinned: Boolean(item.pinned), createdAt: new Date().toISOString() });
      added += 1;
    }
    await persist(next);
    return added;
  });
}

/// Netscape bookmark format: the same HTML file Firefox exports and imports.
export function exportHtml() {
  const doc = document.implementation.createHTMLDocument('Bookmarks');
  const root = doc.createElement('DL');
  const container = doc.createElement('p');
  root.append(container);

  const appendItem = (parent, item) => {
    const dt = doc.createElement('DT');
    const anchor = doc.createElement('A');
    anchor.setAttribute('HREF', item.url);
    anchor.setAttribute('ADD_DATE', String(Math.floor(new Date(item.createdAt ?? Date.now()).getTime() / 1000)));
    anchor.textContent = item.title;
    dt.append(anchor);
    parent.append(dt);
  };

  for (const item of data.items.filter((entry) => entry.folderId === ROOT_FOLDER)) appendItem(container, item);

  for (const folder of data.folders) {
    const dt = doc.createElement('DT');
    const heading = doc.createElement('H3');
    heading.textContent = folder.name;
    dt.append(heading);
    const list = doc.createElement('DL');
    const inner = doc.createElement('p');
    list.append(inner);
    for (const item of data.items.filter((entry) => entry.folderId === folder.id)) appendItem(inner, item);
    dt.append(list);
    container.append(dt);
  }

  doc.body.append(doc.createElement('H1')).textContent = 'Bookmarks';
  doc.body.append(root);
  return `<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<!-- Surge Portable bookmark export. Import this file in Firefox: Bookmarks > Manage Bookmarks > Import and Backup > Import Bookmarks from HTML. -->\n${doc.documentElement.outerHTML}`;
}

export async function importHtml(text) {
  const doc = new DOMParser().parseFromString(text, 'text/html');
  return mutate(async (data) => {
  let added = 0;

  const walk = (list, folderId) => {
    for (const node of Array.from(list.children)) {
      if (node.tagName === 'P') {
        walk(node, folderId);
        continue;
      }
      if (node.tagName !== 'DT') continue;

      const heading = node.querySelector(':scope > H3');
      const anchor = node.querySelector(':scope > A');
      if (heading) {
        const name = heading.textContent.trim() || 'Folder';
        let folder = data.folders.find((entry) => entry.name === name);
        if (!folder) {
          folder = { id: newId(), name };
          data.folders.push(folder);
        }
        const nested = node.querySelector(':scope > DL');
        if (nested) walk(nested, folder.id);
      } else if (anchor) {
        const url = safeUrl(anchor.getAttribute('HREF'));
        if (!url || data.items.some((existing) => existing.url === url)) continue;
        data.items.push({
          id: newId(),
          title: anchor.textContent.trim() || url,
          url,
          folderId,
          pinned: false,
          createdAt: new Date().toISOString(),
        });
        added += 1;
      }
    }
  };

  const top = doc.querySelector('DL');
  if (!top) throw new Error('That file does not look like a bookmark export.');
  walk(top, ROOT_FOLDER);
  await persist();
  return added;
}

export function safeUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

export function downloadFile(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

let container = null;
let activeFolder = ROOT_FOLDER;
let query = '';

function folderOptions() {
  return [{ value: ROOT_FOLDER, label: 'All bookmarks' }, ...listFolders().map((folder) => ({ value: folder.id, label: folder.name }))];
}

async function addOrEdit(item = null) {
  const values = await formDialog({
    title: item ? 'Edit bookmark' : 'Add bookmark',
    confirmLabel: item ? 'Save' : 'Add',
    fields: [
      { name: 'title', label: 'Name', value: item?.title ?? '', required: true, placeholder: 'Example mail' },
      { name: 'url', label: 'Address', value: item?.url ?? '', required: true, placeholder: 'https://example.org', hint: 'Only http and https addresses are stored.' },
      { name: 'folderId', label: 'Folder', type: 'select', value: item?.folderId ?? activeFolder, options: folderOptions() },
    ],
  });
  if (!values) return;

  const url = safeUrl(values.url);
  if (!url) {
    toast('That address is not a valid http or https link.', 'error');
    return;
  }
  try {
    if (item) await updateItem(item.id, { title: values.title, url, folderId: values.folderId });
    else await addItem({ title: values.title, url, folderId: values.folderId });
    toast(item ? 'Bookmark updated.' : 'Bookmark added.');
    render();
  } catch (error) {
    reportError(error);
  }
}

async function removeItem(item) {
  const ok = await confirmDialog({
    title: 'Delete bookmark?',
    message: `"${item.title}" will be removed from the Surge bookmark panel. Firefox's own bookmarks are not changed.`,
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!ok) return;
  try {
    await deleteItem(item.id);
    toast('Bookmark deleted.');
    render();
  } catch (error) {
    reportError(error);
  }
}

async function manageFolder(action) {
  const folder = listFolders().find((entry) => entry.id === activeFolder);
  if (!folder) return;
  if (action === 'rename') {
    const name = await promptDialog({ title: 'Rename folder', label: 'Folder name', value: folder.name, confirmLabel: 'Rename' });
    if (!name) return;
    await renameFolder(folder.id, name);
  } else {
    const ok = await confirmDialog({
      title: 'Delete folder?',
      message: `${folder.name} will be removed. Its bookmarks move to All bookmarks.`,
      confirmLabel: 'Delete folder',
      danger: true,
    });
    if (!ok) return;
    await deleteFolder(folder.id);
    activeFolder = ROOT_FOLDER;
  }
  render();
}

function importPicker() {
  const input = h('input', {
    type: 'file', accept: '.json,.html,.htm', hidden: true,
    onChange: async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const added = file.name.toLowerCase().endsWith('.json') || text.trimStart().startsWith('{')
          ? await importJson(text)
          : await importHtml(text);
        toast(`Imported ${added} bookmark${added === 1 ? '' : 's'}.`);
        render();
      } catch (error) {
        reportError(error);
      }
      input.value = '';
    },
  });
  return input;
}

function renderCards() {
  const grid = container?.querySelector('#bookmark-grid');
  const summary = container?.querySelector('#bookmark-summary');
  if (!grid) return;
  clear(grid);

  const items = listItems(activeFolder, query);
  for (const item of items) {
    grid.append(h('article', { class: 'bookmark-card' },
      h('a', { class: 'bookmark-title', href: item.url, target: '_blank', rel: 'noopener noreferrer', text: item.title }),
      h('span', { class: 'bookmark-url', text: item.url }),
      h('span', { class: 'bookmark-folder', text: folderName(item.folderId) }),
      h('div', { class: 'cell-actions' },
        h('button', {
          class: item.pinned ? 'btn btn-small btn-primary' : 'btn btn-small', type: 'button',
          'aria-pressed': item.pinned ? 'true' : 'false',
          onClick: async () => { await updateItem(item.id, { pinned: !item.pinned }); renderCards(); },
        }, icon('star', 15), item.pinned ? 'Pinned' : 'Pin'),
        h('button', { class: 'btn btn-small btn-icon', type: 'button', 'aria-label': `Edit ${item.title}`, onClick: () => addOrEdit(item) }, icon('pencil', 15)),
        h('button', { class: 'btn btn-small btn-icon btn-danger', type: 'button', 'aria-label': `Delete ${item.title}`, onClick: () => removeItem(item) }, icon('trash', 15)))));
  }

  if (!items.length) {
    grid.append(emptyState(query ? 'No bookmarks match that search.' : 'No bookmarks here yet. Add one, or import your Firefox bookmarks.'));
  }
  if (summary) summary.textContent = `${items.length} bookmark${items.length === 1 ? '' : 's'} • ${countItems()} total`;
}

function folderRail() {
  const rail = h('nav', { class: 'folder-rail', 'aria-label': 'Bookmark folders' });
  const entry = (id, label) => h('button', {
    class: `nav-item${activeFolder === id ? ' active' : ''}`, type: 'button',
    'aria-current': activeFolder === id ? 'page' : null,
    onClick: () => { activeFolder = id; render(); },
  }, icon(id === PINNED_FOLDER ? 'star' : 'files', 16), h('span', { text: label }));

  rail.append(entry(ROOT_FOLDER, 'All'), entry(PINNED_FOLDER, 'Pinned'));
  for (const folder of listFolders()) rail.append(entry(folder.id, folder.name));

  rail.append(h('button', {
    class: 'btn', type: 'button',
    onClick: async () => {
      const name = await promptDialog({ title: 'New folder', label: 'Folder name', confirmLabel: 'Create' });
      if (!name) return;
      try {
        const folder = await addFolder(name);
        activeFolder = folder.id;
        render();
      } catch (error) {
        reportError(error);
      }
    },
  }, icon('plus', 16), 'Folder'));

  if (activeFolder !== ROOT_FOLDER && activeFolder !== PINNED_FOLDER) {
    rail.append(
      h('button', { class: 'btn btn-small', type: 'button', onClick: () => manageFolder('rename') }, icon('pencil', 15), 'Rename'),
      h('button', { class: 'btn btn-small btn-danger', type: 'button', onClick: () => manageFolder('delete') }, icon('trash', 15), 'Delete folder'));
  }
  return rail;
}

function render() {
  clear(container);
  const picker = importPicker();

  container.append(
    h('header', { class: 'section-head' },
      h('div', {}, h('h1', { text: 'Bookmarks' }),
        h('p', { class: 'section-sub', text: 'Opens in Firefox. Firefox keeps its own bookmarks as the browser’s source of truth.' })),
      h('div', { class: 'section-actions' },
        h('button', { class: 'btn', type: 'button', onClick: () => picker.click() }, icon('import', 16), 'Import'),
        h('button', { class: 'btn', type: 'button', onClick: () => downloadFile('surge-bookmarks.json', exportJson(), 'application/json') }, icon('export', 16), 'Export'),
        h('button', { class: 'btn', type: 'button', onClick: () => downloadFile('surge-bookmarks.html', exportHtml(), 'text/html') }, icon('open', 16), 'For Firefox'),
        h('button', { class: 'btn btn-primary', type: 'button', onClick: () => addOrEdit() }, icon('plus', 16), 'Add bookmark'))),
    picker,
    h('div', { class: 'bookmarks-layout' },
      folderRail(),
      h('div', { class: 'stack' },
        h('input', {
          class: 'input', type: 'search', placeholder: 'Search bookmarks', value: query, 'aria-label': 'Search bookmarks',
          onInput: (event) => { query = event.target.value; renderCards(); },
        }),
        h('div', { class: 'bookmark-grid', id: 'bookmark-grid' }),
        h('p', { class: 'table-summary', id: 'bookmark-summary' }))),
    h('p', { class: 'hint', text: 'Export for Firefox writes a Netscape HTML file that Firefox can import (Bookmarks ▸ Manage Bookmarks ▸ Import and Backup). Import accepts that same HTML format or a Surge JSON export. Surge never edits Firefox’s live bookmark database.' }));

  renderCards();
}

export async function mount(target) {
  container = target;
  render();
}