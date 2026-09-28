import {createHash} from 'node:crypto';
import {readFile,realpath} from 'node:fs/promises';
import {dirname,isAbsolute,relative,resolve} from 'node:path';
import type {VendorExpected,VendorMigrationFixture} from './board-vendor-import-producer';

type CapturedFixtureEntry={
  source:'miro'|'mural';
  name:string;
  mime:VendorMigrationFixture['mime'];
  file:string;
  sha256:string;
  expectedFile:string;
  sourceEvidence:string[];
  media?:VendorMigrationFixture['media'];
};

type CapturedFixtureManifest={version:1;fixtures:CapturedFixtureEntry[]};

const sha256=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const isRecord=(value:unknown):value is Record<string,unknown>=>typeof value==='object'&&value!==null&&!Array.isArray(value);

async function confinedFile(root:string,path:string){
  if(!path||isAbsolute(path))throw new Error('CAPTURED_VENDOR_PATH_OUTSIDE_MANIFEST');
  const target=await realpath(resolve(root,path)),rel=relative(root,target);
  if(rel===''||rel.startsWith('..')||isAbsolute(rel))throw new Error('CAPTURED_VENDOR_PATH_OUTSIDE_MANIFEST');
  return target;
}

function parseManifest(raw:unknown):CapturedFixtureManifest{
  if(!isRecord(raw)||raw.version!==1||!Array.isArray(raw.fixtures)||raw.fixtures.length!==3)throw new Error('CAPTURED_VENDOR_MANIFEST_REQUIRES_THREE_FIXTURES');
  const fixtures=raw.fixtures.map((entry,index)=>{
    if(!isRecord(entry)||!['miro','mural'].includes(String(entry.source))||typeof entry.name!=='string'||!entry.name.trim()||!['application/json','application/zip','text/csv'].includes(String(entry.mime))||typeof entry.file!=='string'||typeof entry.expectedFile!=='string'||typeof entry.sha256!=='string'||!/^[a-f0-9]{64}$/.test(entry.sha256)||!Array.isArray(entry.sourceEvidence)||entry.sourceEvidence.length===0||entry.sourceEvidence.some(item=>typeof item!=='string'||!item.trim()))throw new Error(`INVALID_CAPTURED_VENDOR_FIXTURE_${index}`);
    if(entry.media!==undefined&&!Array.isArray(entry.media))throw new Error(`INVALID_CAPTURED_VENDOR_MEDIA_${index}`);
    return entry as unknown as CapturedFixtureEntry;
  });
  if(!fixtures.some(item=>item.source==='miro')||!fixtures.some(item=>item.source==='mural'))throw new Error('CAPTURED_VENDOR_MANIFEST_REQUIRES_MIRO_AND_MURAL');
  if(new Set(fixtures.map(item=>`${item.source}:${item.name}`)).size!==fixtures.length)throw new Error('CAPTURED_VENDOR_FIXTURE_ID_DUPLICATE');
  if(new Set(fixtures.map(item=>item.sha256)).size!==fixtures.length)throw new Error('CAPTURED_VENDOR_EXPORT_HASH_DUPLICATE');
  return{version:1,fixtures};
}

/** Loads three operator-supplied, redacted account exports and their independently
 * reviewed inventories. The files stay outside the repository; paths are confined
 * to the manifest directory and every export is pinned by SHA-256. */
export async function loadCapturedVendorFixtures(manifestPath:string):Promise<VendorMigrationFixture[]>{
  const manifestFile=await realpath(resolve(manifestPath)),root=dirname(manifestFile),manifest=parseManifest(JSON.parse(await readFile(manifestFile,'utf8')));
  return Promise.all(manifest.fixtures.map(async entry=>{
    const [bytes,expectedRaw]=await Promise.all([readFile(await confinedFile(root,entry.file)),readFile(await confinedFile(root,entry.expectedFile),'utf8')]);
    if(sha256(bytes)!==entry.sha256)throw new Error(`CAPTURED_VENDOR_HASH_MISMATCH:${entry.source}:${entry.name}`);
    const expected=JSON.parse(expectedRaw) as unknown;
    if(!Array.isArray(expected)||expected.length===0||expected.some(item=>!isRecord(item)||typeof item.sourceId!=='string'||!item.sourceId))throw new Error(`INVALID_CAPTURED_VENDOR_EXPECTED:${entry.source}:${entry.name}`);
    return{source:entry.source,name:entry.name,mime:entry.mime,bytes,sha256:entry.sha256,classification:'captured-account-export',sourceEvidence:entry.sourceEvidence,expected:expected as VendorExpected[],media:entry.media};
  }));
}
