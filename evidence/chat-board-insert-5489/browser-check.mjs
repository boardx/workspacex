// Real production React components and design tokens, deterministic API fixture only.
// Run from repository root: node evidence/chat-board-insert-5489/browser-check.mjs
import {createRequire} from 'node:module';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
const root=process.cwd(),out=join(root,'evidence/chat-board-insert-5489');
const require=createRequire(join(root,'node_modules/.pnpm/node_modules/placeholder.js'));
const webRequire=createRequire(join(root,'apps/web/package.json'));
const {build}=require('esbuild'),{chromium,expect}=webRequire('@playwright/test');
const temp=await mkdtemp(join(tmpdir(),'chat-board-placement-'));
await writeFile(join(temp,'fixture.ts'),`
export const listBoards=async()=>({items:[{id:'a',name:'产品研究工作台'},{id:'b',name:'空白工作台'}]});
export const readBoardPlacementPreview=async(boardId)=>({boardId,revision:{epoch:1,seq:7},role:'owner',archived:false,objects:boardId==='b'?[]:[
  {id:'1',geometry:{x:0,y:0,width:360,height:220,rotation:0}},
  {id:'2',geometry:{x:420,y:0,width:300,height:220,rotation:0}},
  {id:'3',geometry:{x:0,y:300,width:420,height:260,rotation:0}}]});
export const insertRenderedArtifact=async(input)=>{window.__inserts.push(input);return {};};
`);
await writeFile(join(temp,'entry.tsx'),`
import React from '${root}/apps/web/node_modules/react/index.js';
import {createRoot} from '${root}/apps/web/node_modules/react-dom/client.js';
import {templateToModel} from '${root}/packages/fabric-markdown/src/templates-entry.ts';
import {ChatDiagramBoardHandoff} from '${root}/apps/web/components/chat/chat-diagram-board-handoff.tsx';
window.__inserts=[];
const model=templateToModel('模板: jtbd\\n执行者: 大学生\\n\\n## 情境触发\\n- 寻找实习\\n\\n## 核心任务\\n- 准备作品集');
createRoot(document.getElementById('root')).render(<main className="p-8"><ChatDiagramBoardHandoff model={model} artifactId="fixture-jtbd" orgId="fixture-org" sourceRevision="artifact-v1:1"/></main>);
`);
await build({entryPoints:[join(temp,'entry.tsx')],bundle:true,outfile:join(temp,'app.js'),jsx:'automatic',platform:'browser',
  tsconfig:join(root,'apps/web/tsconfig.json'),nodePaths:[join(root,'apps/web/node_modules')],
  alias:{'@/lib/live-whiteboard':join(temp,'fixture.ts'),'@/lib/whiteboard-operation-client':join(temp,'fixture.ts'),'@':join(root,'apps/web')},
  define:{'process.env.NODE_ENV':'"development"'}});
execFileSync('pnpm',['exec','tailwindcss','-c','tailwind.config.ts','-i','app/globals.css','-o',join(temp,'style.css'),'--content','components/chat/chat-diagram-board-handoff.tsx,components/chat/chat-board-placement-preview.tsx,components/ui/**/*.tsx'],{cwd:join(root,'apps/web'),stdio:'pipe'});
const server=createServer(async(req,res)=>{
  const path=req.url==='/app.js'?'app.js':req.url==='/style.css'?'style.css':null;
  res.setHeader('Content-Type',path==='app.js'?'application/javascript; charset=utf-8':path==='style.css'?'text/css; charset=utf-8':'text/html; charset=utf-8');
  res.end(path?await readFile(join(temp,path)):'<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/app.js"></script></html>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true}),page=await browser.newPage();
const errors=[];page.on('pageerror',error=>{errors.push(error.message);console.error(error.message);});
const url=`http://127.0.0.1:${server.address().port}`;
try{
  for(const width of [1280,768,375]){
    await page.setViewportSize({width,height:900});await page.goto(url);
    await page.getByTestId('chat-diagram-insert-board').click();
    await expect(page.getByTestId('chat-board-handoff-confirm')).toBeEnabled();
    await expect(page.getByLabel('X 坐标')).toHaveCount(0);
    await expect(page.getByLabel('Y 坐标')).toHaveCount(0);
    await page.screenshot({path:join(out,`placement-${width}.png`),fullPage:true});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const preview=page.getByTestId('chat-board-placement-preview'),box=await preview.boundingBox();
    const range=page.getByTestId('chat-board-placement-range'),rangeBox=await range.boundingBox(),before=await range.getAttribute('x');
    await page.mouse.move(rangeBox.x+rangeBox.width*.2,rangeBox.y+rangeBox.height*.2);await page.mouse.down();
    expect(Number(await range.getAttribute('x'))).toBeCloseTo(Number(before),6);
    await page.mouse.move(rangeBox.x+rangeBox.width*.2+15,rangeBox.y+rangeBox.height*.2+10,{steps:3});
    expect(Number(await range.getAttribute('x'))).toBeGreaterThan(Number(before));
    await preview.dispatchEvent('pointercancel');await page.mouse.up();
    expect(Number(await range.getAttribute('x'))).toBeCloseTo(Number(before),6);
    await page.mouse.move(box.x+box.width*.75,box.y+box.height*.5);await page.mouse.down();
    await page.mouse.move(box.x+box.width*.7,box.y+box.height*.55,{steps:4});await page.mouse.up();
    const moved=await page.getByTestId('chat-board-placement-range').getAttribute('x');
    await preview.focus();await page.keyboard.press('ArrowRight');
    expect(await page.getByTestId('chat-board-placement-range').getAttribute('x')).not.toBe(moved);
    await page.getByText('取消',{exact:true}).click();
    expect(await page.evaluate(()=>window.__inserts.length)).toBe(0);
    await page.getByTestId('chat-diagram-insert-board').click();await expect(page.getByTestId('chat-board-handoff-confirm')).toBeEnabled();
    await page.getByTestId('chat-board-target').click();await page.getByRole('menuitemradio',{name:'空白工作台'}).click();
    await expect(page.getByTestId('chat-board-handoff-confirm')).toBeEnabled();
    await page.getByTestId('chat-board-handoff-confirm').click();await expect(page.getByText('已插入目标白板')).toBeVisible();
    const inserted=await page.evaluate(()=>window.__inserts[0]);
    expect(inserted.boardId).toBe('b');expect(inserted.layout.diagramKind).toBe('template');
    expect(inserted.layout.objects.some(object=>object.text==='寻找实习')).toBe(true);
  }
  expect(errors).toEqual([]);
  await writeFile(join(out,'browser-results.json'),JSON.stringify({fixture:'production UI, mocked Board API',viewports:[1280,768,375],checks:['no coordinate inputs','pointer drag without grab jump','pointer cancellation restores placement','keyboard placement','cancel does not insert','target switch','JTBD submission','no horizontal overflow','no browser exceptions'],errors},null,2));
  console.log('Browser placement checks passed at 1280 / 768 / 375.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));await rm(temp,{recursive:true,force:true});}
