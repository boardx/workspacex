import http from 'node:http';

// Fixed destination only: this is an MCP ingress, never an HTTP forward proxy.
const server = http.createServer((request, response) => {
  const host = request.headers.host ?? '';
  if (!/^(127\.0\.0\.1|localhost):[0-9]+$/.test(host) || request.headers.origin) {
    response.writeHead(403).end();
    return;
  }
  if (!['/mcp', '/mcp/'].includes((request.url ?? '').split('?')[0])) {
    response.writeHead(404).end();
    return;
  }
  const upstream = http.request({
    hostname: 'browser-runtime', port: 8931, path: request.url,
    method: request.method,
    headers: { ...request.headers, host: 'localhost:8931' },
  }, (incoming) => {
    response.writeHead(incoming.statusCode ?? 502, incoming.headers);
    incoming.pipe(response);
  });
  upstream.on('error', () => {
    if (!response.headersSent) response.writeHead(502);
    response.end();
  });
  request.on('aborted', () => upstream.destroy());
  response.on('close', () => upstream.destroy());
  request.pipe(upstream);
});
server.requestTimeout = 30_000;
server.headersTimeout = 10_000;
server.listen(8931, '0.0.0.0');
