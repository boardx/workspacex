import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import JSZip from 'jszip';
import { mapImportedBoard } from '@repo/whiteboard-core';
import { describe,expect,it } from 'vitest';
import { parseWhiteboardImport } from '../../src/application/whiteboard/import-parser';

const fixture=(source:'miro'|'mural',name:string)=>readFile(join(process.cwd(),'tests/fixtures/whiteboard-import',source,name));
const crc32=(bytes:Uint8Array)=>{let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^(crc&1?0xedb88320:0);}return(crc^0xffffffff)>>>0;};
const png=(width=32,height=24)=>{const bytes=new Uint8Array(45),view=new DataView(bytes.buffer);bytes.set(Buffer.from('89504e470d0a1a0a','hex'));view.setUint32(8,13);bytes.set(new TextEncoder().encode('IHDR'),12);view.setUint32(16,width);view.setUint32(20,height);bytes[24]=8;bytes[25]=6;view.setUint32(29,crc32(bytes.subarray(12,29)));bytes.set(new TextEncoder().encode('IEND'),37);view.setUint32(41,crc32(bytes.subarray(37,41)));return bytes;};
const centralOffset=(bytes:Uint8Array)=>{const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);for(let offset=bytes.length-22;offset>=0;offset--)if(view.getUint32(offset,true)===0x06054b50)return view.getUint32(offset+16,true);throw new Error('fixture');};
const withEntryFlag=(bytes:Uint8Array,flag:number)=>{const mutated=new Uint8Array(bytes),view=new DataView(mutated.buffer),central=centralOffset(mutated),local=view.getUint32(central+42,true);view.setUint16(central+8,view.getUint16(central+8,true)|flag,true);view.setUint16(local+6,view.getUint16(local+6,true)|flag,true);return mutated;};
describe.each(['miro','mural'] as const)('%s normalized fixture imports',source=>{
  it('reads a brainstorming JSON fixture',async()=>{const parsed=await parseWhiteboardImport(await fixture(source,'brainstorm.json'),'application/json',source);expect(parsed.items).toHaveLength(2);expect(parsed.items.every(item=>item.type==='sticky')).toBe(true);});
  it('reads a diagram JSON fixture with attached connector semantics',async()=>{const parsed=await parseWhiteboardImport(await fixture(source,'diagram.json'),'application/json',source);expect(parsed.items.map(item=>item.type)).toEqual(['shape','shape','connector']);expect(parsed.items[2]).toMatchObject({fromSourceId:'a',toSourceId:'b'});});
  it('reads a workshop CSV fixture with panel hierarchy',async()=>{const parsed=await parseWhiteboardImport(await fixture(source,'workshop.csv'),'text/csv',source);expect(parsed.items).toHaveLength(3);expect(parsed.items[0]?.type).toBe('panel');expect(parsed.items[1]?.parentSourceId).toBe(parsed.items[0]?.sourceId);});
});
describe.each(['miro','mural'] as const)('%s normalized archive fixtures',source=>{
  it('reads nested normalized data and preserves declared provenance',async()=>{const document=await fixture(source,'archive.json'),zip=new JSZip();zip.file('export/board.json',document);zip.file('assets/interview.png',png());const parsed=await parseWhiteboardImport(await zip.generateAsync({type:'uint8array'}),'application/zip',source);expect(parsed.items.length).toBeGreaterThanOrEqual(5);expect(parsed.items[0]?.metadata).toMatchObject({sourceVersion:expect.any(String),sourceBoardId:expect.any(String)});if(source==='mural')expect(parsed.items.find(item=>item.sourceId==='circle-1')).toMatchObject({type:'shape',shape:'circle'});});
});
it('accepts bounded ZIP with verified raster asset and rejects traversal',async()=>{
  const zip=new JSZip();zip.file('board.json',JSON.stringify({widgets:[{id:'image',type:'image',fileName:'assets/p.png'}]}));zip.file('assets/p.png',png());
  const parsed=await parseWhiteboardImport(await zip.generateAsync({type:'uint8array'}),'application/zip','miro');expect(parsed.assets).toMatchObject([{path:'assets/p.png',mime:'image/png'}]);expect(parsed.items[0]?.assetRef).toBe('assets/p.png');
  const unsafe=new JSZip();unsafe.file('../escape.json','{}');await expect(parseWhiteboardImport(await unsafe.generateAsync({type:'uint8array'}),'application/zip','miro')).rejects.toMatchObject({code:'UNSAFE_ARCHIVE'});
});
it.each(['STORE','DEFLATE'] as const)('accepts a valid %s archive',async compression=>{
  const zip=new JSZip();zip.file('board.json',JSON.stringify({widgets:[{id:'a',type:'sticker',text:compression}]}));
  const parsed=await parseWhiteboardImport(await zip.generateAsync({type:'uint8array',compression}),'application/zip','miro');
  expect(parsed.items).toMatchObject([{sourceId:'a',type:'sticky',text:compression}]);
});
it.each([
  ['encrypted',0x0001],
  ['patched data',0x0020],
  ['strong encryption',0x0040],
  ['central-directory encryption',0x2000],
] as const)('rejects ZIP entries with the %s general-purpose flag in both headers',async(_label,flag)=>{
  const zip=new JSZip();zip.file('board.json',JSON.stringify({widgets:[{id:'a',type:'sticker'}]}));
  const valid=await zip.generateAsync({type:'uint8array',compression:'DEFLATE'});
  await expect(parseWhiteboardImport(withEntryFlag(valid,flag),'application/zip','miro')).rejects.toMatchObject({code:'UNSAFE_ARCHIVE'});
});
it('rejects compression bombs before inflate and rejects forged sizes or CRCs',async()=>{
  const bomb=new JSZip();bomb.file('board.json',JSON.stringify({widgets:[]}));bomb.file('padding.txt','A'.repeat(1_000_000));
  await expect(parseWhiteboardImport(await bomb.generateAsync({type:'uint8array',compression:'DEFLATE',compressionOptions:{level:9}}),'application/zip','miro')).rejects.toMatchObject({code:'UNSAFE_ARCHIVE'});
  const source=new JSZip();source.file('board.json',JSON.stringify({widgets:[{id:'a',type:'sticker'}]}));const valid=await source.generateAsync({type:'uint8array',compression:'DEFLATE'}),offset=centralOffset(valid);
  const forgedSize=new Uint8Array(valid),sizeView=new DataView(forgedSize.buffer);sizeView.setUint32(offset+24,1,true);
  await expect(parseWhiteboardImport(forgedSize,'application/zip','miro')).rejects.toMatchObject({code:'UNSAFE_ARCHIVE'});
  const forgedCrc=new Uint8Array(valid),crcView=new DataView(forgedCrc.buffer);crcView.setUint32(offset+16,crcView.getUint32(offset+16,true)^0xffffffff,true);
  await expect(parseWhiteboardImport(forgedCrc,'application/zip','miro')).rejects.toMatchObject({code:'UNSAFE_ARCHIVE'});
});
it('does not accept truncated image magic as an asset',async()=>{const zip=new JSZip();zip.file('board.json',JSON.stringify({widgets:[{id:'image',type:'image',fileName:'assets/p.png'}]}));zip.file('assets/p.png',Buffer.from('89504e470d0a1a0a00000000','hex'));const parsed=await parseWhiteboardImport(await zip.generateAsync({type:'uint8array'}),'application/zip','miro');expect(parsed.assets).toEqual([]);expect(parsed.skipped).toContain('assets/p.png');expect(parsed.items[0]?.assetRef).toBeNull();});
it('rejects MIME confusion and NUL text',async()=>{await expect(parseWhiteboardImport(new TextEncoder().encode('{}'),'application/zip','miro')).rejects.toMatchObject({code:'UNSUPPORTED_FORMAT'});await expect(parseWhiteboardImport(new Uint8Array([0]),'application/json','mural')).rejects.toMatchObject({code:'UNSUPPORTED_FORMAT'});});
it.each(['miro','mural'] as const)('preserves %s group containers',async source=>{const root=source==='miro'?{widgets:[{id:'g',type:'group'},{id:'n',type:'sticker',parentId:'g'}]}:{items:[{id:'g',type:'cluster'},{id:'n',type:'sticky note',parentId:'g'}]};const parsed=await parseWhiteboardImport(new TextEncoder().encode(JSON.stringify(root)),'application/json',source);expect(parsed.items).toMatchObject([{sourceId:'g',type:'group'},{sourceId:'n',type:'sticky',parentSourceId:'g'}]);});

// Contract examples derived from public REST documentation, not vendor-export evidence.
describe('Miro REST and text-only CSV adapters',()=>{
  const json=(value:unknown)=>parseWhiteboardImport(Buffer.from(JSON.stringify(value)),'application/json','miro');
  it('reads data arrays, plain text and center-origin world geometry',async()=>{
    const result=await json({data:[{id:'n',type:'sticky_note',data:{content:'<p>你好 &amp; hello</p>'},position:{x:400,y:300,origin:'center'},geometry:{width:200,height:100}}]});
    expect(result.items[0]).toMatchObject({type:'sticky',text:'你好 & hello',x:300,y:250,width:200,height:100});
    expect(result.items[0]?.losses).toContain('Rich text formatting was converted to plain text.');
  });
  it('resolves parent-top-left coordinates independent of source order',async()=>{
    const result=await json({data:[{id:'n',type:'sticky_note',data:{content:'child'},parent:{id:'f'},position:{x:100,y:80,relativeTo:'parent_top_left'},geometry:{width:80,height:40}},{id:'f',type:'frame',data:{title:'frame'},position:{x:500,y:400},geometry:{width:400,height:300}}]});
    expect(result.items[0]).toMatchObject({x:360,y:310,parentSourceId:'f'});
  });
  it('rejects incomplete pages and unresolved relative geometry',async()=>{
    await expect(json({data:[],links:{next:'https://api.miro.com/next'}})).rejects.toMatchObject({code:'UNSUPPORTED_FORMAT'});
    await expect(json({data:[{id:'n',type:'sticky_note',data:{content:'child'},position:{relativeTo:'parent_top_left'},parent:{id:'absent'}}]})).rejects.toMatchObject({code:'UNSUPPORTED_FORMAT'});
  });
  it('preserves every nonempty text CSV row including first row and quoted newlines',async()=>{
    const result=await parseWhiteboardImport(Buffer.from('第一张便签\n"second\nline"\n'),'text/csv','miro');
    expect(result.items.map(item=>item.text)).toEqual(['第一张便签','second\nline']);
    expect(result.items[1]).toMatchObject({type:'text',x:240,y:0});
    expect(result.items.every(item=>item.losses?.length)).toBe(true);
  });
});

describe('Mural public v1 widgets response contract',()=>{
  const parse=(value:unknown)=>parseWhiteboardImport(Buffer.from(JSON.stringify(value)),'application/json','mural');
  it('accepts value widgets and resolves parent-relative top-left geometry',async()=>{
    const result=await parse({value:[{id:'note',type:'sticky note',x:20,y:30,width:100,height:80,parentId:'area',text:'fallback',htmlText:'<b>讨论</b> &amp; plan',stackingOrder:9,style:{backgroundColor:'#FFCC00FF'}},{id:'area',type:'area',x:400,y:500,width:600,height:400,title:'Workshop'}]});
    expect(result.items[0]).toMatchObject({x:420,y:530,type:'sticky',text:'讨论 & plan',color:'#FFCC00',zIndex:9,parentSourceId:'area'});
  });
  it('maps arrow endpoint references and label while reporting routing loss',async()=>{
    const result=await parse({value:[{id:'a',type:'arrow',x:0,y:0,width:100,height:10,startRefId:'left',endRefId:'right',label:{labels:[{text:'causes',x:0,y:0,width:20,height:10},{text:'effect',x:30,y:0,width:20,height:10}]},arrowType:'curved',tip:'double',style:{strokeColor:'#123456FF'}}]});
    expect(result.items[0]).toMatchObject({type:'connector',fromSourceId:'left',toSourceId:'right',text:'causes\neffect',color:'#123456'});
    expect(result.items[0]?.losses?.join(' ')).toContain('routing');
  });
  it('rejects unfinished pages and unresolved or cyclic parents',async()=>{
    await expect(parse({value:[],next:'opaque-token'})).rejects.toMatchObject({code:'UNSUPPORTED_FORMAT'});
    await expect(parse({value:[{id:'a',type:'text',parentId:'absent'}]})).rejects.toMatchObject({code:'UNSUPPORTED_FORMAT'});
    await expect(parse({value:[{id:'a',type:'area',parentId:'b'},{id:'b',type:'area',parentId:'a'}]})).rejects.toMatchObject({code:'UNSUPPORTED_FORMAT'});
  });
  it('keeps unsupported and hidden widgets explicit and never imports remote image bytes',async()=>{
    const result=await parse({value:[{id:'c',type:'comment',text:'thread'},{id:'f',type:'file'},{id:'secret',type:'sticky note',hidden:true,text:'private'},{id:'img',type:'image',url:'https://vendor.example/expiring.png',naturalWidth:200,naturalHeight:100}]});
    expect(result.items.map(item=>item.type)).toEqual(['unsupported','unsupported','unsupported','image']);
    expect(result.items[2]?.unsupportedReason).toContain('Hidden');expect(result.items[3]?.assetRef).toBeNull();expect(result.assets).toEqual([]);
  });
});

it('maps a complete Mural public response into canonical relationships and per-record losses',async()=>{
 const raw={value:[{id:'area',type:'area',x:100,y:200,width:500,height:400},{id:'note',type:'sticky note',parentId:'area',x:10,y:20,width:100,height:80,text:'A',style:{backgroundColor:'#ABCDEF80'}},{id:'shape',type:'shape',shape:'diamond',x:700,y:200,width:100,height:100,text:'B'},{id:'arrow',type:'arrow',x:0,y:0,width:100,height:10,startRefId:'note',endRefId:'shape'},{id:'file',type:'file'},{id:'secret',type:'area',hidden:true,x:0,y:0,width:500,height:300},{id:'child',type:'text',parentId:'secret',x:1,y:1,width:100,height:80,text:'hidden child'}]};
 const parsed=await parseWhiteboardImport(Buffer.from(JSON.stringify(raw)),'application/json','mural');
 const mapped=mapImportedBoard('mural','11111111-1111-4111-8111-111111111111',parsed.items);
 const objects=mapped.commands.flatMap(command=>command.type==='create'?[command.object]:[]);
 expect(objects).toHaveLength(4);expect(objects[1]).toMatchObject({parentId:objects[0]!.id,geometry:{x:110,y:220},style:{fill:'#ABCDEF'}});
 expect(objects[3]?.connector).toMatchObject({from:objects[1]!.id,to:objects[2]!.id});
 expect(mapped.outcomes.filter(item=>item.outcome==='skipped').map(item=>item.sourceId)).toEqual(['file','secret','child']);
 expect(mapped.outcomes.find(item=>item.sourceId==='note')).toMatchObject({outcome:'downgraded'});
 expect(mapped.issues.find(item=>item.sourceId==='child')?.detail).toContain('visibility');
});

it('preserves Miro REST connector captions and reports label truncation',async()=>{
 const data={items:[{id:'a',type:'shape'},{id:'b',type:'shape'}],connectors:[{id:'edge',type:'connector',startItem:{id:'a'},endItem:{id:'b'},captions:[{content:'<p>决策 &amp; choice</p>'},{content:'<b>next</b>'}]}]};
 const parsed=await parseWhiteboardImport(Buffer.from(JSON.stringify(data)),'application/json','miro');expect(parsed.items[2]?.text).toBe('决策 & choice\n\nnext');
 const mapped=mapImportedBoard('miro','req',parsed.items);expect(mapped.commands.at(-1)).toMatchObject({object:{connector:{label:'决策 & choice\n\nnext'}}});
 data.connectors[0]!.captions=[{content:'x'.repeat(1001)}];const long=await parseWhiteboardImport(Buffer.from(JSON.stringify(data)),'application/json','miro');expect(long.items[2]?.losses).toContain('Connector label was truncated to 1000 characters.');
});
it('keeps every detailed downgrade in a bounded report for 200 style-rich source items',async()=>{
 const value=Array.from({length:200},(_,i)=>({id:String(i),type:'sticky note',htmlText:'<b>format</b>',backgroundColor:'#ffffff80',shape:'circle',layout:'grid',instruction:'note',locked:true,style:{fontSize:18}}));
 const parsed=await parseWhiteboardImport(Buffer.from(JSON.stringify({value})),'application/json','mural'),mapped=mapImportedBoard('mural','report',parsed.items);
 const {whiteboardImport:C}=await import('@repo/contracts');
 const report=C.WhiteboardImportReport.parse({importId:'00000000-0000-4000-8000-000000000001',counts:{discovered:200,accepted:mapped.accepted,unsupported:mapped.unsupported,assets:0},issues:mapped.issues,items:mapped.outcomes,exportFormat:'workspacex.whiteboard-import-report.v1',executable:true});
 expect(report.items).toHaveLength(200);expect(report.issues.length).toBeLessThanOrEqual(C.WHITEBOARD_IMPORT_LIMITS.issues);
 for(const item of parsed.items)for(const loss of item.losses!)expect(report.issues.filter(issue=>issue.sourceId===item.sourceId).map(issue=>issue.detail).join(' ')).toContain(loss);
});

it.each(['miro-workshop','mural-diagram','miro-media'] as const)('maps the independently inventoried %s schema fixture including every loss',async name=>{
 const {loadVendorSchemaFixture}=await import('../../../web/e2e/support/board-vendor-schema-fixtures');
 const {assertVendorMigration}=await import('../../../web/e2e/support/board-vendor-import-producer');
 const {SharpBoardImageVerifier}=await import('../../src/infrastructure/whiteboard/image-verifier');
 const f=await loadVendorSchemaFixture(name),parsed=await parseWhiteboardImport(f.bytes,f.mime,f.source);
 for(const asset of parsed.assets){const verified=await new SharpBoardImageVerifier().verify(asset.bytes,asset.mime);for(const item of parsed.items.filter(item=>item.assetRef===asset.path))item.assetMetadata=verified.metadata;}
 const mapped=mapImportedBoard(f.source,'00000000-0000-4000-8000-000000000001',parsed.items);
 assertVendorMigration(f,{counts:{discovered:mapped.discovered,accepted:mapped.accepted,unsupported:mapped.unsupported},items:mapped.outcomes,issues:mapped.issues},mapped.commands.flatMap(command=>command.type==='create'?[command.object]:[]));
 const {createWhiteboardDocument,executeCommands,readObjects}=await import('@repo/whiteboard-core');const doc=createWhiteboardDocument();executeCommands(doc,mapped.commands,{});expect(readObjects(doc)).toHaveLength(mapped.accepted);doc.destroy();
});
it('pins fixture provenance hashes and cannot mistake synthetic inventory for real exports',async()=>{
 const {createHash}=await import('node:crypto');const root=join(process.cwd(),'tests/fixtures/whiteboard-import'),manifest=JSON.parse(await readFile(join(root,'provenance.json'),'utf8'));
 expect(manifest.realAccountBoards).toBe(0);for(const file of manifest.files){expect(file.capturedFromAccount).toBe(false);expect(createHash('sha256').update(await readFile(join(root,file.path))).digest('hex')).toBe(file.sha256);}
});
it('the migration evidence checker rejects geometry corruption and an omitted failed item',async()=>{
 const {loadVendorSchemaFixture}=await import('../../../web/e2e/support/board-vendor-schema-fixtures'),{assertVendorMigration}=await import('../../../web/e2e/support/board-vendor-import-producer');
 const f=await loadVendorSchemaFixture('mural-diagram'),parsed=await parseWhiteboardImport(f.bytes,f.mime,f.source),mapped=mapImportedBoard(f.source,'proof',parsed.items),objects=mapped.commands.flatMap(command=>command.type==='create'?[command.object]:[]),report={counts:{discovered:mapped.discovered,accepted:mapped.accepted,unsupported:mapped.unsupported},items:mapped.outcomes,issues:mapped.issues};
 const changed=structuredClone(objects);changed[0]!.geometry.x+=1;expect(()=>assertVendorMigration(f,report,changed)).toThrow();expect(()=>assertVendorMigration(f,{...report,items:report.items.filter(item=>item.sourceId!=='missing-image')},objects)).toThrow();
});
