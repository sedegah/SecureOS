export function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

export function formatDate(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function relativeTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  return formatDate(iso);
}

export function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

export function newId() {
  return crypto.randomUUID();
}

let toastRegion = null;

export function toast(message, kind = 'info') {
  toastRegion ??= document.getElementById('toasts');
  if (!toastRegion) return;
  const item = h('div', { class: `toast toast-${kind}`, role: 'status', text: message });
  toastRegion.append(item);
  setTimeout(() => item.remove(), kind === 'error' ? 8000 : 4000);
}

export function reportError(error) {
  toast(error?.message ?? 'Something went wrong.', 'error');
}

function dialogShell({ title, body, actions, labelledBy }) {
  const heading = h('h2', { id: labelledBy, text: title });
  const dialog = h('dialog', { class: 'dialog', 'aria-labelledby': labelledBy },
    h('form', { method: 'dialog', class: 'dialog-body' }, heading, body, h('div', { class: 'dialog-actions' }, actions)));
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove());
  return dialog;
}

export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false, signal = null }) {
  if (signal?.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    let settled = false;
    const abort = () => finish(false);
    const finish = (value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      dialog.textContent = '';
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    const dialog = dialogShell({
      title,
      labelledBy: 'confirm-title',
      body: h('p', { class: 'dialog-message', text: message }),
      actions: [
        h('button', { type: 'button', class: 'btn', onClick: () => finish(false) }, 'Cancel'),
        h('button', { type: 'button', class: danger ? 'btn btn-danger' : 'btn btn-primary', onClick: () => finish(true) }, confirmLabel),
      ],
    });
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      finish(false);
    });
    dialog.addEventListener('close', () => finish(false));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { finish(false); return; }
    dialog.showModal();
    dialog.querySelector('.dialog-actions button').focus();
  });
}

export function promptDialog({ title, label, value = '', placeholder = '', confirmLabel = 'Save' }) {
  return new Promise((resolve) => {
    let settled = false;
    const input = h('input', { class: 'input', type: 'text', value, placeholder, id: 'prompt-input', autocomplete: 'off' });
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
      dialog.close();
    };
    const dialog = dialogShell({
      title,
      labelledBy: 'prompt-title',
      body: h('label', { class: 'field', for: 'prompt-input' }, h('span', { class: 'field-label', text: label }), input),
      actions: [
        h('button', { type: 'button', class: 'btn', onClick: () => finish(null) }, 'Cancel'),
        h('button', { type: 'button', class: 'btn btn-primary', onClick: () => finish(input.value.trim() || null) }, confirmLabel),
      ],
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        finish(input.value.trim() || null);
      }
    });
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      finish(null);
    });
    dialog.showModal();
    input.focus();
    input.select();
  });
}

export function emptyState(message) {
  return h('p', { class: 'empty', text: message });
}

export function cardLabel(text) {
  return h('p', { class: 'card-label', text });
}

export function switchRow({ label, checked = false, disabled = false, hint = null, onChange = null }) {
  const input = h('input', { type: 'checkbox', disabled, 'aria-label': label });
  input.checked = checked;
  if (onChange) input.addEventListener('change', () => onChange(input.checked));
  return h('div', { class: 'switch-row' },
    h('div', { class: 'switch-row-text' },
      h('span', { class: 'switch-row-label', text: label }),
      hint ? h('span', { class: 'field-hint', text: hint }) : null),
    h('label', { class: 'check' }, input));
}

export function formDialog({ title, fields, confirmLabel = 'Save', message = null, signal = null }) {
  if (signal?.aborted) return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const inputs = new Map();
    const body = h('div', { class: 'dialog-fields' },
      message ? h('p', { class: 'dialog-message', text: message }) : null,
      fields.map((field) => {
        const id = `field-${field.name}`;
        let control;
        if (field.type === 'select') {
          control = h('select', { class: 'input', id },
            field.options.map((option) => h('option', { value: option.value, selected: option.value === field.value }, option.label)));
        } else if (field.type === 'textarea') {
          control = h('textarea', { class: 'input', id, rows: field.rows ?? 4, placeholder: field.placeholder ?? '' });
          control.value = field.value ?? '';
        } else {
          control = h('input', {
            class: 'input',
            id,
            type: field.type ?? 'text',
            value: field.value ?? '',
            placeholder: field.placeholder ?? '',
            autocomplete: 'off',
            spellcheck: field.type === 'password' ? 'false' : null,
          });
        }
        inputs.set(field.name, { control, field });
        return h('label', { class: 'field', for: id },
          h('span', { class: 'field-label', text: field.label }),
          control,
          field.hint ? h('span', { class: 'field-hint', text: field.hint }) : null);
      }));

    const abort = () => finish(null);
    const finish = (result) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      for (const { control } of inputs.values()) {
        control.value = '';
        control.removeAttribute('value');
      }
      dialog.close();
      dialog.remove();
      resolve(result);
    };

    const submit = () => {
      const values = {};
      for (const [name, { control, field }] of inputs) {
        const value = field.type === 'password' ? control.value : control.value.trim();
        if (field.required && !value) {
          control.focus();
          toast(`${field.label} is required.`, 'error');
          return;
        }
        values[name] = value;
      }
      finish(values);
    };

    const dialog = dialogShell({
      title,
      labelledBy: 'form-title',
      body,
      actions: [
        h('button', { type: 'button', class: 'btn', onClick: () => finish(null) }, 'Cancel'),
        h('button', { type: 'button', class: 'btn btn-primary', onClick: submit }, confirmLabel),
      ],
    });

    body.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && event.target.tagName !== 'TEXTAREA') {
        event.preventDefault();
        submit();
      }
    });
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      finish(null);
    });
    dialog.addEventListener('close', () => finish(null));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) {
      finish(null);
      return;
    }
    dialog.showModal();
    inputs.values().next().value?.control.focus();
  });
}
