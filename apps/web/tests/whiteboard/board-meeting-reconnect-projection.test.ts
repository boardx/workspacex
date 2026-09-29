import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

const source = readFileSync(
  new URL('../../e2e/board-meeting-room-acceptance.spec.ts', import.meta.url),
  'utf8',
);

describe('meeting-room reconnect evidence producer', () => {
  it('waits for canonical display content after reload before recording or sampling', () => {
    const reconnectStart = source.indexOf("await contexts[1]!.setOffline(false)");
    const reconnectEvent = source.indexOf("record('reconnect'", reconnectStart);
    const sampleProjection = source.indexOf('const displays =', reconnectEvent);
    const reconnectBlock = source.slice(reconnectStart, reconnectEvent);

    expect(reconnectStart).toBeGreaterThanOrEqual(0);
    expect(reconnectEvent).toBeGreaterThan(reconnectStart);
    expect(sampleProjection).toBeGreaterThan(reconnectEvent);
    expect(reconnectBlock).toContain('await display!.reload()');
    expect(reconnectBlock).toContain('await expect.poll(() => canonicalRows(display!)');
    expect(reconnectBlock).toContain('timeout: 30_000');
    expect(reconnectBlock).toContain('}).toEqual(canonicalContent)');
  });
});
