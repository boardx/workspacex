import {describe, expect, it} from 'vitest';
import {isBoardFileUploadResponse} from '../../e2e/support/board-file-upload-response';

const api = 'http://127.0.0.1:39001', web = 'http://127.0.0.1:39002';
const board = 'owned-board', path = `/whiteboards/${board}/files`;
const matches = (url: string, method = 'POST') => isBoardFileUploadResponse(method, url, board, api, web);
describe('R09 upload response identity', () => {
  it('accepts the actual web proxy POST and the direct API POST for this board', () => {
    const proxyUrl = `${web}/__fullstack_api${path}`;
    const originalMatches = (url: string) => url === `${api}${path}`;
    expect(originalMatches(proxyUrl), 'the original exact API URL predicate misses the successful proxied upload').toBe(false);
    expect(matches(proxyUrl)).toBe(true);
    expect(matches(`${api}${path}`)).toBe(true);
  });
  it.each([
    ['GET', `${web}/__fullstack_api${path}`],
    ['POST', `${web}/__fullstack_api/whiteboards/another-board/files`],
    ['POST', `${web}/__fullstack_api${path}/asset/content`],
    ['POST', `${web}/__fullstack_api${path}?board=another-board`],
    ['POST', `${web}/__fullstack_api${path}#fragment`],
    ['POST', `http://foreign.invalid/__fullstack_api${path}`],
    ['POST', `http://127.0.0.1:39003/__fullstack_api${path}`],
    ['POST', `${web}${path}`],
    ['POST', `${api}/__fullstack_api${path}`],
    ['POST', `http://user:password@127.0.0.1:39002/__fullstack_api${path}`],
    ['POST', 'not a URL'],
  ])('rejects mismatched method/origin/board/route: %s %s', (method, url) => {
    expect(matches(url, method)).toBe(false);
  });
});
