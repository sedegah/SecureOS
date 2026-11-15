const SEARCH = {
  duckduckgo: 'https://duckduckgo.com/?q=',
  google: 'https://www.google.com/search?q=',
  bing: 'https://www.bing.com/search?q=',
  startpage: 'https://www.startpage.com/sp/search?query=',
};

function webUrl(value) {
  if (typeof value !== 'string' || value.length > 8192) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function navigationTarget(value, engine = 'duckduckgo') {
  if (typeof value !== 'string' || value.length > 8192) throw new Error('Enter a shorter address.');
  const input = value.trim();
  if (!input) return '';
  const scheme = /^[a-z][a-z0-9+.-]*:/i.test(input);
  const hostPort = /^(localhost|[\w.-]+\.[a-z]+|\d{1,3}(?:\.\d{1,3}){3}):\d+(?:\/|$)/i.test(input);
  if (scheme && !hostPort) {
    const url = webUrl(input);
    if (!url) throw new Error('Only HTTP and HTTPS websites can be opened.');
    return url;
  }
  if (!/\s/.test(input) && (/^[\w-]+(?:\.[\w-]+)+(?:[:/]|$)/.test(input) || /^localhost(?::|\/|$)/i.test(input))) {
    const url = webUrl((/^(localhost|127\.)/i.test(input) ? 'http://' : 'https://') + input);
    if (url) return url;
  }
  return (SEARCH[engine] || SEARCH.duckduckgo) + encodeURIComponent(input);
}

module.exports = { webUrl, navigationTarget };

