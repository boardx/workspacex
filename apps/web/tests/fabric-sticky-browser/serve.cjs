// Owns only a temporary component bundle and this loopback HTTP listener.
const { createServer } = require('node:http');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve, dirname } = require('node:path');
const { createRequire } = require('node:module');
const web = resolve(__dirname, '../..');
const root = resolve(web, '../..');
const rootRequire = createRequire(join(root, 'package.json'));
const esbuild = require(rootRequire.resolve('esbuild', { paths: [dirname(rootRequire.resolve('tsx'))] }));
const output = mkdtempSync(join(tmpdir(), 'chat-sticky-browser-'));
const port = Number(process.env.CHAT_STICKY_BROWSER_PORT || '32797');
esbuild.buildSync({
  entryPoints: [join(__dirname, 'entry.ts')], bundle: true, platform: 'browser', format: 'iife',
  outfile: join(output, 'bundle.js'),
  alias: { '@repo/fabric-markdown': join(root, 'packages/fabric-markdown/src/index.ts') },
});
const server = createServer((request, response) => {
  if (request.url === '/bundle.js') {
    response.setHeader('Content-Type', 'application/javascript');
    response.end(readFileSync(join(output, 'bundle.js')));
  } else if (request.url === '/') {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(readFileSync(join(__dirname, 'index.html')));
  } else { response.statusCode = 404; response.end(); }
});
function cleanup() { rmSync(output, { recursive: true, force: true }); }
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => { cleanup(); process.exit(0); }));
process.on('exit', cleanup);
server.listen(port, '127.0.0.1');
