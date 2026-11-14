import { api, bus } from './api.js';
import { h, clear, newId, toast, reportError, confirmDialog, debounce, relativeTime, emptyState } from './ui.js';
import { icon } from './icons.js';

let notes = [];
let readError = new Error('Notes have not been loaded. Writes are blocked.');
let writes = Promise.resolve();

function serializeWrite(operation) {
  const result = writes.then(operation);
  writes = result.catch(() => {});
  return result;
}

export async function loadNotes() {
  return serializeWrite(async () => {
    try {
      const stored = await api.readDocument('notes');
      if (stored !== null && (!Array.isArray(stored?.notes) || stored.notes.some((note) =>
        !note || typeof note.id !== 'string' || typeof note.title !== 'string' || typeof note.body !== 'string'))) {
        throw new Error('The notes document is damaged. Writes are blocked to protect it.');
      }
      notes = stored?.notes ?? [];
      readError = null;
      return notes;
    } catch (error) {
      readError = error;
      throw error;
    }
  });
}

async function persist(nextNotes) {
  if (readError) throw readError;
  await api.writeDocument('notes', { version: 1, notes: nextNotes });
  notes = nextNotes;
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
  return serializeWrite(async () => {
    const now = new Date().toISOString();
    const note = { id: newId(), title: 'Untitled note', body: '', createdAt: now, modifiedAt: now };
    await persist([note, ...notes]);
    return note;
  });
}

export async function saveNote(id, patch) {
  const captured = { ...patch };
  return serializeWrite(async () => {
    const note = getNote(id);
    if (!note) return null;
    const updated = { ...note, ...captured, modifiedAt: new Date().toISOString() };
    await persist(notes.map((item) => item.id === id ? updated : item));
    return updated;
  });
}

export async function deleteNote(id) {
  return serializeWrite(() => persist(notes.filter((note) => note.id !== id)));
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
const drafts = new Map();
let revision = 0;
let savingDraft = null;
let pendingSave = null;

const queueSave = debounce(() => { void flushSave().catch(reportError); }, 700);

function flushSave() {
  if (pendingSave) return pendingSave;
  if (!drafts.size) return Promise.resolve();
  pendingSave = (async () => {
    try {
      while (drafts.size) {
        const draft = drafts.values().next().value;
        savingDraft = draft;
        updateSaveIndicator();
        const saved = await saveNote(draft.id, { title: draft.title.trim() || 'Untitled note', body: draft.body });
        if (!saved) throw new Error('This note is no longer available. Its unsaved draft has been retained.');
        if (drafts.get(draft.id)?.revision === draft.revision) drafts.delete(draft.id);
        renderList();
      }
    } finally {
      savingDraft = null;
      updateSaveIndicator();
    }
  })().finally(() => { pendingSave = null; });
  return pendingSave;
}

function updateSaveIndicator() {
  const indicator = container?.querySelector('#note-saved');
  if (!indicator) return;
  const note = getNote(selectedId);
  const draft = drafts.get(selectedId);
  const saveState = readError ? 'blocked' : draft
    ? savingDraft?.revision === draft.revision ? 'saving' : 'dirty'
    : 'clean';
  indicator.textContent = saveState === 'saving' ? '● SAVING…'
    : saveState === 'dirty' || saveState === 'blocked' ? '● NOT SAVED'
    : note ? '● SAVED' : '';
  indicator.dataset.state = saveState;
}

function markDirty() {
  const title = container?.querySelector('#note-title');
  const body = container?.querySelector('#note-body');
  if (!selectedId || !title || !body) return;
  drafts.set(selectedId, { id: selectedId, title: title.value, body: body.value, revision: ++revision });
  updateSaveIndicator();
  queueSave();
}

async function selectNote(id) {
  try {
    await flushSave();
    selectedId = id;
    render();
  } catch (error) {
    reportError(error);
  }
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
    await flushSave();
    await deleteNote(note.id);
    selectedId = listNotes(query)[0]?.id ?? null;
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

  const draft = drafts.get(note.id) ?? note;
  const title = h('input', {
    class: 'input note-title', id: 'note-title', type: 'text', value: draft.title,
    'aria-label': 'Note title', onInput: markDirty,
  });
  const body = h('textarea', {
    class: 'input note-body', id: 'note-body', rows: 18, spellcheck: 'true',
    'aria-label': 'Note text', placeholder: 'Write in plain text or Markdown…', onInput: markDirty,
  });
  body.value = draft.body;

  const previewPane = h('div', { class: 'note-preview', id: 'note-preview' });
  if (preview) {
    clear(previewPane).append(renderMarkdown(draft.body));
    previewPane.hidden = false;
    body.hidden = true;
  } else {
    previewPane.hidden = true;
    body.hidden = false;
  }

  return h('div', { class: 'editor' },
    h('div', { class: 'note-title-row' }, title, h('span', { class: 'save-state', id: 'note-saved' })),
    body,
    previewPane,
    h('div', { class: 'editor-foot' },
      h('span', { class: 'hint', text: `Last modified ${relativeTime(note.modifiedAt)}` }),
      h('div', { class: 'section-actions' },
        h('button', {
          class: 'btn btn-small', type: 'button', 'aria-pressed': preview ? 'true' : 'false',
          onClick: async () => {
            try {
              await flushSave();
              preview = !preview;
              render();
            } catch (error) {
              reportError(error);
            }
          },
        }, icon('eye'), preview ? 'Edit text' : 'Preview'),
        h('button', { class: 'btn btn-small btn-danger', type: 'button', onClick: removeSelected }, icon('trash'), 'Delete'))),
    h('p', { class: 'hint', text: 'Markdown: # heading, **bold**, *italic*, `code`, - list, [link](https://example.org).' }));
}

function render() {
  if (!container) return;
  clear(container);
  const search = h('input', {
    class: 'input', type: 'search', placeholder: 'Search notes', value: query, 'aria-label': 'Search notes by title or content',
    onInput: (event) => { query = event.target.value; renderList(); },
  });

  container.append(
    h('header', { class: 'section-head' },
      h('div', {}, h('h1', { text: 'Notes' }), h('p', { class: 'section-sub', text: 'Saved to your USB automatically' })),
      h('button', {
        class: 'btn btn-primary', type: 'button', disabled: Boolean(readError),
        onClick: async () => {
          try {
            await flushSave();
            const note = await createNote();
            selectedId = note.id;
            query = '';
            render();
            container?.querySelector('#note-title')?.focus();
          } catch (error) {
            reportError(error);
          }
        },
      }, icon('plus'), 'New note')),
    ...(readError ? [h('div', { class: 'banner banner-error', role: 'alert' }, icon('warning'),
      h('p', { text: `Notes could not be loaded. Writes are blocked to protect existing data. ${readError.message}` }))] : []),
    h('div', { class: 'notes-layout' },
      h('aside', { class: 'note-sidebar' }, search, h('ul', { class: 'note-list', id: 'note-list' })),
      editor()));

  renderList();
  updateSaveIndicator();
}

export async function mount(target) {
  container = target;
  if (!selectedId || !getNote(selectedId)) selectedId = listNotes()[0]?.id ?? null;
  render();
}

// Rejects on failure so navigation can be blocked without discarding the draft.
export async function flushPendingSave() {
  await flushSave();
}

export async function stop() {
  const target = container;
  try {
    await flushPendingSave();
  } finally {
    if (container === target) container = null;
  }
}

export function openNote(id) {
  selectedId = id;
  location.hash = '#/notes';
}