import { describe, expect, it } from 'vitest';
import * as C from '../src/whiteboard-miro';

describe('Miro direct import contracts', () => {
  it('only accepts bounded relative Board return paths and list pages', () => {
    expect(C.StartMiroOAuthInput.parse({ returnTo:'/studio/board' }).returnTo).toBe('/studio/board');
    for (const returnTo of ['https://evil.test/x','//evil.test/x','/admin','/studio/board#token']) {
      expect(C.StartMiroOAuthInput.safeParse({ returnTo }).success).toBe(false);
    }
    expect(C.ListMiroBoardsQuery.parse({ limit:'50', offset:'10' })).toEqual({ limit:50, offset:10 });
    expect(C.ListMiroBoardsQuery.safeParse({ limit:51 }).success).toBe(false);
  });
  it('never exposes OAuth credential fields in response schemas', () => {
    const responseKeys = Object.keys(C.MiroConnection.shape).concat(Object.keys(C.StartMiroOAuthResult.shape));
    expect(responseKeys.join(' ')).not.toMatch(/token|secret|credential/i);
  });
});
