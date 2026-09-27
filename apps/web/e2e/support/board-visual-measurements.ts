import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {expect, type Page, type TestInfo} from '@playwright/test';
export const visualViewports = [{width:1440,height:900},{width:1280,height:720},{width:1024,height:768}] as const;
export const sha256 = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
export function validateVisualMeasurement(value: {canvasAvailable:number;toolbarCount:number;toolbarHeight:number; controls:Array<{name:string;width:number;height:number;reachable:boolean}>}) {
  const failures:string[]=[];
  if (!Number.isFinite(value.canvasAvailable) || value.canvasAvailable < .8) failures.push('CANVAS_OCCLUDED');
  if (value.toolbarCount > 1 || value.toolbarHeight > 64) failures.push('CONTEXT_TOOLBAR');
  if (value.controls.length !== 4 || value.controls.some(control=>control.width<44 || control.height<44 || !control.reachable)) failures.push('CORE_CONTROL_UNREACHABLE');
  return failures;
}
export async function visualMeasurement(page:Page) {
  return page.evaluate(()=>{
    const surface=document.querySelector<HTMLElement>('[data-testid="board-fabric-surface"]');
    if(!surface)throw new Error('FABRIC_SURFACE_REQUIRED');
    const box=surface.getBoundingClientRect();let available=0,total=0;
    for(let y=box.top+8;y<box.bottom;y+=16)for(let x=box.left+8;x<box.right;x+=16){total++;const hit=document.elementFromPoint(x,y);if(hit instanceof HTMLCanvasElement&&hit.dataset.fabric==='top')available++;}
    const bars=[...document.querySelectorAll<HTMLElement>('[data-testid="board-context-toolbar"]')].filter(e=>e.getBoundingClientRect().height);
    const controls=['board-add-sticky','board-add-shape','board-add-draw','board-add-connector'].map(name=>{
      const element=document.querySelector<HTMLElement>(`[data-testid="${name}"]`);if(!element)return{name,width:0,height:0,reachable:false};
      const rect=element.getBoundingClientRect(),hit=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2);
      return{name,width:rect.width,height:rect.height,reachable:Boolean(hit&&element.contains(hit))};
    });
    const editor=document.querySelector<HTMLTextAreaElement>('textarea[aria-label="对象文字"]');
    const editorRect=editor?.getBoundingClientRect();
    const editorHit=editorRect?document.elementFromPoint(editorRect.x+editorRect.width/2,editorRect.y+editorRect.height/2):null;
    const editorReachable=editorRect?Boolean(editorHit&&editor!.contains(editorHit)):null;
    const focused=document.activeElement as HTMLElement|null;
    return{editorReachable,canvasAvailable:available/total,toolbarCount:bars.length,toolbarHeight:Math.max(0,...bars.map(e=>e.getBoundingClientRect().height)),controls,
      focus:{tag:focused?.tagName,name:focused?.getAttribute('aria-label'),testId:focused?.dataset.testid},
      viewport:{width:innerWidth,height:innerHeight},scroll:{width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight},
      editorFontSize:document.querySelector('textarea')?getComputedStyle(document.querySelector('textarea')!).fontSize:null};
  });
}
export async function captureVisual(page:Page,info:TestInfo,label:string,strict=true) {
  const measurement=await visualMeasurement(page),bytes=await page.screenshot({fullPage:false}),path=info.outputPath(`${label}.png`);
  await writeFile(path,bytes);await info.attach(label,{path,contentType:'image/png'});
  const failures=strict?validateVisualMeasurement(measurement):[];
  if(measurement.editorReachable===false)failures.push('EDITOR_TEXT_OCCLUDED');
  expect.soft(failures,`${label}: real hit-test/space measurements`).toEqual([]);
  return{label,screenshot:{path,sha256:sha256(bytes)},measurement,failures,at:new Date().toISOString()};
}
