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
      createdAt: item.createdAt || new Date().toISOString(),
    };
  });
  return { version: 1, folders, items };
}

export async function loadBookmarks() {
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

export function listItems(folderId = ROOT_FOLDER, query = '', sortBy = 'alpha-asc') {
  const needle = query.trim().toLowerCase();
  let list = data.items
    .filter((item) => folderId === ROOT_FOLDER || (folderId === PINNED_FOLDER ? item.pinned : item.folderId === folderId))
    .filter((item) => !needle || item.title.toLowerCase().includes(needle) || item.url.toLowerCase().includes(needle));

  switch (sortBy) {
    case 'alpha-desc':
      list.sort((a, b) => b.title.localeCompare(a.title));
      break;
    case 'newest':
      list.sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
      break;
    case 'oldest':
      list.sort((a, b) => Date.parse(a.createdAt || 0) - Date.parse(b.createdAt || 0));
      break;
    case 'pinned':
      list.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || a.title.localeCompare(b.title));
      break;
    case 'alpha-asc':
    default:
      list.sort((a, b) => a.title.localeCompare(b.title));
      break;
  }
  return list;
}

export function pinnedItems(limit = 8) {
  return data.items.filter((item) => item.pinned).slice(0, limit);
}

export function countItems() {
  return data.items.length;
}

export async function addItem({ title, url, folderId = ROOT_FOLDER, pinned = false }) {
  return mutate(async (next) => {
    const address = safeUrl(url);
    if (!address) throw new Error('Only HTTP and HTTPS bookmarks are supported.');
    const existing = next.items.find((item) => item.url === address);
    if (existing) {
      existing.title = title || existing.title;
      existing.folderId = folderId;
      existing.pinned = pinned || existing.pinned;
      await persist(next);
      render();
      return existing;
    }
    const item = {
      id: newId(),
      title: title || getDomain(address),
      url: address,
      folderId,
      pinned: Boolean(pinned),
      createdAt: new Date().toISOString()
    };
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
    const folder = { id: newId(), name: name.trim() };
    next.folders.push(folder);
    await persist(next);
    return folder;
  });
}

export async function renameFolder(id, name) {
  return mutate(async (next) => {
    const folder = next.folders.find((entry) => entry.id === id);
    if (!folder) return;
    folder.name = name.trim();
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
  return JSON.stringify({ application: 'Surge Workspace & Browser', version: 1, exportedAt: new Date().toISOString(), ...data }, null, 2);
}

export async function importJson(text) {
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed?.items)) throw new Error('That file does not contain valid Surge bookmarks.');
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
      next.items.push({
        id: newId(),
        title: String(item.title ?? url),
        url,
        folderId: folderIds.has(item.folderId) ? item.folderId : ROOT_FOLDER,
        pinned: Boolean(item.pinned),
        createdAt: item.createdAt || new Date().toISOString()
      });
      added += 1;
    }
    await persist(next);
    return added;
  });
}

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
  return `<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<!-- Surge Bookmarks Export (Compatible with Chrome, Firefox, Safari, Edge) -->\n${doc.documentElement.outerHTML}`;
}

export async function importHtml(text) {
  const doc = new DOMParser().parseFromString(text, 'text/html');
  return mutate(async (currData) => {
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
          let folder = currData.folders.find((entry) => entry.name === name);
          if (!folder) {
            folder = { id: newId(), name };
            currData.folders.push(folder);
          }
          const nested = node.querySelector(':scope > DL');
          if (nested) walk(nested, folder.id);
        } else if (anchor) {
          const url = safeUrl(anchor.getAttribute('HREF'));
          if (!url || currData.items.some((existing) => existing.url === url)) continue;
          currData.items.push({
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
    await persist(currData);
    return added;
  });
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

export function getDomain(rawUrl) {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, '');
  } catch {
    return rawUrl;
  }
}

const DOMAIN_COLORS = [
  '#2563eb', '#7c3aed', '#db2777', '#ea580c',
  '#059669', '#0891b2', '#4f46e5', '#d97706', '#0284c7'
];

function getDomainColor(domain) {
  let hash = 0;
  for (let i = 0; i < domain.length; i++) {
    hash = domain.charCodeAt(i) + ((hash << 5) - hash);
  }
  return DOMAIN_COLORS[Math.abs(hash) % DOMAIN_COLORS.length];
}

function createFavicon(url, title, size = 32) {
  const domain = getDomain(url);
  const container = h('div', {
    class: 'bookmark-avatar',
    style: `width: ${size}px; height: ${size}px; background: ${getDomainColor(domain)};`
  });
  const letter = (domain.charAt(0) || title.charAt(0) || 'W').toUpperCase();
  const letterSpan = h('span', { class: 'bookmark-letter', style: `font-size: ${Math.round(size * 0.44)}px;`, text: letter });

  const img = h('img', {
    class: 'bookmark-favicon-img',
    style: `width: ${Math.round(size * 0.62)}px; height: ${Math.round(size * 0.62)}px;`,
    src: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`,
    alt: '',
    loading: 'lazy',
    onError: () => {
      img.remove();
      if (!container.contains(letterSpan)) container.append(letterSpan);
    },
    onLoad: () => {
      if (img.naturalWidth <= 1) {
        img.remove();
        if (!container.contains(letterSpan)) container.append(letterSpan);
      }
    }
  });

  container.append(img);
  return container;
}

export function openBookmark(url) {
  if (window.surgeDesktop?.openBrowser) {
    void window.surgeDesktop.openBrowser(url).catch(reportError);
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

export async function copyBookmarkUrl(url) {
  try {
    await navigator.clipboard.writeText(url);
    toast('Address copied to clipboard!');
  } catch {
    toast('Could not copy to clipboard.', 'error');
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

// UI State
let container = null;
let activeFolder = ROOT_FOLDER;
let query = '';
let sortBy = 'alpha-asc';
let viewMode = 'grid'; // 'grid' | 'list'

function folderOptions() {
  return [
    { value: ROOT_FOLDER, label: 'All bookmarks' },
    ...listFolders().map((folder) => ({ value: folder.id, label: folder.name }))
  ];
}

async function addOrEdit(item = null) {
  const values = await formDialog({
    title: item ? 'Edit Bookmark' : 'Add Bookmark',
    confirmLabel: item ? 'Save Changes' : 'Add Bookmark',
    fields: [
      { name: 'title', label: 'Name', value: item?.title ?? '', required: true, placeholder: 'e.g. GitHub' },
      { name: 'url', label: 'Address (URL)', value: item?.url ?? '', required: true, placeholder: 'https://github.com', hint: 'Must start with http:// or https://' },
      { name: 'folderId', label: 'Folder / Collection', type: 'select', value: item?.folderId ?? activeFolder, options: folderOptions() },
    ],
  });
  if (!values) return;

  const url = safeUrl(values.url);
  if (!url) {
    toast('Please enter a valid web address starting with http:// or https://', 'error');
    return;
  }
  try {
    if (item) {
      await updateItem(item.id, { title: values.title.trim(), url, folderId: values.folderId });
    } else {
      await addItem({ title: values.title.trim(), url, folderId: values.folderId });
    }
    toast(item ? 'Bookmark updated.' : 'Bookmark saved.');
    renderCards();
    updateFolderCounts();
  } catch (error) {
    reportError(error);
  }
}

async function removeItem(item) {
  const ok = await confirmDialog({
    title: 'Delete bookmark?',
    message: `Are you sure you want to delete "${item.title}"?`,
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!ok) return;
  try {
    await deleteItem(item.id);
    toast('Bookmark deleted.');
    renderCards();
    updateFolderCounts();
  } catch (error) {
    reportError(error);
  }
}

async function manageFolder(action) {
  const folder = listFolders().find((entry) => entry.id === activeFolder);
  if (!folder) return;
  if (action === 'rename') {
    const name = await promptDialog({ title: 'Rename Folder', label: 'Folder name', value: folder.name, confirmLabel: 'Rename' });
    if (!name || !name.trim()) return;
    await renameFolder(folder.id, name.trim());
    toast('Folder renamed.');
  } else {
    const ok = await confirmDialog({
      title: 'Delete folder?',
      message: `Delete folder "${folder.name}"? Its bookmarks will be kept in All bookmarks.`,
      confirmLabel: 'Delete Folder',
      danger: true,
    });
    if (!ok) return;
    await deleteFolder(folder.id);
    activeFolder = ROOT_FOLDER;
    toast('Folder deleted.');
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
  const gridContainer = container?.querySelector('#bookmark-content-area');
  const summary = container?.querySelector('#bookmark-summary');
  if (!gridContainer) return;
  clear(gridContainer);

  const items = listItems(activeFolder, query, sortBy);

  if (!items.length) {
    const emptyMsg = query
      ? `No bookmarks match "${query}". Try another search term.`
      : activeFolder === PINNED_FOLDER
        ? 'No pinned bookmarks yet. Click the star icon on any bookmark to pin it.'
        : 'No bookmarks here yet. Click "+ Add Bookmark" or Import to get started.';

    gridContainer.append(h('div', { style: 'padding: 24px 0;' },
      emptyState(emptyMsg),
      !query ? h('div', { style: 'display: flex; justify-content: center; margin-top: 12px;' },
        h('button', { class: 'btn btn-primary', type: 'button', onClick: () => addOrEdit() }, icon('plus', 16), 'Add first bookmark')
      ) : null
    ));
    if (summary) summary.textContent = `0 bookmarks shown • ${countItems()} total`;
    return;
  }

  if (viewMode === 'grid') {
    const grid = h('div', { class: 'bookmark-grid' });
    for (const item of items) {
      const domain = getDomain(item.url);
      const card = h('article', { class: 'bookmark-card' },
        h('div', { class: 'bookmark-card-top' },
          createFavicon(item.url, item.title, 34),
          h('div', { class: 'bookmark-card-meta' },
            h('a', {
              class: 'bookmark-title-link',
              title: item.title,
              href: item.url,
              onClick: (e) => { e.preventDefault(); openBookmark(item.url); },
              text: item.title
            }),
            h('span', { class: 'bookmark-domain-pill', title: item.url, text: domain })
          ),
          h('button', {
            class: `bookmark-pin-btn${item.pinned ? ' pinned' : ''}`,
            type: 'button',
            title: item.pinned ? 'Unpin bookmark' : 'Pin to favorites',
            onClick: async () => {
              await updateItem(item.id, { pinned: !item.pinned });
              renderCards();
              updateFolderCounts();
            }
          }, icon('star', 16))
        ),
        h('div', { class: 'bookmark-card-badges' },
          h('span', { class: 'bookmark-folder-badge' }, icon('files', 12), ' ', folderName(item.folderId))
        ),
        h('div', { class: 'bookmark-card-actions' },
          h('button', {
            class: 'bookmark-action-btn primary',
            type: 'button',
            title: 'Open in browser',
            onClick: () => openBookmark(item.url)
          }, icon('open', 13), 'Open'),
          h('button', {
            class: 'bookmark-action-btn',
            type: 'button',
            title: 'Copy web address',
            onClick: () => copyBookmarkUrl(item.url)
          }, icon('copy', 13), 'Copy'),
          h('div', { style: 'flex: 1;' }),
          h('button', {
            class: 'bookmark-action-btn btn-icon-only',
            type: 'button',
            title: 'Edit bookmark',
            onClick: () => addOrEdit(item)
          }, icon('pencil', 13)),
          h('button', {
            class: 'bookmark-action-btn btn-icon-only danger',
            type: 'button',
            title: 'Delete bookmark',
            onClick: () => removeItem(item)
          }, icon('trash', 13))
        )
      );
      grid.append(card);
    }
    gridContainer.append(grid);
  } else {
    // List View
    const listView = h('div', { class: 'bookmark-list-view' });
    for (const item of items) {
      const domain = getDomain(item.url);
      const row = h('div', { class: 'bookmark-list-row' },
        createFavicon(item.url, item.title, 24),
        h('div', { class: 'bookmark-list-main' },
          h('a', {
            class: 'bookmark-list-title',
            title: item.title,
            href: item.url,
            onClick: (e) => { e.preventDefault(); openBookmark(item.url); },
            text: item.title
          }),
          h('span', { class: 'bookmark-list-url', title: item.url, text: domain })
        ),
        h('span', { class: 'bookmark-folder-badge' }, folderName(item.folderId)),
        h('button', {
          class: `bookmark-pin-btn${item.pinned ? ' pinned' : ''}`,
          type: 'button',
          title: item.pinned ? 'Unpin' : 'Pin',
          onClick: async () => {
            await updateItem(item.id, { pinned: !item.pinned });
            renderCards();
            updateFolderCounts();
          }
        }, icon('star', 15)),
        h('button', {
          class: 'bookmark-action-btn primary',
          type: 'button',
          onClick: () => openBookmark(item.url)
        }, icon('open', 12), 'Open'),
        h('button', {
          class: 'bookmark-action-btn btn-icon-only',
          type: 'button',
          title: 'Copy URL',
          onClick: () => copyBookmarkUrl(item.url)
        }, icon('copy', 12)),
        h('button', {
          class: 'bookmark-action-btn btn-icon-only',
          type: 'button',
          title: 'Edit',
          onClick: () => addOrEdit(item)
        }, icon('pencil', 12)),
        h('button', {
          class: 'bookmark-action-btn btn-icon-only danger',
          type: 'button',
          title: 'Delete',
          onClick: () => removeItem(item)
        }, icon('trash', 12))
      );
      listView.append(row);
    }
    gridContainer.append(listView);
  }

  if (summary) {
    summary.textContent = `${items.length} bookmark${items.length === 1 ? '' : 's'} shown • ${countItems()} total`;
  }
}

function updateFolderCounts() {
  const rail = container?.querySelector('.folder-rail');
  if (!rail) return;
  const countRoot = rail.querySelector('[data-folder-id="root"] .folder-count');
  if (countRoot) countRoot.textContent = String(data.items.length);

  const countPinned = rail.querySelector('[data-folder-id="pinned"] .folder-count');
  if (countPinned) countPinned.textContent = String(data.items.filter((i) => i.pinned).length);

  for (const folder of data.folders) {
    const el = rail.querySelector(`[data-folder-id="${folder.id}"] .folder-count`);
    if (el) el.textContent = String(data.items.filter((i) => i.folderId === folder.id).length);
  }
}

function folderRail() {
  const rail = h('nav', { class: 'folder-rail', 'aria-label': 'Bookmark folders' });

  rail.append(h('div', { class: 'folder-rail-head' },
    h('span', { text: 'Collections' }),
    h('button', {
      class: 'btn btn-small',
      type: 'button',
      style: 'padding: 2px 6px; font-size: 11px;',
      title: 'New Folder',
      onClick: async () => {
        const name = await promptDialog({ title: 'New Folder', label: 'Folder name', confirmLabel: 'Create Folder' });
        if (!name || !name.trim()) return;
        try {
          const folder = await addFolder(name.trim());
          activeFolder = folder.id;
          render();
        } catch (error) {
          reportError(error);
        }
      }
    }, icon('plus', 12), 'Folder')
  ));

  const totalCount = data.items.length;
  const pinnedCount = data.items.filter((i) => i.pinned).length;

  const entry = (id, label, iconName, count) => h('button', {
    class: `nav-item${activeFolder === id ? ' active' : ''}`,
    type: 'button',
    'data-folder-id': id,
    'aria-current': activeFolder === id ? 'page' : null,
    onClick: () => { activeFolder = id; render(); },
  },
  icon(iconName, 15),
  h('span', { class: 'folder-label', text: label }),
  h('span', { class: 'folder-count', text: String(count) })
  );

  rail.append(entry(ROOT_FOLDER, 'All Bookmarks', 'bookmarks', totalCount));
  rail.append(entry(PINNED_FOLDER, 'Favorites', 'star', pinnedCount));

  if (data.folders.length) {
    rail.append(h('div', { class: 'folder-rail-divider' }));
    for (const folder of listFolders()) {
      const fCount = data.items.filter((i) => i.folderId === folder.id).length;
      rail.append(entry(folder.id, folder.name, 'files', fCount));
    }
  }

  if (activeFolder !== ROOT_FOLDER && activeFolder !== PINNED_FOLDER) {
    rail.append(h('div', { class: 'folder-rail-actions' },
      h('button', {
        class: 'btn btn-small',
        type: 'button',
        style: 'flex: 1; font-size: 11px;',
        onClick: () => manageFolder('rename')
      }, icon('pencil', 12), 'Rename'),
      h('button', {
        class: 'btn btn-small btn-danger',
        type: 'button',
        style: 'font-size: 11px;',
        onClick: () => manageFolder('delete')
      }, icon('trash', 12))
    ));
  }

  return rail;
}

function bookmarkToolbar() {
  const bar = h('div', { class: 'bookmark-toolbar' });

  // Search
  const searchWrap = h('div', { class: 'bookmark-search-wrap' });
  const searchIcon = icon('search', 15);
  searchIcon.classList.add('search-icon');
  const searchInput = h('input', {
    class: 'bookmark-search-input',
    type: 'text',
    placeholder: 'Search bookmarks or web addresses…',
    value: query,
    onInput: (e) => {
      query = e.target.value;
      clearBtn.style.display = query ? 'block' : 'none';
      renderCards();
    }
  });
  const clearBtn = h('button', {
    class: 'bookmark-search-clear',
    type: 'button',
    style: query ? 'display: block;' : 'display: none;',
    title: 'Clear search',
    onClick: () => {
      query = '';
      searchInput.value = '';
      clearBtn.style.display = 'none';
      renderCards();
    }
  }, '✕');

  searchWrap.append(searchIcon, searchInput, clearBtn);

  // Sort dropdown
  const sortSelect = h('select', {
    class: 'bookmark-sort-select',
    onChange: (e) => {
      sortBy = e.target.value;
      renderCards();
    }
  },
  h('option', { value: 'alpha-asc', selected: sortBy === 'alpha-asc' }, 'Title (A → Z)'),
  h('option', { value: 'alpha-desc', selected: sortBy === 'alpha-desc' }, 'Title (Z → A)'),
  h('option', { value: 'newest', selected: sortBy === 'newest' }, 'Recently Added'),
  h('option', { value: 'pinned', selected: sortBy === 'pinned' }, 'Favorites First')
  );

  // View mode toggle
  const toggle = h('div', { class: 'view-mode-toggle' });
  const gridBtn = h('button', {
    class: `view-mode-btn${viewMode === 'grid' ? ' active' : ''}`,
    type: 'button',
    title: 'Grid View',
    onClick: () => {
      viewMode = 'grid';
      gridBtn.classList.add('active');
      listBtn.classList.remove('active');
      renderCards();
    }
  }, icon('grid', 14));

  const listBtn = h('button', {
    class: `view-mode-btn${viewMode === 'list' ? ' active' : ''}`,
    type: 'button',
    title: 'List View',
    onClick: () => {
      viewMode = 'list';
      listBtn.classList.add('active');
      gridBtn.classList.remove('active');
      renderCards();
    }
  }, icon('list', 14));

  toggle.append(gridBtn, listBtn);

  bar.append(searchWrap, sortSelect, toggle);
  return bar;
}

function render() {
  if (!container) return;
  clear(container);
  const picker = importPicker();

  container.append(
    h('header', { class: 'section-head' },
      h('div', {},
        h('h1', { text: 'Bookmarks' }),
        h('p', { class: 'section-sub', text: 'Quickly organize, search and launch your favorite web links.' })
      ),
      h('div', { class: 'section-actions' },
        h('button', { class: 'btn', type: 'button', onClick: () => picker.click() }, icon('import', 15), 'Import'),
        h('button', { class: 'btn', type: 'button', onClick: () => downloadFile('surge-bookmarks.html', exportHtml(), 'text/html') }, icon('export', 15), 'Export HTML'),
        h('button', { class: 'btn', type: 'button', onClick: () => downloadFile('surge-bookmarks.json', exportJson(), 'application/json') }, icon('save', 15), 'Backup JSON'),
        h('button', { class: 'btn btn-primary', type: 'button', onClick: () => addOrEdit() }, icon('plus', 15), 'Add Bookmark')
      )
    ),
    picker,
    h('div', { class: 'bookmarks-layout' },
      folderRail(),
      h('div', { class: 'stack' },
        bookmarkToolbar(),
        h('div', { id: 'bookmark-content-area' }),
        h('p', { class: 'table-summary', id: 'bookmark-summary', style: 'margin-top: 12px;' })
      )
    ),
    h('p', { class: 'hint', style: 'margin-top: 20px;', text: 'Surge bookmarks are saved securely on this drive. Standard Netscape HTML export is fully compatible with Chrome, Edge, Safari, Firefox, and Surge Browser.' })
  );

  renderCards();
}

export async function mount(target) {
  container = target;
  if (!data.items.length && !data.folders.length) {
    try {
      await loadBookmarks();
    } catch {
      // Ignored if file doesn't exist yet
    }
  }
  render();
}

export function stop() {
  container = null;
  query = '';
  activeFolder = ROOT_FOLDER;
}
