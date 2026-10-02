import {readFileSync} from 'node:fs';
import {it,expect,vi} from 'vitest';
import {expectBoardSynced} from '../../e2e/support/board-sync-status';
vi.mock('@playwright/test',()=>({expect:(value:{visible:boolean;attributes:Record<string,string>})=>({
 toBeVisible:async()=>{if(!value.visible)throw new Error('not visible');},
 toHaveAttribute:async(name:string,wanted:string|RegExp)=>{
  const actual=value.attributes[name];
  if(typeof wanted==='string'?actual!==wanted:!wanted.test(actual??''))throw new Error(`invalid ${name}`);
 },
})}));
const read=(name:string)=>readFileSync(new URL(`../../e2e/${name}`,import.meta.url),'utf8');
it('accepts only the actual settled status, with or without an ACK sequence',()=>{
 const source=read('support/board-sync-status.ts');const regex=source.match(/BOARD_SYNCED_STATUS = (\/\^已同步.*?\/);/);
 for(const producer of ['board-performance-acceptance.spec.ts','board-acceptance-support.ts']){
  expect(read(producer)).toContain('await expectBoardSynced(page,');
  expect(read(producer)).not.toContain('getByText(BOARD_SYNCED_STATUS)');
 }
 expect(regex).not.toBeNull();
 const status=new RegExp(regex![1]!.slice(1,-1));
 for(const text of ['已同步','已同步 · 序列 42'])expect(status.test(text)).toBe(true);
 for(const text of ['正在连接','2 项修改等待服务器确认','连接中断','已同步 · 序列 NaN','已同步错误'])expect(status.test(text)).toBe(false);
});
it('rejects unsettled, hidden, malformed and implicit readonly states through the actual helper',async()=>{
 const pageFor=(label='已同步',phase='synced',visible=true,iconVisible=true)=>({getByTestId:(id:string)=>{
  expect(id).toBe('board-sync-status');
  return {visible,attributes:{'aria-label':label,'data-sync-phase':phase},locator:(selector:string)=>{
   expect(selector).toBe('svg');return {visible:iconVisible,attributes:{}};
  }};
 }}) as unknown as Parameters<typeof expectBoardSynced>[0];
 for(const label of ['已同步','已同步 · 序列 42'])await expect(expectBoardSynced(pageFor(label))).resolves.toBeUndefined();
 for(const page of [pageFor('已同步','pending'),pageFor('已同步','connecting'),pageFor('已同步','offline'),
  pageFor('已同步','synced',false),pageFor('已同步','synced',true,false),
  pageFor('2 项修改等待服务器确认'),pageFor('已同步 · 序列 NaN'),pageFor('已同步错误'),pageFor('已同步 · 只读')]){
  await expect(expectBoardSynced(page)).rejects.toThrow();
 }
 await expect(expectBoardSynced(pageFor('已同步 · 序列 42 · 只读'),undefined,true)).resolves.toBeUndefined();
 await expect(expectBoardSynced(pageFor('已同步错误'),undefined,true)).rejects.toThrow();
 await expect(expectBoardSynced(pageFor('已同步 · 只读','pending'),undefined,true)).rejects.toThrow();
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
