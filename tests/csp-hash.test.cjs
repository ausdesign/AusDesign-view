'use strict';
// Run: node tests/csp-hash.test.cjs. No browser, network, or customer data needed.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const digest = text => crypto.createHash('sha256').update(text, 'utf8').digest('base64');
const fail = message => { throw new Error(message); };
function attrs(tag) {
  const result = {};
  const pattern = /([^\s=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>]+)))?/g;
  for (const m of tag.matchAll(pattern)) {
    const key = m[1].toLowerCase();
    if (Object.hasOwn(result, key)) fail('duplicate attribute');
    result[key] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return result;
}
function check(source) {
  // HTML input preprocessing normalizes line endings before CSP hashes are checked.
  const html = source.replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '');
  const policies = [...html.matchAll(/<meta\b([^>]*?)>/gi)]
    .map(m => attrs(m[1]))
    .filter(a => (a['http-equiv'] || '').toLowerCase() === 'content-security-policy');
  if (policies.length !== 1) fail('expected exactly one CSP meta');
  const cspIndex = html.search(/<meta\b[^>]*http-equiv\s*=\s*["']Content-Security-Policy["']/i);
  const firstScript = html.search(/<script\b/i);
  if (cspIndex < 0 || (firstScript >= 0 && cspIndex > firstScript)) fail('CSP must precede scripts');
  const directives = {};
  for (const entry of (policies[0].content || '').split(';')) {
    const words = entry.trim().split(/\s+/);
    if (!words[0]) continue;
    const name = words.shift().toLowerCase();
    if (Object.hasOwn(directives, name)) fail('duplicate CSP directive');
    directives[name] = words;
  }
  const sources = directives['script-src'];
  if (!sources || directives['script-src-elem']) fail('explicit script-src required; override unsupported');
  if (sources.some(x => /unsafe-inline|unsafe-hashes|nonce-/i.test(x))) fail('hash bypass not allowed');
  const listed = sources.filter(x => /^'sha256-[A-Za-z0-9+/]{43}='$/.test(x));
  if (sources.some(x => /sha(?:256|384|512)-/i.test(x) && !listed.includes(x))) fail('unsupported hash source');
  const expected = [];
  let scripts = 0;
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    scripts++;
    const a = attrs(m[1]);
    if ('src' in a) continue;
    if ('nonce' in a) fail('inline nonce unsupported');
    if (a.type && !/^(?:module|(?:text|application)\/(?:java|ecma)script)$/i.test(a.type)) {
      fail('inline script type needs explicit review');
    }
    expected.push("'sha256-" + digest(m[2]) + "'");
  }
  if (scripts !== (html.match(/<script\b/gi) || []).length) fail('unparsed script element');
  if (expected.length === 0) fail('expected inline script');
  if (new Set(listed).size !== listed.length) fail('duplicate hash');
  if (expected.some(hash => !listed.includes(hash))) fail('inline script hash mismatch');
  if (listed.some(hash => !expected.includes(hash))) fail('stale CSP hash');
  return expected.length;
}
let groups = 0;
for (const name of ['index.html', 'sign.html']) {
  const html = fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
  const count = check(html); groups++;
  const mustFail = (label, text) => {
    assert.throws(() => check(text), undefined, label); groups++;
  };
  mustFail('changed script', html.replace(/(<script>)/i, '$1\n/* changed */'));
  mustFail('wrong hash', html.replace(/sha256-[A-Za-z0-9+/=]+/, 'sha256-' + 'A'.repeat(43) + '='));
  mustFail('missing CSP', html.replace(/<meta\b[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/i, ''));
  mustFail('unsafe-inline bypass', html.replace("script-src ", "script-src 'unsafe-inline' "));
  mustFail('unhashed new script', html.replace('</body>', '<script>void 0;</script></body>'));
  mustFail('override', html.replace('script-src ', "script-src-elem 'unsafe-inline'; script-src "));
  mustFail('duplicate policy', html.replace(/(<meta\b[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>)/i, '$1$1'));
  mustFail('stale extra hash', html.replace('script-src ', "script-src 'sha256-" + 'B'.repeat(43) + "=' "));
  mustFail('nonce bypass', html.replace('script-src ', "script-src 'nonce-sample' "));
  assert.equal(check(html.replace(/\r?\n/g, '\r\n')), count); groups++;
  console.log(name + ': CSP hashes match; mutation guards pass');
}
console.log('PASS ' + groups + ' groups');
