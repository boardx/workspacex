import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createConnection } from '@playwright/mcp';
import { describe, expect, it } from 'vitest';

describe('pinned Microsoft Playwright MCP 0.0.80 contract', () => {
  it('exposes the five W10 upstream tools with the fields used by the adapter', async () => {
    const server = await createConnection({ capabilities: ['core', 'network'], imageResponses: 'omit', codegen: 'none' }, async () => {
      throw new Error('browser context must not be requested while listing schemas');
    });
    const client = new Client({ name: 'workspacex-browser-contract-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const tools = new Map((await client.listTools()).tools.map(tool => [tool.name, tool.inputSchema]));
      expect([...tools.keys()]).toEqual(expect.arrayContaining(['browser_navigate', 'browser_snapshot', 'browser_click', 'browser_fill_form', 'browser_take_screenshot', 'browser_resize', 'browser_route', 'browser_unroute']));
      expect(tools.get('browser_navigate')).toMatchObject({ required: ['url'], properties: { url: { type: 'string' } } });
      expect(tools.get('browser_click')).toMatchObject({ required: ['target'], properties: { target: { type: 'string' }, element: { type: 'string' } } });
      expect(tools.get('browser_fill_form')).toMatchObject({ required: ['fields'], properties: { fields: { type: 'array', items: { required: expect.arrayContaining(['target', 'name', 'type', 'value']) } } } });
      expect(tools.get('browser_fill_form')).toMatchObject({ properties: { fields: { items: { properties: { value: { type: 'string' } } } } } });
      expect(tools.get('browser_take_screenshot')).toMatchObject({ properties: { filename: {}, type: {}, fullPage: {}, scale: {} } });
      expect(tools.get('browser_resize')).toMatchObject({ required: ['width', 'height'], properties: { width: { type: 'number' }, height: { type: 'number' } } });
      expect(tools.get('browser_route')).toMatchObject({ required: ['pattern'], properties: { body: { type: 'string' }, contentType: { type: 'string' } } });
      expect(tools.get('browser_unroute')).toMatchObject({ properties: { pattern: { type: 'string' } } });
    } finally {
      await client.close();
    }
  });
});
