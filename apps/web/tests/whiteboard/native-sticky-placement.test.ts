// @vitest-environment jsdom
import {describe,it,expect,vi} from 'vitest';
import {createElement,useState} from 'react';
import {render,fireEvent,cleanup} from '@testing-library/react';
import {createWhiteboardDocument,executeCommands,readObjects} from '@repo/whiteboard-core';
import {BoardSelectedObjectPanel} from '../../components/whiteboard/board-selected-object-panel';
import diagnosticPolicy from '../../scripts/board-ci-diagnostic-policy.json';
import {nativeBlankCandidates,nativeBlankHitPoint} from '../../e2e/support/board-native-sticky-create';

describe('native Sticky click placement',()=>{
  const canvas={x:0,y:64,width:320,height:656},viewport={width:320,height:720};
  it('finds a real narrow-screen click without requiring a future tile footprint',()=>{
    const points=nativeBlankCandidates({canvas,viewport,occupied:[],chrome:[]});
    expect(points.length).toBeGreaterThan(0);expect(points.every(p=>p.x>0&&p.x<320&&p.y>64&&p.y<720)).toBe(true);
  });
  it('rejects chrome and projected rotated-object bounding boxes',()=>{
    const chrome=[{x:0,y:64,width:160,height:656}],occupied=[{x:160,y:64,width:160,height:300}];
    const points=nativeBlankCandidates({canvas,viewport,occupied,chrome});
    expect(points.length).toBeGreaterThan(0);expect(points.every(p=>p.x>160&&p.y>376)).toBe(true);
  });
  it('avoids the active multi-selection envelope including empty gaps',()=>{
    const occupied=[{x:96,y:240,width:32,height:32},{x:224,y:480,width:32,height:32}];
    const input={canvas,viewport,occupied,chrome:[]};
    const unselected=nativeBlankCandidates(input);
    expect(unselected.some(p=>p.x>=96&&p.x<=256&&p.y>=240&&p.y<=512)).toBe(true);
    const selected=nativeBlankCandidates({...input,selection:occupied});
    expect(selected.length).toBeGreaterThan(0);
    expect(selected.every(p=>p.x<84||p.x>268||p.y<228||p.y>524)).toBe(true);
    expect(nativeBlankCandidates({...input,selection:[occupied[0]!]})).toEqual(unselected);
  });
  it('keeps a visible paper footprint clear of the fixed header',()=>{
    const points=nativeBlankCandidates({canvas,viewport,occupied:[],chrome:[{x:0,y:64,width:320,height:48}],paperMargin:80});
    expect(points.length).toBeGreaterThan(0);
    expect(points.every(p=>p.x>=80&&p.x<240&&p.y>192&&p.y<640)).toBe(true);
  });
  it('cannot invent a blank point when chrome covers the entire real canvas',()=>{
    expect(nativeBlankCandidates({canvas,viewport,occupied:[],chrome:[canvas]})).toEqual([]);
  });
  it('clips offscreen canvas bounds to the actual viewport',()=>{
    const points=nativeBlankCandidates({canvas:{x:-200,y:-100,width:600,height:1000},viewport,occupied:[],chrome:[]});
    expect(points.every(p=>p.x>=8&&p.x<312&&p.y>=8&&p.y<712)).toBe(true);
  });
});


describe('bounded native hit attribution',()=>{
  const geometry={canvas:{x:0,y:0,width:320,height:720},zoom:1,paperMargin:80,requestedPaperMargin:120,chrome:[]};
  const hitPolicy=diagnosticPolicy;
  const points=Array.from({length:12},(_,x)=>({x,y:200}));
  function observe(hit:Element,host:Element=document.createElement('div')){
    if(!host.querySelector('canvas.upper-canvas')){const canvas=document.createElement('canvas');canvas.className='upper-canvas';host.append(canvas);}
    const descriptor=Object.getOwnPropertyDescriptor(document,'elementFromPoint');
    Object.defineProperty(document,'elementFromPoint',{configurable:true,value:()=>hit});
    try{try{nativeBlankHitPoint(host,{points,geometry,hitPolicy});throw new Error('EXPECTED_NATIVE_REJECTION');}catch(error){
      const message=(error as Error).message;expect(message.startsWith('NO_NATIVE_BLANK_POSITION ')).toBe(true);
      return JSON.parse(message.slice('NO_NATIVE_BLANK_POSITION '.length));
    }}finally{if(descriptor)Object.defineProperty(document,'elementFromPoint',descriptor);else delete (document as unknown as Record<string,unknown>).elementFromPoint;}
  }
  it('skips private inner IDs and reports the nearest fixed allowlisted ancestor without leaking content',()=>{
    const dock=document.createElement('nav');dock.dataset.testid='board-creation-dock';
    const picker=document.createElement('div');picker.dataset.testid='board-tool-picker';dock.append(picker);
    const hit=document.createElement('button');hit.dataset.testid='private-object-credential';hit.textContent='private正文';hit.setAttribute('data-url','https://private.example');picker.append(hit);
    const result=observe(hit);expect(result.hits).toHaveLength(8);
    expect(result.hits.every((row:{control:string})=>row.control==='board-tool-picker')).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/private|正文|https/);
    expect(result.candidateCenters).toBe(12);expect(result.unobstructedCenters).toBe(0);
    expect(result.margin).toBe(80);expect(result.requestedPaperMargin).toBe(120);
  });
  it('reports foreign ancestry as OTHER and stops after sixteen elements',()=>{
    const hit=document.createElement('button');hit.dataset.testid='private-inner';
    expect(observe(hit).hits[0].control).toBe('OTHER');
    let ancestor:Element=hit;for(let i=0;i<16;i++){const parent=document.createElement('div');parent.append(ancestor);ancestor=parent;}
    ancestor.setAttribute('data-testid','board-tool-picker');
    expect(observe(hit).hits[0].control).toBe('OTHER');
  });
  it('rejects missing canvas even when elementFromPoint returns null',()=>{
    const descriptor=Object.getOwnPropertyDescriptor(document,'elementFromPoint');Object.defineProperty(document,'elementFromPoint',{configurable:true,value:()=>null});
    try{expect(()=>nativeBlankHitPoint(document.createElement('div'),{points,geometry,hitPolicy})).toThrow('MISSING_NATIVE_CANVAS');}finally{if(descriptor)Object.defineProperty(document,'elementFromPoint',descriptor);else delete (document as unknown as Record<string,unknown>).elementFromPoint;}
  });
  it.each(['board-context-toolbar','collaborative-editor','board-tool-popover'])('attributes private descendants to central stable marker %s',control=>{
    const ancestor=document.createElement('div');ancestor.dataset.testid=control;
    const hit=document.createElement('button');hit.dataset.testid='private-dynamic-id';ancestor.append(hit);
    const result=observe(hit);expect(result.hits[0].control).toBe(control);expect(JSON.stringify(result)).not.toContain('private');
  });
  it('accepts only the actual upper canvas, never another canvas or an ancestor attribution',()=>{
    const host=document.createElement('div'),actual=document.createElement('canvas');actual.className='upper-canvas';host.append(actual);
    const descriptor=Object.getOwnPropertyDescriptor(document,'elementFromPoint');Object.defineProperty(document,'elementFromPoint',{configurable:true,value:()=>actual});
    try{expect(nativeBlankHitPoint(host,{points,geometry,hitPolicy})).toEqual(points[0]);}finally{if(descriptor)Object.defineProperty(document,'elementFromPoint',descriptor);else delete (document as unknown as Record<string,unknown>).elementFromPoint;}
    const foreign=document.createElement('canvas');foreign.dataset.testid='board-tool-picker';
    const result=observe(foreign,host);expect(result.hits[0]).toMatchObject({control:'board-tool-picker',isCanvas:true});expect(result.unobstructedCenters).toBe(0);
  });
});


it('dismisses the actual selected-object inspector without a canonical write before the disarmed blank click',()=>{
 const doc=createWhiteboardDocument();executeCommands(doc,[{type:'create',object:{id:'created-note',schemaVersion:1,kind:'sticky',geometry:{x:100,y:100,width:180,height:140,rotation:0},text:'created text',style:{},parentId:null,orderKey:'0'}}],'seed');
 const before=readObjects(doc),writes=vi.fn();doc.on('update',writes);
 const geometry={canvas:{x:0,y:0,width:320,height:720},zoom:0.23272727272727273,paperMargin:80,requestedPaperMargin:120,chrome:[]};
 // A controlled DOM hit fixture tests the exact hit gate, not browser layout.
 const candidates=nativeBlankCandidates({canvas:geometry.canvas,viewport:{width:320,height:720},occupied:[],chrome:[{x:0,y:0,width:320,height:64},{x:49,y:80,width:255,height:90},{x:64,y:446,width:192,height:194}],paperMargin:80});
 expect(candidates.length).toBeGreaterThan(0);
 function Fixture(){
  const [editing,setEditing]=useState(true),[selected,setSelected]=useState(true);
  return createElement('div',null,createElement('div',{'data-testid':'hit-host'},createElement('canvas',{className:'upper-canvas'})),
   editing?createElement('textarea',{'aria-label':'对象文字',onKeyDown:(event:{key:string})=>{if(event.key==='Escape')setEditing(false);}}):null,
   !editing&&selected?createElement(BoardSelectedObjectPanel,{title:'created text',typeLabel:'便利贴',object:before[0]!,readOnly:false,onClose:()=>setSelected(false),onGeometryChange:()=>{throw new Error('NO_GEOMETRY_WRITE_EXPECTED');},children:null}):null);
 }
 const descriptor=Object.getOwnPropertyDescriptor(document,'elementFromPoint');
 const view=render(createElement(Fixture));
 try{
  fireEvent.keyDown(view.getByLabelText('对象文字'),{key:'Escape'});
  expect(view.queryByLabelText('对象文字')).toBeNull();expect(view.getByTestId('board-context-toolbar')).toBeVisible();
  const host=view.getByTestId('hit-host'),canvas=host.querySelector('canvas.upper-canvas')!;
  Object.defineProperty(document,'elementFromPoint',{configurable:true,value:()=>view.queryByTestId('board-context-toolbar')?.querySelector('button')??canvas});
  expect(()=>nativeBlankHitPoint(host,{points:candidates,geometry,hitPolicy:diagnosticPolicy})).toThrow('NO_NATIVE_BLANK_POSITION');
  const cancel=view.getByRole('button',{name:/^取消选择$/});cancel.focus();expect(cancel).toHaveFocus();fireEvent.click(cancel);
  expect(view.queryByTestId('board-context-toolbar')).toBeNull();
  expect(nativeBlankHitPoint(host,{points:candidates,geometry,hitPolicy:diagnosticPolicy})).toEqual(candidates[0]);
  expect(readObjects(doc)).toEqual(before);expect(writes).not.toHaveBeenCalled();expect(geometry.paperMargin).toBe(80);
 }finally{if(descriptor)Object.defineProperty(document,'elementFromPoint',descriptor);else delete (document as unknown as Record<string,unknown>).elementFromPoint;cleanup();doc.destroy();}
});
it('keeps disarm proof before native cancel and all second-click document proofs',async()=>{
 const {readFile}=await import('node:fs/promises');
 const source=await readFile('e2e/support/board-native-sticky-create.ts','utf8');
 const snapshot=source.indexOf('const snapshot=await canonicalBoardSnapshot');
 const select=source.indexOf("getByTestId('board-tool-select')",snapshot),disarmed=source.indexOf("getByTestId(`board-add-${kind}`)",select);
 const cancel=source.indexOf("cancelSelection.press('Enter')",disarmed),blank=source.indexOf('const nextPoint=await blankPoint',cancel);
 expect(snapshot).toBeGreaterThan(0);expect(disarmed).toBeGreaterThan(select);expect(cancel).toBeGreaterThan(disarmed);expect(blank).toBeGreaterThan(cancel);
 const between=source.slice(cancel,blank);for(const proof of ['canonicalRows(page)','canonicalBoardSnapshot(proof.api','boardHead(proof.api','proof.updates()'])expect(between).toContain(proof);
 const after=source.slice(blank);for(const proof of ['canonicalRows(page)','canonicalBoardSnapshot(proof.api','boardHead(proof.api','proof.updates()'])expect(after).toContain(proof);
});
