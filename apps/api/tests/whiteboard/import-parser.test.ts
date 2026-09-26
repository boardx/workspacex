import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import JSZip from 'jszip';
import { describe,expect,it } from 'vitest';
import { parseWhiteboardImport } from '../../src/application/whiteboard/import-parser';

const fixture=(source:'miro'|'mural',name:string)=>readFile(join(process.cwd(),'tests/fixtures/whiteboard-import',source,name));
const crc32=(bytes:Uint8Array)=>{let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^(crc&1?0xedb88320:0);}return(crc^0xffffffff)>>>0;};
const png=(width=32,height=24)=>{const bytes=new Uint8Array(45),view=new DataView(bytes.buffer);bytes.set(Buffer.from('89504e470d0a1a0a','hex'));view.setUint32(8,13);bytes.set(new TextEncoder().encode('IHDR'),12);view.setUint32(16,width);view.setUint32(20,height);bytes[24]=8;bytes[25]=6;view.setUint32(29,crc32(bytes.subarray(12,29)));bytes.set(new TextEncoder().encode('IEND'),37);view.setUint32(41,crc32(bytes.subarray(37,41)));return bytes;};
const centralOffset=(bytes:Uint8Array)=>{const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);for(let offset=bytes.length-22;offset>=0;offset--)if(view.getUint32(offset,true)===0x06054b50)return view.getUint32(offset+16,true);throw new Error('fixture');};
const withEntryFlag=(bytes:Uint8Array,flag:number)=>{const mutated=new Uint8Array(bytes),view=new DataView(mutated.buffer),central=centralOffset(mutated),local=view.getUint32(central+42,true);view.setUint16(central+8,view.getUint16(central+8,true)|flag,true);view.setUint16(local+6,view.getUint16(local+6,true)|flag,true);return mutated;};
describe.each(['miro','mural'] as const)('%s representative imports',source=>{
  it('reads a brainstorming JSON fixture',async()=>{const parsed=await parseWhiteboardImport(await fixture(source,'brainstorm.json'),'application/json',source);expect(parsed.items).toHaveLength(2);expect(parsed.items.every(item=>item.type==='sticky')).toBe(true);});
  it('reads a diagram JSON fixture with attached connector semantics',async()=>{const parsed=await parseWhiteboardImport(await fixture(source,'diagram.json'),'application/json',source);expect(parsed.items.map(item=>item.type)).toEqual(['shape','shape','connector']);expect(parsed.items[2]).toMatchObject({fromSourceId:'a',toSourceId:'b'});});
  it('reads a workshop CSV fixture with panel hierarchy',async()=>{const parsed=await parseWhiteboardImport(await fixture(source,'workshop.csv'),'text/csv',source);expect(parsed.items).toHaveLength(3);expect(parsed.items[0]?.type).toBe('panel');expect(parsed.items[1]?.parentSourceId).toBe(parsed.items[0]?.sourceId);});
});
describe.each(['miro','mural'] as const)('%s versioned archive exports',source=>{
  it('reads nested vendor data and preserves export provenance',async()=>{const document=await fixture(source,'archive.json'),zip=new JSZip();zip.file('export/board.json',document);zip.file('assets/interview.png',png());const parsed=await parseWhiteboardImport(await zip.generateAsync({type:'uint8array'}),'application/zip',source);expect(parsed.items.length).toBeGreaterThanOrEqual(5);expect(parsed.items[0]?.metadata).toMatchObject({sourceVersion:expect.any(String),sourceBoardId:expect.any(String)});if(source==='mural')expect(parsed.items.find(item=>item.sourceId==='circle-1')).toMatchObject({type:'shape',shape:'circle'});});
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
