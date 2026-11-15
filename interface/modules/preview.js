import { h, formatBytes } from './ui.js';
import { icon } from './icons.js';

const PREVIEWABLE_EXTS = new Set([
  'pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'txt', 'log', 'json', 'md'
]);

export function isPreviewable(fileNameOrExt) {
  if (!fileNameOrExt) return false;
  const ext = (fileNameOrExt.includes('.') ? fileNameOrExt.split('.').pop() : fileNameOrExt).toLowerCase();
  return PREVIEWABLE_EXTS.has(ext);
}

export function showPreview({ title, blob, ext = null, size = null, onDownload = null }) {
  const fileExt = (ext || (title.includes('.') ? title.split('.').pop() : '')).toLowerCase();
  const objectUrl = URL.createObjectURL(blob);

  const metaText = size ? formatBytes(size) : '';

  const closeBtn = h('button', {
    class: 'btn btn-small',
    type: 'button',
    'aria-label': 'Close preview',
    onClick: close,
  }, icon('close', 16));

  const downloadBtn = onDownload ? h('button', {
    class: 'btn btn-small',
    type: 'button',
    onClick: () => onDownload(),
  }, icon('export', 14), 'Export') : null;

  const header = h('div', { class: 'preview-header' },
    h('div', { class: 'preview-title-group' },
      icon(fileExt === 'pdf' ? 'file' : ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(fileExt) ? 'eye' : 'file', 18),
      h('span', { class: 'preview-title', text: title }),
      metaText ? h('span', { class: 'preview-meta', text: metaText }) : null),
    h('div', { class: 'section-actions' }, downloadBtn, closeBtn));

  let bodyContent;
  if (fileExt === 'pdf') {
    bodyContent = h('iframe', {
      class: 'preview-frame',
      src: `${objectUrl}#toolbar=1`,
      title,
    });
  } else if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(fileExt)) {
    bodyContent = h('div', { class: 'preview-image-wrap' },
      h('img', {
        class: 'preview-image',
        src: objectUrl,
        alt: title,
      }));
  } else {
    const pre = h('pre', { class: 'preview-text mono', text: 'Loading…' });
    blob.text().then((text) => {
      pre.textContent = text;
    }).catch(() => {
      pre.textContent = 'Could not read document contents.';
    });
    bodyContent = pre;
  }

  const body = h('div', { class: 'preview-body' }, bodyContent);

  const windowEl = h('div', { class: 'preview-window', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    header,
    body);

  const overlay = h('div', { class: 'preview-modal' }, windowEl);

  function close() {
    window.removeEventListener('keydown', onKeyDown);
    overlay.remove();
    URL.revokeObjectURL(objectUrl);
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  }

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  window.addEventListener('keydown', onKeyDown);
  document.body.append(overlay);
  closeBtn.focus();
}
