import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import type {VendorMigrationFixture} from './board-vendor-import-producer';
/** Explicitly constructed schema examples, never captured vendor boards. */
export async function loadVendorSchemaFixture(name:'miro-workshop'|'mural-diagram'|'miro-media'):Promise<VendorMigrationFixture>{
 const root=resolve(__dirname,'../../../api/tests/fixtures/whiteboard-import/schema-derived'),expected=JSON.parse(await readFile(resolve(root,'expected.json'),'utf8'))[name];
 let bytes:Buffer=await readFile(resolve(root,`${name}.json`));let mime:VendorMigrationFixture['mime']='application/json';const media:NonNullable<VendorMigrationFixture['media']>=[];
 if(name==='miro-media'){const JSZip=createRequire(resolve(__dirname,'../../../api/package.json'))('jszip') as new()=>{file(name:string,bytes:Buffer,options:{date:Date}):void;generateAsync(options:{type:'nodebuffer';compression:'STORE'}):Promise<Buffer>};const zip=new JSZip(),date=new Date('2000-01-01T00:00:00Z'),png=await readFile(resolve(root,'sample.png'));zip.file('board.json',bytes,{date});zip.file('assets/sample.png',png,{date});bytes=await zip.generateAsync({type:'nodebuffer',compression:'STORE'});mime='application/zip';media.push({sourceId:'image',sha256:createHash('sha256').update(png).digest('hex'),width:64,height:48,pixelProbe:[231,29,73]});}
 return{source:name.startsWith('miro')?'miro':'mural',name:`${name}.${mime==='application/zip'?'zip':'json'}`,mime,bytes,sha256:createHash('sha256').update(bytes).digest('hex'),classification:'schema-derived-synthetic',sourceEvidence:['docs/whiteboard/vendor-migration-evidence.md','apps/api/tests/fixtures/whiteboard-import/provenance.json'],expected,media};
}
