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
      icon(fileExt === 'pdf' ? 'file' : ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(fileExt) ? 'eye' : 'file', 18),
      h('span', { class: 'preview-title', text: title }),
      metaText ? h('span', { class: 'preview-meta', text: metaText }) : null),
    h('div', { class: 'section-actions' }, downloadBtn, closeBtn));

  let toolbarEl = null;
  let bodyContent = null;

  if (fileExt === 'pdf') {
    const pdfView = createPdfViewer(blob, objectUrl, title);
    toolbarEl = pdfView.toolbar;
    bodyContent = pdfView.body;
  } else if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(fileExt)) {
    const photoView = createPhotoViewer(objectUrl, title);
    toolbarEl = photoView.toolbar;
    bodyContent = photoView.body;
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
    toolbarEl,
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

function createPdfViewer(blob, objectUrl, title) {
  let pdfDoc = null;
  let pageNum = 1;
  let pageRendering = false;
  let pageNumPending = null;
  let scale = 1.25;
  let rotation = 0;

  const pageInfo = h('span', { class: 'preview-page-info', text: 'Page 1 / 1' });
  const zoomBadge = h('span', { class: 'preview-zoom-badge', text: '125%' });

  const prevBtn = h('button', {
    class: 'btn btn-small',
    type: 'button',
    onClick: () => { if (pageNum <= 1) return; pageNum--; queueRenderPage(pageNum); },
  }, icon('left', 14), 'Previous');

  const nextBtn = h('button', {
    class: 'btn btn-small',
    type: 'button',
    onClick: () => { if (!pdfDoc || pageNum >= pdfDoc.numPages) return; pageNum++; queueRenderPage(pageNum); },
  }, 'Next', icon('right', 14));

  const zoomInBtn = h('button', {
    class: 'btn btn-small',
    type: 'button',
    onClick: () => { scale = Math.min(3.0, scale + 0.25); updateZoom(); queueRenderPage(pageNum); },
  }, icon('plus', 14), 'Zoom In');

  const zoomOutBtn = h('button', {
    class: 'btn btn-small',
    type: 'button',
    onClick: () => { scale = Math.max(0.5, scale - 0.25); updateZoom(); queueRenderPage(pageNum); },
  }, 'Zoom Out');

  const rotateBtn = h('button', {
    class: 'btn btn-small',
    type: 'button',
    onClick: () => { rotation = (rotation + 90) % 360; queueRenderPage(pageNum); },
  }, icon('refresh', 14), 'Rotate');

  function updateZoom() {
    zoomBadge.textContent = `${Math.round(scale * 100)}%`;
  }

  const toolbar = h('div', { class: 'preview-toolbar' },
    h('div', { class: 'preview-toolbar-group' },
      prevBtn,
      pageInfo,
      nextBtn),
    h('div', { class: 'preview-toolbar-group' },
      zoomOutBtn,
      zoomBadge,
      zoomInBtn,
      h('div', { class: 'preview-toolbar-sep' }),
      rotateBtn));

  const canvas = h('canvas', { class: 'pdf-canvas' });
  const ctx = canvas.getContext('2d');
  const viewportContainer = h('div', { class: 'pdf-viewport' }, canvas);

  function renderPage(num) {
    pageRendering = true;
    pdfDoc.getPage(num).then((page) => {
      const viewport = page.getViewport({ scale, rotation });
      const outputScale = window.devicePixelRatio || 1;

      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = Math.floor(viewport.width) + 'px';
      canvas.style.height = Math.floor(viewport.height) + 'px';

      const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null;
      const renderContext = { canvasContext: ctx, transform, viewport };
      const renderTask = page.render(renderContext);

      renderTask.promise.then(() => {
        pageRendering = false;
        if (pageNumPending !== null) {
          renderPage(pageNumPending);
          pageNumPending = null;
        }
      });
    });

    pageInfo.textContent = `Page ${num} / ${pdfDoc ? pdfDoc.numPages : 1}`;
  }

  function queueRenderPage(num) {
    if (pageRendering) pageNumPending = num;
    else renderPage(num);
  }

  const pdfjs = window.pdfjsLib;
  if (pdfjs) {
    pdfjs.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
    blob.arrayBuffer().then((buffer) => {
      pdfjs.getDocument({ data: buffer }).promise.then((doc) => {
        pdfDoc = doc;
        pageInfo.textContent = `Page 1 / ${doc.numPages}`;
        renderPage(pageNum);
      }).catch(() => fallbackEmbed());
    }).catch(() => fallbackEmbed());
  } else {
    fallbackEmbed();
  }

  function fallbackEmbed() {
    clear(viewportContainer);
    viewportContainer.append(h('embed', {
      class: 'preview-frame',
      type: 'application/pdf',
      src: `${objectUrl}#toolbar=1&navpanes=1`,
      title,
    }));
  }

  return { toolbar, body: viewportContainer };
}

function createPhotoViewer(objectUrl, title) {
  let scale = 1.0;
  let rotation = 0;
  let translateX = 0;
  let translateY = 0;
  let isDragging = false;
  let startX = 0;
  let startY = 0;

  const zoomBadge = h('span', { class: 'preview-zoom-badge', text: '100%' });
  const metaBadge = h('span', { class: 'preview-page-info', text: '' });

  const zoomInBtn = h('button', {
    class: 'btn btn-small',
    type: 'button',
    onClick: () => { scale = Math.min(5.0, scale * 1.25); applyTransform(); },
  }, icon('plus', 14), 'Zoom In');

  const zoomOutBtn = h('button', {
    class: 'btn btn-small',
    type: 'button',
    onClick: () => { scale = Math.max(0.2, scale / 1.25); applyTransform(); },
  }, 'Zoom Out');

  const resetBtn = h('button', {
    class: 'btn btn-small',
    type: 'button',
    onClick: () => { scale = 1.0; rotation = 0; translateX = 0; translateY = 0; applyTransform(); },
  }, 'Reset');

  const rotateBtn = h('button', {
    class: 'btn btn-small',
    type: 'button',
    onClick: () => { rotation = (rotation + 90) % 360; applyTransform(); },
  }, icon('refresh', 14), 'Rotate 90°');

  const toolbar = h('div', { class: 'preview-toolbar' },
    h('div', { class: 'preview-toolbar-group' },
      metaBadge),
    h('div', { class: 'preview-toolbar-group' },
      zoomOutBtn,
      zoomBadge,
      zoomInBtn,
      h('div', { class: 'preview-toolbar-sep' }),
      resetBtn,
      rotateBtn));

  const img = h('img', {
    class: 'photo-img',
    src: objectUrl,
    alt: title,
  });

  img.addEventListener('load', () => {
    metaBadge.textContent = `${img.naturalWidth} × ${img.naturalHeight} px`;
  });

  const viewport = h('div', { class: 'photo-viewport' }, img);

  function applyTransform() {
    img.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale}) rotate(${rotation}deg)`;
    zoomBadge.textContent = `${Math.round(scale * 100)}%`;
  }

  viewport.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    isDragging = true;
    startX = e.clientX - translateX;
    startY = e.clientY - translateY;
    viewport.classList.add('panning');
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    translateX = e.clientX - startX;
    translateY = e.clientY - startY;
    applyTransform();
  });

  window.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      viewport.classList.remove('panning');
    }
  });

  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.deltaY < 0) scale = Math.min(5.0, scale * 1.15);
    else scale = Math.max(0.2, scale / 1.15);
    applyTransform();
  }, { passive: false });

  return { toolbar, body: viewport };
}
