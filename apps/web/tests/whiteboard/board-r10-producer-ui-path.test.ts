import {readFileSync} from 'node:fs';
import {it,expect} from 'vitest';
const read=(name:string)=>readFileSync(new URL(`../../e2e/${name}`,import.meta.url),'utf8');
it('accepts only the actual settled status, with or without an ACK sequence',()=>{
 const source=read('support/board-sync-status.ts'),producer=read('board-performance-acceptance.spec.ts'),support=read('board-acceptance-support.ts');
 const regex=source.match(/BOARD_SYNCED_STATUS = (\/\^已同步.*?\/);/);
 expect(producer).toContain("import {expectBoardSynced} from './support/board-sync-status'");
 expect(producer).toContain('await expectBoardSynced(page,120_000)');
 expect(support).toContain('await expectBoardSynced(page,30_000)');
 expect(source).toContain("expectBoardSynced(page:Page,timeout?:number,allowReadOnly=false)");
 expect(source).toContain("getByTestId('board-sync-status')");
 expect(source).toContain("await expect(status).toBeVisible({timeout})");
 expect(source).toContain("await expect(status.locator('svg')).toBeVisible({timeout})");
 expect(source).toContain("toHaveAttribute('data-sync-phase','synced',{timeout})");
 expect(source).toContain("toHaveAttribute('aria-label',allowReadOnly?");
 expect(source).toContain(':BOARD_SYNCED_STATUS,{timeout})');
 expect(regex).not.toBeNull();
 const status=new RegExp(regex![1]!.slice(1,-1));
 for(const text of ['已同步','已同步 · 序列 42'])expect(status.test(text)).toBe(true);
 for(const text of ['正在连接','2 项修改等待服务器确认','连接中断','已同步 · 序列 NaN','已同步错误'])expect(status.test(text)).toBe(false);
});
it('uses real warmup placement before the timer without reducing the measured simultaneous writer burst',()=>{
 const source=read('board-collaboration-soak.spec.ts'),helper=read('support/board-soak-canvas-create.ts');
 expect(source.indexOf('await createSoakWriterNote')).toBeLessThan(source.indexOf('const startedWall'));
 expect(source).toContain('await Promise.all(writers.map(async (client, index) => {');
 expect(helper.indexOf("getByTestId('board-add-sticky').click()")).toBeLessThan(helper.indexOf('await page.mouse.click(point!.x,point!.y)'));
 expect(helper.indexOf('await page.mouse.click(point!.x,point!.y)')).toBeLessThan(helper.indexOf('await editor.fill(label)'));
 expect(helper).toContain('await expect(editor).toBeFocused()');expect(helper).not.toMatch(/api\.post|route\(|dispatchEvent|\.evaluate\([^]*getMap/);
});
it('keeps acceptance pointer gestures in bounds and reserves a measured startup window for the heavy performance producer',()=>{
 const journey=read('board-final-acceptance.spec.ts'),performance=read('board-performance-acceptance.config.ts');
 expect(journey).toContain("{name: 'C', dx: -24}");
 expect(journey).not.toContain("for (const name of ['A', 'B', 'C'])");
 expect(performance).toContain('BOARD_PERFORMANCE_SERVER_TIMEOUT_MS ?? 360_000');
 expect(performance).toContain('server?.timeout === 30_000 ? server.timeout');
});
