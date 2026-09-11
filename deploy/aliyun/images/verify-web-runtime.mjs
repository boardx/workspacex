import assert from "node:assert/strict";
const base = "http://127.0.0.1:3000";
const response = await fetch(base, { signal: AbortSignal.timeout(10_000) });
assert.equal(response.status, 200);
const html = await response.text();
assert.match(html, /WorkspaceX/);
const stylesheets = [...html.matchAll(/href="([^"\s]+\.css(?:\?[^"\s]*)?)"/g)].map(match => new URL(match[1], base));
assert.ok(stylesheets.length > 0);
const fonts = new Set();
let css = "";
for (const url of stylesheets) {
  assert.equal(url.origin, base);
  const sheet = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  assert.equal(sheet.status, 200);
  const text = await sheet.text();
  css += text;
  for (const match of text.matchAll(/url\(["']?([^\s"')]+\.woff2)["']?\)/g)) fonts.add(new URL(match[1], url).href);
}
for (const family of ["Noto Sans SC Variable", "JetBrains Mono Variable", "Bitter Variable"]) assert.ok(css.includes(family), `missing ${family}`);
assert.ok(fonts.size >= 3);
for (const url of fonts) {
  assert.equal(new URL(url).origin, base);
  const font = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  assert.equal(font.status, 200);
  assert.equal(Buffer.from(await font.arrayBuffer()).subarray(0, 4).toString(), "wOF2");
}
process.stdout.write(`Web image: HTML, CSS and ${fonts.size} same-origin font assets passed\n`);
