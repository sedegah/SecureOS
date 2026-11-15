import { api } from './api.js';
import { h, clear, formatBytes, formatDate, toast, reportError, confirmDialog, emptyState } from './ui.js';
import { icon } from './icons.js';
import { isPreviewable, showPreview } from './preview.js';

const RENDER_LIMIT = 200;
const DOWNLOADS_PATH = 'Downloads';

let container = null;
let entries = [];
let storage = null;

export async function mount(target) {
  container = target;
  await refresh();
}

async function refresh() {
  try {
    const [listing, status] = await Promise.all([api.listFiles(DOWNLOADS_PATH), api.status()]);
    entries = listing.entries
      .filter((entry) => entry.type === 'file')
      .sort((a, b) => (b.modified ?? '').localeCompare(a.modified ?? ''));
    storage = status.storage ?? null;
  } catch (error) {
    reportError(error);
    entries = [];
  }
  render();
}

async function openFile(entry) {
  const filePath = `${DOWNLOADS_PATH}/${entry.name}`;
  if (isPreviewable(entry.name)) {
    try {
      const blob = await api.readFileBlob(filePath);
      showPreview({
        title: entry.name,
        blob,
        size: entry.size,
        onDownload: () => {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = entry.name;
          a.click();
          URL.revokeObjectURL(a.href);
        },
      });
      return;
    } catch (error) {
      reportError(error);
      return;
    }
  }
  try {
    await api.open(filePath);
    toast(`Opened ${entry.name}.`);
  } catch (error) {
    reportError(error);
  }
}

async function deleteFile(entry) {
  const ok = await confirmDialog({
    title: 'Delete download?',
    message: `${entry.name} will be deleted from the USB drive. This cannot be undone.`,
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!ok) return;
  try {
    await api.remove(`${DOWNLOADS_PATH}/${entry.name}`);
    toast('Deleted.');
    await refresh();
  } catch (error) {
    reportError(error);
  }
}

function storageNotice() {
  if (!storage) return null;
  if (storage.critical) {
    return h('div', { class: 'banner banner-error', role: 'alert' }, icon('warning'),
      h('div', {}, h('strong', { text: 'USB storage almost full' }),
        h('p', { text: `Only ${formatBytes(storage.free)} left. Delete downloads before saving anything else.` })));
  }
  if (storage.low) {
    return h('div', { class: 'banner banner-warn', role: 'status' }, icon('warning'),
      h('div', {}, h('strong', { text: 'USB storage running low' }),
        h('p', { text: `${formatBytes(storage.free)} left of ${formatBytes(storage.total)}.` })));
  }
  return null;
}

function render() {
  clear(container);
  const shown = entries.slice(0, RENDER_LIMIT);

  const rows = shown.map((entry) => {
    const previewable = isPreviewable(entry.name);
    return h('tr', { class: 'row' },
      h('td', { class: 'cell-name' }, icon(previewable ? 'eye' : 'file', 16), h('span', { text: entry.name })),
      h('td', { class: 'cell-size', text: formatBytes(entry.size) }),
      h('td', { class: 'cell-date', text: formatDate(entry.modified) }),
      h('td', { class: 'cell-actions' },
        h('button', {
          class: 'btn btn-small',
          type: 'button',
          onClick: () => openFile(entry)
        }, icon(previewable ? 'eye' : 'open', 15), previewable ? 'Preview' : 'Open'),
        h('button', {
          class: 'btn btn-small',
          type: 'button',
          onClick: () => api.reveal(`${DOWNLOADS_PATH}/${entry.name}`).catch(reportError)
        }, icon('folderOpen', 15), 'Show in folder'),
        h('button', {
          class: 'btn btn-small btn-danger',
          type: 'button',
          onClick: () => deleteFile(entry)
        }, icon('trash', 15), 'Delete')));
  });

  container.append(
    h('header', { class: 'section-head' },
      h('div', {}, h('h1', { text: 'Downloads' }),
        h('p', { class: 'section-sub', text: 'SURGE / Downloads' })),
      h('div', { class: 'section-actions' },
        h('button', { class: 'btn', type: 'button', onClick: () => api.open(DOWNLOADS_PATH).catch(reportError) }, icon('folderOpen'), 'Open folder'),
        h('button', { class: 'btn', type: 'button', onClick: refresh }, icon('refresh'), 'Refresh'))),
    storageNotice(),
    h('div', { class: 'table-wrap' },
      h('table', { class: 'table' },
        h('thead', {}, h('tr', {},
          h('th', { scope: 'col', text: 'File' }),
          h('th', { scope: 'col', text: 'Size' }),
          h('th', { scope: 'col', text: 'Downloaded' }),
          h('th', { scope: 'col', text: 'Actions' }))),
        h('tbody', {}, rows.length ? rows : h('tr', {}, h('td', { colspan: '4' }, emptyState('No downloads yet. Files you save in Surge Browser appear here.')))))),
    h('p', { class: 'table-summary', text: entries.length > RENDER_LIMIT ? `${entries.length} files • showing the ${RENDER_LIMIT} most recent` : `${entries.length} file${entries.length === 1 ? '' : 's'}` }));
}

export async function latestDownloads(limit = 4) {
  try {
    const listing = await api.listFiles(DOWNLOADS_PATH);
    return listing.entries
      .filter((entry) => entry.type === 'file')
      .sort((a, b) => (b.modified ?? '').localeCompare(a.modified ?? ''))
      .slice(0, limit);
  } catch {
    return [];
  }
}
