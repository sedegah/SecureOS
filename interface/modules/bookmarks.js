import { api, bus } from './api.js';
import { h, clear, newId, toast, reportError, confirmDialog, promptDialog, formDialog, emptyState } from './ui.js';
import { icon } from './icons.js';

export const ROOT_FOLDER = 'root';

let data = { version: 1, folders: [], items: [] };

export async function loadBookmarks() {
  const stored = await api.readDocument('bookmarks');
  data = {
    version: 1,
    folders: Array.isArray(stored?.folders) ? stored.folders : [],
    items: Array.isArray(stored?.items) ? stored.items : [],
  };
  return data;
}

async function persist() {
  await api.writeDocument('bookmarks', data);
  bus.dispatchEvent(new Event('bookmarks-changed'));
}

export function listFolders() {
  return [...data.folders].sort((a, b) => a.name.localeCompare(b.name));
}

export function folderName(id) {
  if (id === ROOT_FOLDER) return 'All bookmarks';
  return data.folders.find((folder) => folder.id === id)?.name ?? 'All bookmarks';
}

export function listItems(folderId = ROOT_FOLDER, query = '') {
  const needle = query.trim().toLowerCase();
  return data.items
    .filter((item) => folderId === ROOT_FOLDER || item.folderId === folderId)
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
  const item = {
    id: newId(),
    title: title || url,
    url,
    folderId: folderId === ROOT_FOLDER ? ROOT_FOLDER : folderId,
    pinned: false,
    createdAt: new Date().toISOString(),
  };
  data.items.push(item);
  await persist();
  return item;
}

export async function updateItem(id, patch) {
  const item = data.items.find((entry) => entry.id === id);
  if (!item) return null;
  Object.assign(item, patch);
  await persist();
  return item;
}

export async function deleteItem(id) {
  data.items = data.items.filter((item) => item.id !== id);
  await persist();
}

export async function addFolder(name) {
  const folder = { id: newId(), name };
  data.folders.push(folder);
  await persist();
  return folder;
}

export async function renameFolder(id, name) {
  const folder = data.folders.find((entry) => entry.id === id);
  if (!folder) return;
  folder.name = name;
  await persist();
}

export async function deleteFolder(id) {
  data.folders = data.folders.filter((folder) => folder.id !== id);
  data.items.forEach((item) => {
    if (item.folderId === id) item.folderId = ROOT_FOLDER;
  });
  await persist();
}

export function exportJson() {
  return JSON.stringify({ application: 'Surge Portable', version: 1, exportedAt: new Date().toISOString(), ...data }, null, 2);
}

export async function importJson(text) {
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed?.items)) throw new Error('That file does not contain Surge bookmarks.');
  const folders = Array.isArray(parsed.folders) ? parsed.folders : [];
  const folderIds = new Set(folders.map((folder) => folder.id));
  let added = 0;

  for (const folder of folders) {
    if (!data.folders.some((existing) => existing.id === folder.id)) data.folders.push({ id: folder.id, name: String(folder.name ?? 'Folder') });
  }
  for (const item of parsed.items) {
    const url = safeUrl(item.url);
    if (!url) continue;
    if (data.items.some((existing) => existing.url === url)) continue;
    data.items.push({
      id: newId(),
      title: String(item.title ?? url),
      url,
      folderId: folderIds.has(item.folderId) ? item.folderId : ROOT_FOLDER,
      pinned: Boolean(item.pinned),
      createdAt: item.createdAt ?? new Date().toISOString(),
    });
    added += 1;
  }
  await persist();
  return added;
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

function renderRows() {
  const body = container?.querySelector('#bookmark-rows');
  const summary = container?.querySelector('#bookmark-summary');
  if (!body) return;
  clear(body);

  const items = listItems(activeFolder, query);
  for (const item of items) {
    body.append(h('tr', { class: 'row' },
      h('td', { class: 'cell-name' }, icon('bookmarks', 16),
        h('a', { href: item.url, target: '_blank', rel: 'noopener noreferrer', text: item.title })),
      h('td', { class: 'cell-url', text: item.url }),
      h('td', { class: 'cell-type', text: folderName(item.folderId) }),
      h('td', { class: 'cell-actions' },
        h('button', {
          class: item.pinned ? 'btn btn-small btn-primary' : 'btn btn-small', type: 'button',
          'aria-pressed': item.pinned ? 'true' : 'false',
          title: item.pinned ? 'Remove from homepage shortcuts' : 'Show on homepage',
          onClick: async () => { await updateItem(item.id, { pinned: !item.pinned }); renderRows(); },
        }, icon('star', 15), item.pinned ? 'Pinned' : 'Pin'),
        h('button', { class: 'btn btn-small', type: 'button', onClick: () => addOrEdit(item) }, icon('pencil', 15), 'Edit'),
        h('button', { class: 'btn btn-small btn-danger', type: 'button', onClick: () => removeItem(item) }, icon('trash', 15), 'Delete'))));
  }

  if (!items.length) {
    body.append(h('tr', {}, h('td', { colspan: '4' }, emptyState(query ? 'No bookmarks match that search.' : 'No bookmarks yet. Add one, or import your Firefox bookmarks.'))));
  }
  if (summary) summary.textContent = `${items.length} bookmark${items.length === 1 ? '' : 's'} • ${countItems()} total`;
}

function render() {
  clear(container);
  const picker = importPicker();

  container.append(
    h('header', { class: 'section-head' },
      h('div', {}, h('h1', { text: 'Bookmarks' }),
        h('p', { class: 'section-sub', text: 'Your Surge shortcut panel. Firefox keeps its own bookmarks as the browser’s source of truth.' })),
      h('div', { class: 'toolbar-actions' },
        h('button', { class: 'btn btn-primary', type: 'button', onClick: () => addOrEdit() }, icon('plus'), 'Add bookmark'),
        h('button', {
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
        }, icon('files'), 'New folder'))),
    h('div', { class: 'toolbar' },
      h('input', {
        class: 'input input-inline', type: 'search', placeholder: 'Search bookmarks', value: query, 'aria-label': 'Search bookmarks',
        onInput: (event) => { query = event.target.value; renderRows(); },
      }),
      h('select', {
        class: 'input input-inline', 'aria-label': 'Bookmark folder',
        onChange: (event) => { activeFolder = event.target.value; render(); },
      }, folderOptions().map((option) => h('option', { value: option.value, selected: option.value === activeFolder }, option.label))),
      activeFolder !== ROOT_FOLDER
        ? h('div', { class: 'toolbar-actions' },
          h('button', { class: 'btn btn-small', type: 'button', onClick: () => manageFolder('rename') }, icon('pencil', 15), 'Rename folder'),
          h('button', { class: 'btn btn-small btn-danger', type: 'button', onClick: () => manageFolder('delete') }, icon('trash', 15), 'Delete folder'))
        : null,
      h('div', { class: 'toolbar-actions' },
        h('button', { class: 'btn btn-small', type: 'button', onClick: () => picker.click() }, icon('up'), 'Import'),
        h('button', { class: 'btn btn-small', type: 'button', onClick: () => downloadFile('surge-bookmarks.json', exportJson(), 'application/json') }, icon('downloads'), 'Export JSON'),
        h('button', { class: 'btn btn-small', type: 'button', onClick: () => downloadFile('surge-bookmarks.html', exportHtml(), 'text/html') }, icon('downloads'), 'Export for Firefox'))),
    picker,
    h('div', { class: 'table-wrap' },
      h('table', { class: 'table' },
        h('thead', {}, h('tr', {},
          h('th', { scope: 'col', text: 'Name' }),
          h('th', { scope: 'col', text: 'Address' }),
          h('th', { scope: 'col', text: 'Folder' }),
          h('th', { scope: 'col', text: 'Actions' }))),
        h('tbody', { id: 'bookmark-rows' }))),
    h('p', { class: 'table-summary', id: 'bookmark-summary' }),
    h('p', { class: 'hint', text: 'Export for Firefox writes a Netscape HTML file that Firefox can import (Bookmarks ▸ Manage Bookmarks ▸ Import and Backup). Import accepts that same HTML format or a Surge JSON export. Surge never edits Firefox’s live bookmark database.' }));

  renderRows();
}

export async function mount(target) {
  container = target;
  render();
}