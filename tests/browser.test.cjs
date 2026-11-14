const { test } = require('node:test');
const assert = require('node:assert/strict');
const { navigationTarget, webUrl } = require('../desktop/navigation.cjs');

test('empty addresses stay on the new tab page', () => assert.equal(navigationTarget(' '), ''));
test('web URLs and hostnames navigate', () => {
  assert.equal(navigationTarget('example.org/path'), 'https://example.org/path');
  assert.equal(navigationTarget('http://localhost:8080/'), 'http://localhost:8080/');
  assert.equal(navigationTarget('localhost:8080'), 'http://localhost:8080/');
});
test('queries use the selected search engine', () => {
  assert.equal(navigationTarget('hello world'), 'https://duckduckgo.com/?q=hello%20world');
  assert.equal(navigationTarget('hello world', 'bing'), 'https://www.bing.com/search?q=hello%20world');
});
test('privileged protocols and embedded credentials cannot navigate', () => {
  for (const value of ['file:///C:/Windows/win.ini', 'javascript:alert(1)', 'data:text/html,bad', 'chrome://settings', 'https://name:password@example.org']) {
    assert.equal(webUrl(value), null);
    assert.throws(() => navigationTarget(value));
  }
});
test('untrusted types and excessive URLs are refused', () => {
  assert.throws(() => navigationTarget({ url: 'example.org' }));
  assert.throws(() => navigationTarget('a'.repeat(8193)));
});
