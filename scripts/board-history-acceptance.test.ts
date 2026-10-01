import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { historyAckPattern } from '../apps/web/e2e/support/board-history-acceptance';

test('history acceptance admits only the correct server-confirmed action with positive sequence', () => {
  for (const kind of ['撤销', '重做'] as const) {
    const pattern = historyAckPattern(kind);
    for (const seq of ['1', '12345']) assert.equal(pattern.test(`${kind}已由服务器确认 · 序列 ${seq}`), true);
    for (const text of ['已撤销本地修改', `${kind}已在本地应用，正在等待服务器确认`, `${kind}已由服务器确认`, `${kind}已由服务器确认 · 序列 0`, `${kind}已由服务器确认 · 序列 -1`, `${kind}已由服务器确认 · 序列 1.5`, `${kind}已由服务器确认 · 序列 1 项修改待确认`, '连接中断', '没有可撤销的本地修改。']) assert.equal(pattern.test(text), false, text);
    assert.equal(pattern.test(`${kind === '撤销' ? '重做' : '撤销'}已由服务器确认 · 序列 1`), false);
  }
});
test('both scenarios retain receipt, peer, original-ID restoration and durable reload checks', () => {
  for (const file of ['board-thinking-input', 'board-visual-content']) {
    const source = readFileSync(new URL(`../apps/web/e2e/${file}.spec.ts`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /已撤销本地修改/);
    for (const kind of ['撤销', '重做']) assert.ok(source.includes(`applyAcknowledgedHistory(page, "${kind}")`));
    assert.ok(source.includes('readBoardProjection(peer)).toEqual(beforeLastCreation)'));
    assert.ok(source.includes('readBoardProjection(peer)).toEqual(afterLastCreation)'));
    const reload = source.slice(source.indexOf('await page.reload()'));
    assert.ok(reload.includes('readBoardProjection(page)).toEqual(afterLastCreation)'));
  }
});
test('navigation checks whole shell and exact measured banner/editor partition, not a 27px allowance', () => {
  const source = readFileSync(new URL('../apps/web/e2e/board-library-management.spec.ts', import.meta.url), 'utf8');
  assert.ok(source.includes('expect(shell).toEqual({ x: 0, y: 0, width: 1280, height: 800 })'));
  assert.ok(source.includes('height: 800 - banner!.height'));
  assert.ok(source.includes('expect(editor).toEqual(bounds)'));
  assert.doesNotMatch(source, /(?:height|y): 27\b/);
});
