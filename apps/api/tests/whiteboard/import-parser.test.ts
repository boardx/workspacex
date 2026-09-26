import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import JSZip from 'jszip';
import { describe,expect,it } from 'vitest';
import { parseWhiteboardImport } from '../../src/application/whiteboard/import-parser';

const fixture=(source:'miro'|'mural',name:string)=>readFile(join(process.cwd(),'tests/fixtures/whiteboard-import',source,name));
describe.each(['miro','mural'] as const)('%s representative imports',source=>{
  it('reads a brainstorming JSON fixture',async()=>{const parsed=await parseWhiteboardImport(await fixture(source,'brainstorm.json'),'application/json',source);expect(parsed.items).toHaveLength(2);expect(parsed.items.every(item=>item.type==='sticky')).toBe(true);});
  it('reads a diagram JSON fixture with attached connector semantics',async()=>{const parsed=await parseWhiteboardImport(await fixture(source,'diagram.json'),'application/json',source);expect(parsed.items.map(item=>item.type)).toEqual(['shape','shape','connector']);expect(parsed.items[2]).toMatchObject({fromSourceId:'a',toSourceId:'b'});});
  it('reads a workshop CSV fixture with panel hierarchy',async()=>{const parsed=await parseWhiteboardImport(await fixture(source,'workshop.csv'),'text/csv',source);expect(parsed.items).toHaveLength(3);expect(parsed.items[0]?.type).toBe('panel');expect(parsed.items[1]?.parentSourceId).toBe(parsed.items[0]?.sourceId);});
});
it('accepts bounded ZIP with verified raster asset and rejects traversal',async()=>{
  const png=Buffer.from('89504e470d0a1a0a00000000','hex'),zip=new JSZip();zip.file('board.json',JSON.stringify({widgets:[{id:'image',type:'image',fileName:'assets/p.png'}]}));zip.file('assets/p.png',png);
  const parsed=await parseWhiteboardImport(await zip.generateAsync({type:'uint8array'}),'application/zip','miro');expect(parsed.assets).toMatchObject([{path:'assets/p.png',mime:'image/png'}]);expect(parsed.items[0]?.assetRef).toBe('assets/p.png');
  const unsafe=new JSZip();unsafe.file('../escape.json','{}');await expect(parseWhiteboardImport(await unsafe.generateAsync({type:'uint8array'}),'application/zip','miro')).rejects.toMatchObject({code:'UNSAFE_ARCHIVE'});
});
it('rejects MIME confusion and NUL text',async()=>{await expect(parseWhiteboardImport(new TextEncoder().encode('{}'),'application/zip','miro')).rejects.toMatchObject({code:'UNSUPPORTED_FORMAT'});await expect(parseWhiteboardImport(new Uint8Array([0]),'application/json','mural')).rejects.toMatchObject({code:'UNSUPPORTED_FORMAT'});});
