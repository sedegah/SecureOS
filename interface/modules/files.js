import { api, joinPath, parentPath } from './api.js';
import { h, clear, formatBytes, formatDate, toast, reportError, confirmDialog, promptDialog, emptyState } from './ui.js';
import { icon } from './icons.js';

const EXECUTABLE_EXTENSIONS = new Set(['exe', 'msi', 'bat', 'cmd', 'com', 'scr', 'ps1', 'vbs', 'js', 'jse', 'wsf', 'lnk', 'pif', 'hta', 'reg']);
const RENDER_LIMIT = 400;

let container = null;
let currentPath = '';
let listing = null;
let selectedName = null;
let filterText = '';
let clipboard = null;

export async function mount(target, path = null) {
  container = target;
  if (path !== null) currentPath = path;
  await refresh();
}

export function clipboardItem() {
  return clipboard;
}

async function refresh() {
  try {
    listing = await api.listFiles(currentPath);
  } catch (error) {
    if (error.status === 404 && currentPath) {
      currentPath = '';
      await refresh();
      return;
    }
    reportError(error);
    listing = { path: currentPath, parent: parentPath(currentPath), isRoot: !currentPath, entries: [], truncated: false };
  }
  selectedName = null;
  render();
}

function visibleEntries() {
  const needle = filterText.trim().toLowerCase();
  return listing.entries.filter((entry) => !needle || entry.name.toLowerCase().includes(needle));
}

function selectedEntry() {
  return listing.entries.find((entry) => entry.name === selectedName) ?? null;
}

function entryPath(entry) {
  return joinPath(listing.path, entry.name);
}

async function activate(entry) {
  if (entry.type === 'dir') {
    currentPath = entryPath(entry);
    filterText = '';
    await refresh();
    return;
  }
  await openEntry(entry);
}

async function openEntry(entry) {
  const path = entryPath(entry);
  if (EXECUTABLE_EXTENSIONS.has(entry.extension)) {
    const ok = await confirmDialog({
      title: 'Run this file?',
      message: `${entry.name} is a program or script. Windows will run it with your account. Only continue if you trust this file.`,
      confirmLabel: 'Open anyway',
      danger: true,
    });
    if (!ok) return;
  }
  try {
    await api.open(path);
    toast(`Opened ${entry.name} with its default Windows app.`);
  } catch (error) {
    reportError(error);
  }
}

async function renameSelected() {
  const entry = selectedEntry();
  if (!entry) return;
  const name = await promptDialog({ title: 'Rename', label: 'New name', value: entry.name, confirmLabel: 'Rename' });
  if (!name || name === entry.name) return;
  try {
    await api.rename(entryPath(entry), name);
    toast('Renamed.');
    await refresh();
  } catch (error) {
    reportError(error);
  }
}

async function deleteSelected() {
  const entry = selectedEntry();
  if (!entry) return;
  const ok = await confirmDialog({
    title: entry.type === 'dir' ? 'Delete folder?' : 'Delete file?',
    message: entry.type === 'dir'
      ? `${entry.name} and everything inside it will be deleted from the USB drive. This cannot be undone.`
      : `${entry.name} will be deleted from the USB drive. This cannot be undone.`,
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!ok) return;
  try {
    await api.remove(entryPath(entry));
    toast('Deleted.');
    await refresh();
  } catch (error) {
    reportError(error);
  }
}

async function pasteClipboard() {
  if (!clipboard) return;
  const move = clipboard.move;
  try {
    await api.transfer(clipboard.path, currentPath, move);
    toast(move ? 'Moved.' : 'Copied.');
    clipboard = null;
    await refresh();
  } catch (error) {
    reportError(error);
  }
}

function breadcrumb() {
  const trail = h('nav', { class: 'breadcrumb', 'aria-label': 'Folder path' });
  const segments = listing.path ? listing.path.split('/') : [];
  trail.append(h('button', {
    class: 'crumb',
    type: 'button',
    onClick: async () => { currentPath = ''; await refresh(); },
  }, icon('drive', 15), 'SURGE USB'));
  segments.forEach((segment, index) => {
    const path = segments.slice(0, index + 1).join('/');
    trail.append(icon('right', 13));
    trail.append(h('button', {
      class: 'crumb',
      type: 'button',
      'aria-current': index === segments.length - 1 ? 'page' : null,
      onClick: async () => { currentPath = path; await refresh(); },
    }, segment));
  });
  return trail;
}

async function newFolder() {
  const name = await promptDialog({ title: 'New folder', label: 'Folder name', placeholder: 'Documents', confirmLabel: 'Create' });
  if (!name) return;
  try {
    await api.makeFolder(currentPath, name);
    toast('Folder created.');
    await refresh();
  } catch (error) {
    reportError(error);
  }
}

function stageTransfer(move) {
  const entry = selectedEntry();
  if (!entry) return;
  clipboard = { path: entryPath(entry), move };
  toast(move
    ? `Ready to move ${entry.name}. Open the destination folder and choose Paste.`
    : `Copied ${entry.name}. Open a folder and choose Paste.`);
  render();
}

function toolbar() {
  const filter = h('input', {
    class: 'input input-inline',
    type: 'search',
    placeholder: 'Filter this folder',
    value: filterText,
    'aria-label': 'Filter files by name',
    onInput: (event) => { filterText = event.target.value; renderTable(); },
  });

  return h('div', { class: 'toolbar' },
    h('button', { class: 'btn', type: 'button', disabled: listing.isRoot ? true : null, title: 'Parent folder', onClick: async () => { currentPath = listing.parent ?? ''; await refresh(); } }, icon('up'), 'Up'),
    breadcrumb(),
    filter,
    h('div', { class: 'toolbar-actions' },
      clipboard ? h('button', { class: 'btn btn-primary', type: 'button', onClick: pasteClipboard }, icon('paste'), clipboard.move ? 'Paste (move)' : 'Paste (copy)') : null,
      h('button', { class: 'btn', type: 'button', onClick: refresh }, icon('refresh'), 'Refresh')));
}

function renderTable() {
  const body = container.querySelector('#file-rows');
  const summary = container.querySelector('#file-summary');
  if (!body) return;
  clear(body);

  const entries = visibleEntries();
  const shown = entries.slice(0, RENDER_LIMIT);

  for (const entry of shown) {
    const isSelected = entry.name === selectedName;
    const row = h('tr', {
      class: isSelected ? 'row selected' : 'row',
      tabindex: '0',
      'aria-selected': isSelected ? 'true' : 'false',
      dataset: { name: entry.name },
      onClick: () => { selectedName = entry.name; render(); },
      onDblclick: () => activate(entry),
      onKeydown: async (event) => {
        if (event.key === 'Enter') { event.preventDefault(); await activate(entry); }
        else if (event.key === ' ') { event.preventDefault(); selectedName = entry.name; render(); container.querySelector(`[data-name="${CSS.escape(entry.name)}"]`)?.focus(); }
        else if (event.key === 'Delete') { event.preventDefault(); selectedName = entry.name; await deleteSelected(); }
        else if (event.key === 'ArrowDown') { event.preventDefault(); row.nextElementSibling?.focus(); }
        else if (event.key === 'ArrowUp') { event.preventDefault(); row.previousElementSibling?.focus(); }
      },
    },
    h('td', { class: 'cell-name' }, icon(entry.type === 'dir' ? 'files' : 'file', 16), h('span', { text: entry.name })),
    h('td', { class: 'cell-type', text: entry.type === 'dir' ? 'Folder' : (entry.extension ? entry.extension.toUpperCase() : 'File') }),
    h('td', { class: 'cell-size', text: entry.type === 'dir' ? '—' : formatBytes(entry.size) }),
    h('td', { class: 'cell-date', text: formatDate(entry.modified) }));
    body.append(row);
  }

  if (!shown.length) {
    body.append(h('tr', {}, h('td', { colspan: '4' }, emptyState(filterText ? 'No items match that filter.' : 'This folder is empty.'))));
  }

  if (summary) {
    const parts = [`${entries.length} item${entries.length === 1 ? '' : 's'}`];
    if (entries.length > RENDER_LIMIT) parts.push(`showing first ${RENDER_LIMIT} — use the filter to narrow down`);
    if (listing.truncated) parts.push('folder listing capped by Surge');
    if (selectedName) parts.push(`selected: ${selectedName}`);
    summary.textContent = parts.join(' • ');
  }
}

function render() {
  clear(container);
  const entry = selectedEntry();
  const disabled = entry ? null : true;

  container.append(
    h('header', { class: 'section-head' },
      h('div', {}, h('h1', { text: 'Files' }),
        h('p', { class: 'section-sub', text: listing.path ? `SURGE / ${listing.path.split('/').join(' / ')}` : 'SURGE USB' })),
      h('div', { class: 'section-actions' },
        h('button', { class: 'btn', type: 'button', onClick: newFolder }, icon('folderAdd'), 'New folder'),
        h('button', { class: 'btn', type: 'button', disabled, onClick: () => activate(entry) }, icon('open'), 'Open'),
        h('button', { class: 'btn', type: 'button', disabled, onClick: renameSelected }, icon('rename'), 'Rename'),
        h('button', { class: 'btn', type: 'button', disabled, onClick: () => stageTransfer(false) }, icon('copy'), 'Copy'),
        h('button', { class: 'btn', type: 'button', disabled, onClick: () => stageTransfer(true) }, icon('move'), 'Move'),
        h('button', { class: 'btn btn-danger', type: 'button', disabled, onClick: deleteSelected }, icon('trash'), 'Delete'))),
    toolbar(),
    h('div', { class: 'table-wrap' },
      h('table', { class: 'table' },
        h('thead', {}, h('tr', {},
          h('th', { scope: 'col', text: 'Name' }),
          h('th', { scope: 'col', text: 'Type' }),
          h('th', { scope: 'col', text: 'Size' }),
          h('th', { scope: 'col', text: 'Modified' }))),
        h('tbody', { id: 'file-rows' }))),
    h('p', { class: 'table-summary', id: 'file-summary' }),
    h('p', { class: 'hint', text: 'Showing the Surge USB only. Delete asks for confirmation. Double-click or press Enter to open.' }));
  renderTable();
}