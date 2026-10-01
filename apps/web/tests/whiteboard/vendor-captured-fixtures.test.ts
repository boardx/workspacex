import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,expect,it} from 'vitest';
import {loadCapturedVendorFixtures} from '../../e2e/support/board-vendor-captured-fixtures';
const roots:string[]=[];afterEach(async()=>Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true}))));
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
async function fixture(){
  const root=await mkdtemp(join(tmpdir(),'captured-vendor-'));roots.push(root);await mkdir(join(root,'samples'));
  const entries=[];for(const [index,source] of (['miro','mural','miro'] as const).entries()){
    const bytes=Buffer.from(JSON.stringify({vendor:source,index})),file=`samples/${source}-${index}.json`,expectedFile=`samples/${source}-${index}.expected.json`;
    await writeFile(join(root,file),bytes);await writeFile(join(root,expectedFile),JSON.stringify([{sourceId:`object-${index}`,outcome:'success',kind:'sticky',text:'idea',geometry:{x:0,y:0,width:100,height:100,rotation:0},parentSourceId:null}]));
    entries.push({source,name:`board-${index}.json`,mime:'application/json',file,sha256:hash(bytes),expectedFile,sourceEvidence:[`redaction-review-${index}`]});
  }
  const manifest=join(root,'manifest.json');await writeFile(manifest,JSON.stringify({version:1,fixtures:entries}));return{root,manifest,entries};
}
it('loads exactly three hash-pinned captured exports with independent inventories',async()=>{const f=await fixture(),loaded=await loadCapturedVendorFixtures(f.manifest);expect(loaded).toHaveLength(3);expect(loaded.map(item=>item.classification)).toEqual(['captured-account-export','captured-account-export','captured-account-export']);expect(loaded.map(item=>item.expected[0]!.sourceId)).toEqual(['object-0','object-1','object-2']);});
it('rejects tampered exports and paths outside the evidence directory',async()=>{const f=await fixture();await writeFile(join(f.root,f.entries[0]!.file),'tampered');await expect(loadCapturedVendorFixtures(f.manifest)).rejects.toThrow('CAPTURED_VENDOR_HASH_MISMATCH');const outside=join(f.root,'..','outside-vendor.json');await writeFile(outside,'{}');f.entries[0]!.file='../outside-vendor.json';await writeFile(f.manifest,JSON.stringify({version:1,fixtures:f.entries}));await expect(loadCapturedVendorFixtures(f.manifest)).rejects.toThrow('CAPTURED_VENDOR_PATH_OUTSIDE_MANIFEST');await rm(outside,{force:true});});
it('rejects incomplete evidence sets instead of silently claiming real-board acceptance',async()=>{const f=await fixture();f.entries.pop();await writeFile(f.manifest,JSON.stringify({version:1,fixtures:f.entries}));await expect(loadCapturedVendorFixtures(f.manifest)).rejects.toThrow('CAPTURED_VENDOR_MANIFEST_REQUIRES_THREE_FIXTURES');});
