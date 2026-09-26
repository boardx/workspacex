import { describe, expect, it } from 'vitest';
import { validateWhiteboardExtensionData } from '../src/whiteboard-document';

describe('whiteboard extension safety', () => {
  it('rejects binary aliases at every depth and all non-empty byte arrays', () => {
    for (const value of [
      { bytes: 'AQID' },
      { nested: { payload: 'AQIDBAU' } },
      { deep: { buffer: 'x' } },
      { arbitrary: [137, 80, 78, 71] },
    ]) expect(() => validateWhiteboardExtensionData(value)).toThrow('UNSAFE_EXTENSION_BINARY');
  });

  it('keeps normal short text in non-canonical extension namespaces compatible', () => {
    expect(() => validateWhiteboardExtensionData({ plugin: { opaque: 'AQIDBAU', label: 'safe' } })).not.toThrow();
  });
});
