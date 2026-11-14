import { api, bus } from './api.js';
import { h, clear, newId, toast, reportError, confirmDialog, debounce, relativeTime, emptyState } from './ui.js';
import { icon } from './icons.js';

let notes = [];

export async function loadNotes() {
  const stored = await api.readDocument('notes');
  notes = Array.isArray(stored?.notes) ? stored.notes : [];
  return notes;
}

async function persist() {
  await api.writeDocument('notes', { version: 1, notes });
  bus.dispatchEvent(new Event('notes-changed'));
}

export function listNotes(query = '') {
  const needle = query.trim().toLowerCase();
  return notes
    .filter((note) => !needle || note.title.toLowerCase().includes(needle) || note.body.toLowerCase().includes(needle))
    .sort((a, b) => (b.modifiedAt ?? '').localeCompare(a.modifiedAt ?? ''));
}

export function recentNotes(limit = 4) {
  return listNotes().slice(0, limit);
}

export function getNote(id) {
  return notes.find((note) => note.id === id) ?? null;
}

export async function createNote() {
  const now = new Date().toISOString();
  const note = { id: newId(), title: 'Untitled note', body: '', createdAt: now, modifiedAt: now };
  notes.unshift(note);
  await persist();
  return note;
}

export async function saveNote(id, patch) {
  const note = getNote(id);
  if (!note) return null;
  Object.assign(note, patch, { modifiedAt: new Date().toISOString() });
  await persist();
  return note;
}

export async function deleteNote(id) {
  notes = notes.filter((note) => note.id !== id);
  await persist();
}

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*|\[[^\]]+\]\((https?:\/\/[^\s)]+)\))/g;

function inline(text) {
  const fragment = document.createDocumentFragment();
  let cursor = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > cursor) fragment.append(document.createTextNode(text.slice(cursor, match.index)));
    const token = match[0];
    if (token.startsWith('**')) fragment.append(h('strong', { text: token.slice(2, -2) }));
    else if (token.startsWith('`')) fragment.append(h('code', { text: token.slice(1, -1) }));
    else if (token.startsWith('*')) fragment.append(h('em', { text: token.slice(1, -1) }));
    else {
      const link = token.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
      fragment.append(h('a', { href: link[2], target: '_blank', rel: 'noopener noreferrer', text: link[1] }));
    }
    cursor = match.index + token.length;
  }
  if (cursor < text.length) fragment.append(document.createTextNode(text.slice(cursor)));
  return fragment;
}

/// Minimal Markdown subset, built as DOM nodes so note content can never inject markup.
export function renderMarkdown(source) {
  const root = h('div', { class: 'markdown' });
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  let list = null;
  let code = null;
  let paragraph = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      root.append(h('p', {}, inline(paragraph.join(' '))));
      paragraph = [];
    }
  };
  const closeList = () => {
    list = null;
  };

  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      if (code) {
        root.append(h('pre', {}, h('code', { text: code.join('\n') })));
        code = null;
      } else {
        flushParagraph();
        closeList();
        code = [];
      }
      continue;
    }
    if (code) {
      code.push(line);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      closeList();
      root.append(h(`h${heading[1].length}`, {}, inline(heading[2])));
      continue;
    }

    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      flushParagraph();
      closeList();
      root.append(h('hr'));
      continue;
    }

    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || numbered) {
      flushParagraph();
      const tag = bullet ? 'ul' : 'ol';
      if (!list || list.tagName.toLowerCase() !== tag) {
        list = h(tag);
        root.append(list);
      }
      list.append(h('li', {}, inline((bullet ?? numbered)[1])));
      continue;
    }

    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      closeList();
      root.append(h('blockquote', {}, inline(quote[1])));
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      closeList();
      continue;
    }

    closeList();
    paragraph.push(line.trim());
  }

  if (code) root.append(h('pre', {}, h('code', { text: code.join('\n') })));
  flushParagraph();
  return root;
}

let container = null;
let selectedId = null;
let query = '';
let preview = false;
let saveState = 'idle';

const queueSave = debounce(() => { void flushSave(); }, 700);

async function flushSave() {
  const note = getNote(selectedId);
  if (!note || saveState === 'clean') return;
  const title = container?.querySelector('#note-title');
  const body = container?.querySelector('#note-body');
  if (!title || !body) return;
  saveState = 'saving';
  updateSaveIndicator();
  try {
    await saveNote(note.id, { title: title.value.trim() || 'Untitled note', body: body.value });
    saveState = 'clean';
  } catch (error) {
    saveState = 'dirty';
    reportError(error);
  }
  updateSaveIndicator();
  renderList();
}

function updateSaveIndicator() {
  const indicator = container?.querySelector('#note-saved');
  if (!indicator) return;
  const note = getNote(selectedId);
  indicator.textContent = saveState === 'saving' ? 'Saving…'
    : saveState === 'dirty' ? 'Not saved yet'
    : note ? `Saved ${relativeTime(note.modifiedAt)}` : '';
  indicator.dataset.state = saveState;
}

function markDirty() {
  saveState = 'dirty';
  updateSaveIndicator();
  queueSave();
}

async function selectNote(id) {
  await flushSave();
  selectedId = id;
  saveState = 'clean';
  render();
}

async function removeSelected() {
  const note = getNote(selectedId);
  if (!note) return;
  const ok = await confirmDialog({
    title: 'Delete note?',
    message: `"${note.title}" will be deleted from the USB drive. This cannot be undone.`,
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!ok) return;
  try {
    await deleteNote(note.id);
    selectedId = listNotes(query)[0]?.id ?? null;
    saveState = 'clean';
    toast('Note deleted.');
    render();
  } catch (error) {
    reportError(error);
  }
}

function renderList() {
  const list = container?.querySelector('#note-list');
  if (!list) return;
  clear(list);
  const matches = listNotes(query);
  if (!matches.length) {
    list.append(emptyState(query ? 'No notes match that search.' : 'No notes yet. Create your first note.'));
    return;
  }
  for (const note of matches) {
    list.append(h('li', {},
      h('button', {
        class: note.id === selectedId ? 'note-item selected' : 'note-item',
        type: 'button',
        'aria-current': note.id === selectedId ? 'true' : null,
        onClick: () => selectNote(note.id),
      },
      h('span', { class: 'note-item-title', text: note.title }),
      h('span', { class: 'note-item-meta', text: relativeTime(note.modifiedAt) }),
      h('span', { class: 'note-item-snippet', text: note.body.slice(0, 90).replace(/\s+/g, ' ') || 'Empty note' }))));
  }
}

function editor() {
  const note = getNote(selectedId);
  if (!note) {
    return h('div', { class: 'editor empty-editor' }, emptyState('Select a note on the left, or create a new one.'));
  }

  const title = h('input', {
    class: 'input note-title', id: 'note-title', type: 'text', value: note.title,
    'aria-label': 'Note title', onInput: markDirty,
  });
  const body = h('textarea', {
    class: 'input note-body', id: 'note-body', rows: 18, spellcheck: 'true',
    'aria-label': 'Note text', placeholder: 'Write in plain text or Markdown…', onInput: markDirty,
  });
  body.value = note.body;

  const previewPane = h('div', { class: 'note-preview', id: 'note-preview' });
  if (preview) {
    clear(previewPane).append(renderMarkdown(note.body));
    previewPane.hidden = false;
    body.hidden = true;
  } else {
    previewPane.hidden = true;
    body.hidden = false;
  }

  return h('div', { class: 'editor' },
    title,
    h('div', { class: 'editor-bar' },
      h('button', {
        class: 'btn btn-small', type: 'button', 'aria-pressed': preview ? 'true' : 'false',
        onClick: async () => { await flushSave(); preview = !preview; render(); },
      }, icon('eye'), preview ? 'Edit text' : 'Preview'),
      h('button', { class: 'btn btn-small btn-danger', type: 'button', onClick: removeSelected }, icon('trash'), 'Delete note'),
      h('span', { class: 'save-state', id: 'note-saved' })),
    body,
    previewPane,
    h('p', { class: 'hint', text: 'Notes save automatically to Data/Notes/notes.json on the USB. Markdown: # heading, **bold**, *italic*, `code`, - list, [link](https://example.org).' }));
}

function render() {
  clear(container);
  const search = h('input', {
    class: 'input', type: 'search', placeholder: 'Search notes', value: query, 'aria-label': 'Search notes by title or content',
    onInput: (event) => { query = event.target.value; renderList(); },
  });

  container.append(
    h('header', { class: 'section-head' },
      h('div', {}, h('h1', { text: 'Notes' }), h('p', { class: 'section-sub', text: 'Offline personal notes, saved straight to the USB drive.' })),
      h('button', {
        class: 'btn btn-primary', type: 'button',
        onClick: async () => {
          await flushSave();
          try {
            const note = await createNote();
            selectedId = note.id;
            query = '';
            saveState = 'clean';
            render();
            container.querySelector('#note-title')?.focus();
          } catch (error) {
            reportError(error);
          }
        },
      }, icon('plus'), 'New note')),
    h('div', { class: 'notes-layout' },
      h('aside', { class: 'note-sidebar' }, search, h('ul', { class: 'note-list', id: 'note-list' })),
      editor()));

  renderList();
  updateSaveIndicator();
}

export async function mount(target) {
  container = target;
  await flushSave();
  if (!selectedId || !getNote(selectedId)) selectedId = listNotes()[0]?.id ?? null;
  saveState = 'clean';
  render();
}

export async function flushPendingSave() {
  await flushSave();
}

export function openNote(id) {
  selectedId = id;
  location.hash = '#/notes';
}