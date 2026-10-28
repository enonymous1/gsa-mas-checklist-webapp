import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import vm from 'node:vm';
import { loadClientScripts } from './gas-mocks.mjs';

function clientContext() {
  const sandbox = { console, URL };
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);
  loadClientScripts(context, 'ui.html', 'checklist_client.html');
  return context;
}

// Call a function inside the vm context with host values, passing
// arguments as JSON literals so quotes in test strings cannot break
// the evaluated snippet.
function call(context, name, ...args) {
  const expr = `${name}(${args.map((a) => JSON.stringify(a)).join(',')})`;
  return vm.runInContext(expr, context);
}

describe('escapeHtml / escapeAttr', () => {
  it('escapes markup, quotes, and ampersands', () => {
    const context = clientContext();
    assert.equal(
      call(context, 'escapeHtml', '<script>alert("x")</script> & \'quoted\''),
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;quoted&#39;',
    );
    assert.equal(call(context, 'escapeAttr', null), '');
    assert.equal(call(context, 'escapeHtml', 42), '42');
  });
});

describe('isSafeHttpUrl', () => {
  it('allows http and https only', () => {
    const context = clientContext();
    assert.equal(call(context, 'isSafeHttpUrl', 'https://example.test/a?b=1'), true);
    assert.equal(call(context, 'isSafeHttpUrl', 'http://example.test/'), true);
    assert.equal(call(context, 'isSafeHttpUrl', 'javascript:alert(1)'), false);
    assert.equal(call(context, 'isSafeHttpUrl', 'data:text/html,<b>x</b>'), false);
    assert.equal(call(context, 'isSafeHttpUrl', ''), false);
    assert.equal(call(context, 'isSafeHttpUrl', 'example.test/page'), false);
  });
});

describe('formatCommentText', () => {
  it('escapes comment markup and linkifies only http(s) URLs', () => {
    const context = clientContext();
    const out = call(
      context,
      'formatCommentText',
      '<img src=x onerror=alert(1)> see https://example.test/doc?a=1&b=2 and javascript:alert(2)',
    );
    assert.match(out, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.match(out, /<a href="https:\/\/example\.test\/doc\?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">https:\/\/example\.test\/doc\?a=1&amp;b=2<\/a>/);
    assert.doesNotMatch(out, /&amp;amp;/, 'href must not be double-escaped');
    assert.match(out, /javascript:alert\(2\)/);
    assert.doesNotMatch(out, /<a href="javascript:/);
    assert.doesNotMatch(out, /<img/);
  });

  it('leaves plain text unchanged apart from escaping', () => {
    const context = clientContext();
    assert.equal(
      call(context, 'formatCommentText', 'No links here & nothing <weird>'),
      'No links here &amp; nothing &lt;weird&gt;',
    );
  });
});
