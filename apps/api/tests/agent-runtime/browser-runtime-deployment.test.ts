import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../../../browser-runtime/', import.meta.url);
const compose = readFileSync(new URL('docker-compose.browser.yml', root), 'utf8');
const squid = readFileSync(new URL('squid.conf', root), 'utf8');

describe('controlled browser runtime deployment', () => {
  it('has no unsafe image, network, MCP binding, or browser-context default', () => {
    expect(compose).toContain('mcr.microsoft.com/playwright/mcp@sha256:${BROWSER_RUNTIME_IMAGE_DIGEST:?');
    expect(compose).toContain('ubuntu/squid@sha256:${BROWSER_EGRESS_PROXY_IMAGE_DIGEST:?');
    expect(compose).toContain('127.0.0.1:${BROWSER_MCP_PORT:-58931}:8931');
    expect(compose).toMatch(/browser_control:\n    internal: true/);
    expect(compose.match(/browser-runtime:[\s\S]*?networks:\n      - browser_control\n/)).toBeTruthy();
    expect(compose).toContain('--proxy-server');
    expect(compose).toContain('"<-loopback>"');
    expect(compose).toContain('--isolated');
    expect(compose).toContain('--sandbox');
    expect(compose).toMatch(/--caps\n      - network/);
    expect(compose).not.toContain('--no-sandbox');
    expect(compose).not.toContain('--shared-browser-context');
    expect(compose).not.toContain('--allowed-hosts\n      - "*"');
  });

  it('makes the only public-network peer deny private and mapped destinations', () => {
    expect(compose.match(/browser-egress:[\s\S]*?- browser_control\n      - browser_public/)).toBeTruthy();
    for (const range of ['127.0.0.0/8', '169.254.0.0/16', '192.168.0.0/16', '::1/128', '::ffff:0:0/96', '64:ff9b::/96', 'fc00::/7', 'fe80::/10']) {
      expect(squid).toContain(range);
    }
    expect(squid).toContain('http_access deny blocked_v4');
    expect(squid).toContain('http_access deny blocked_v6');
  });
});
