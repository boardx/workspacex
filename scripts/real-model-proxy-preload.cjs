// Explicit development process only. Route the configured model's origin via
// this environment's existing proxy; leave loopback and all other origins alone.
const { createRequire } = require('node:module');
const { resolve } = require('node:path');
const apiRequire = createRequire(resolve(__dirname, '../apps/api/package.json'));
const undici = apiRequire('undici');
const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
const modelBase = process.env.KERNEL_MODEL_BASE_URL;
if (proxy && modelBase && process.env.WORKSPACEX_REAL_MODEL_DEV_OPT_IN === '1') {
  const allowedOrigin = new URL(modelBase).origin;
  const dispatcher = new undici.ProxyAgent(proxy);
  const original = undici.fetch;
  undici.fetch = (input, options) => {
    const url = typeof input === 'string' || input instanceof URL ? input : input.url;
    return original(input, new URL(url).origin === allowedOrigin ? { ...options, dispatcher } : options);
  };
}
