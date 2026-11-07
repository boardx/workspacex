import {afterEach,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
const state=vi.hoisted(()=>({path:'',mode:0o700,uid:0,nlink:1,file:true,bytes:Buffer.from('controlled software bytes')}));
vi.mock('node:fs',()=>({constants:{O_RDONLY:0,O_NOFOLLOW:0x20000},closeSync:vi.fn(),openSync:vi.fn(()=>7),readFileSync:vi.fn(()=>state.bytes),lstatSync:vi.fn((path:string)=>path===state.path?({isFile:()=>state.file,uid:state.uid,gid:0,nlink:state.nlink,mode:state.mode,dev:1,ino:2,size:state.bytes.length,mtimeMs:3}):({isDirectory:()=>true,uid:0,gid:0,mode:0o755})),fstatSync:vi.fn(()=>({dev:1,ino:2,size:state.bytes.length,mtimeMs:3}))}));
import {protectedExecutable} from './fixed_transport';
const publicPaths=['/usr/local/lib/workspacex-cn/collect-cn-release-preflight.sh','/usr/local/lib/workspacex-cn/verify-cn-release-preflight.sh'];
const privatePaths=['/usr/local/lib/workspacex-cn/collect-cn-migration-snapshot.py','/usr/local/lib/workspacex-cn/writer_fence.py'];
afterEach(()=>{Object.assign(state,{mode:0o700,uid:0,nlink:1,file:true});});
for(const path of [...publicPaths,...privatePaths])it(`enforces exact software metadata for ${path}`,()=>{
 state.path=path;state.mode=publicPaths.includes(path)?0o755:0o700;const required=state.mode,pin=createHash('sha256').update(state.bytes).digest('hex');
 expect(protectedExecutable({path,sha256:pin})).toBe(7);
 state.mode=required===0o755?0o700:0o755;expect(()=>protectedExecutable({path,sha256:pin})).toThrow('COMMAND_METADATA_UNTRUSTED');state.mode=required;
 for(const change of [{uid:1234},{nlink:2},{file:false},{mode:0o777}]){
  Object.assign(state,change);expect(()=>protectedExecutable({path,sha256:pin})).toThrow('COMMAND_METADATA_UNTRUSTED');Object.assign(state,{mode:required,uid:0,nlink:1,file:true});
 }
 expect(()=>protectedExecutable({path,sha256:'f'.repeat(64)})).toThrow('COMMAND_HASH_MISMATCH');
});
