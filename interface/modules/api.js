const TOKEN_KEY = 'surge.session';

export const bus = new EventTarget();

let token = null;

export function initSession() {
  const match = location.hash.match(/k=([A-Za-z0-9]+)/);
  if (match) {
    token = match[1];
    sessionStorage.setItem(TOKEN_KEY, token);
    history.replaceState(null, '', location.pathname + location.search);
  } else {
    token = sessionStorage.getItem(TOKEN_KEY);
  }
  return token;
}

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request(method, path, body) {
  let response;
  try {
    response = await fetch(path, {
      method,
      cache: 'no-store',
      headers: {
        'X-Surge-Token': token ?? '',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    bus.dispatchEvent(new CustomEvent('helper-lost'));
    throw new ApiError(0, 'helper-unavailable', 'The Surge helper is no longer running. Close Surge and start Surge.exe again.');
  }

  if (response.status === 503) {
    bus.dispatchEvent(new CustomEvent('usb', { detail: { present: false } }));
    const payload = await response.json().catch(() => ({}));
    throw new ApiError(503, payload.error ?? 'usb-missing', payload.message ?? 'The Surge USB drive is not available.');
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new ApiError(response.status, payload.error ?? 'error', payload.message ?? `Surge could not complete that request (${response.status}).`);
  }

  if (response.headers.get('X-Surge-Source') === 'backup') {
    bus.dispatchEvent(new CustomEvent('restored-from-backup'));
  }

  return response.status === 204 ? null : response.json();
}

export const api = {
  status: () => request('GET', '/api/status'),
  heartbeat: () => request('GET', '/api/heartbeat'),

  async readDocument(name) {
    try {
      return await request('GET', `/api/doc/${name}`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  },
  writeDocument: (name, document) => request('PUT', `/api/doc/${name}`, document),

  async readVault() {
    try {
      return await request('GET', '/api/vault');
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  },
  writeVault: (envelope) => request('PUT', '/api/vault', envelope),
  readVaultFile: (id) => request('GET', `/api/vault/files/${encodeURIComponent(id)}`),
  writeVaultFile: (id, sealed) => request('PUT', `/api/vault/files/${encodeURIComponent(id)}`, sealed),
  removeVaultFile: (id) => request('DELETE', `/api/vault/files/${encodeURIComponent(id)}`, { confirm: true }),

  vpnState: () => window.surgeDesktop ? window.surgeDesktop.vpnState() : request('GET', '/api/vpn/state'),
  vpnApply: (config) => window.surgeDesktop ? window.surgeDesktop.vpnApply(config) : request('POST', '/api/vpn/apply', { ...config, confirm: true }),

  listFiles: (path) => request('GET', `/api/files?path=${encodeURIComponent(path ?? '')}`),
  makeFolder: (path, name) => request('POST', '/api/files/mkdir', { path, name }),
  rename: (path, name) => request('POST', '/api/files/rename', { path, name }),
  remove: (path) => request('POST', '/api/files/delete', { path, confirm: true }),
  transfer: (path, destination, move) => request('POST', '/api/files/transfer', { path, destination, move, confirm: true }),
  open: (path) => request('POST', '/api/files/open', { path }),
  reveal: (path) => request('POST', '/api/files/reveal', { path }),
  readFileBlob: async (path) => {
    const response = await fetch(`/api/files/raw?path=${encodeURIComponent(path ?? '')}`, {
      method: 'GET',
      cache: 'no-store',
      headers: {
        'X-Surge-Token': token ?? '',
      },
    });
    if (!response.ok) {
      throw new ApiError(response.status, 'file-error', 'Could not load file preview.');
    }
    return await response.blob();
  },
  systemReset: (options = {}) => request('POST', '/api/system/reset', options),
};

export function joinPath(parent, name) {
  return parent ? `${parent}/${name}` : name;
}

export function parentPath(path) {
  if (!path) return '';
  const index = path.lastIndexOf('/');
  return index < 0 ? '' : path.slice(0, index);
}

export function baseName(path) {
  const index = path.lastIndexOf('/');
  return index < 0 ? path : path.slice(index + 1);
}
