import { createHash, webcrypto } from 'node:crypto';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { BoardDurableImageSession } from '@/components/whiteboard/board-session-image-assets';
import { toBoardFabricObjects } from '@/components/whiteboard/whiteboard-fabric-projection';
vi.mock('@/lib/api-client',()=>({apiUrl:(path:string)=>`https://api.test${path}`,getStoredSessionToken:()=> 'test-token'}));
const bytes=new Uint8Array([1,2,3,4]);
const digest=createHash('sha256').update(bytes).digest('hex');
const metadata={assetId:`board-image-${digest}`,mimeType:'image/png' as const,magicMimeType:'image/png' as const,byteSize:bytes.length,contentDigest:`sha256:${digest}`,intrinsicWidth:20,intrinsicHeight:10,persistence:'durable' as const};
const object={id:'image',schemaVersion:1 as const,kind:'image' as const,geometry:{x:0,y:0,width:200,height:100,rotation:0},text:'Image',style:{},parentId:null,orderKey:'',extensionData:{contentObject:{version:1,type:'image',status:'ready',...metadata,sourceUrl:null,crop:{x:0,y:0,width:1,height:1},opacity:1,borderColor:'#000000',borderWidth:0,cornerRadius:0,fileName:'image.png',replacementOf:null,failureCode:null}}};
let urls=0;
beforeEach(()=>{vi.stubGlobal('crypto',webcrypto);vi.spyOn(URL,'createObjectURL').mockImplementation(()=>`blob:image-${++urls}`);vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
const content=()=>new Response(bytes,{headers:{'content-type':'image/png'}});
describe('durable image session',()=>{
 it('calls the default browser fetch with its global receiver for upload and authenticated readback',async()=>{
  const receivers:unknown[]=[];
  vi.stubGlobal('fetch',function(this:unknown,_url:RequestInfo|URL,init?:RequestInit){
   receivers.push(this);if(this!==globalThis)throw new TypeError('Illegal invocation');
   return Promise.resolve(init?.method==='POST'?Response.json(metadata):content());
  });
  const session=new BoardDurableImageSession('board',()=>{});
  await expect(session.upload(new Blob([bytes],{type:'image/png'}),'image.png')).resolves.toEqual(metadata);
  expect(receivers).toEqual([globalThis,globalThis]);expect(session.get(metadata.assetId)).toBeDefined();session.dispose();
 });
 it('uploads authenticated multipart and verifies delivered bytes before returning ready metadata',async()=>{const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>init?.method==='POST'?Response.json(metadata):content());const session=new BoardDurableImageSession('board',()=>{},fetcher);expect(await session.upload(new Blob([bytes],{type:'image/png'}),'image.png')).toEqual(metadata);expect(fetcher).toHaveBeenCalledTimes(2);expect(fetcher.mock.calls[0]?.[1]?.body).toBeInstanceOf(FormData);expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({Authorization:'Bearer test-token'});expect(session.get(metadata.assetId)?.objectUrl).toMatch(/^blob:/);session.dispose();});
 it('refresh and peer create new authenticated reads; canonical state has no transient URL',async()=>{const fetcher=vi.fn(async()=>content()),first=new BoardDurableImageSession('board',()=>{},fetcher);await first.ensure(metadata);const oldUrl=first.get(metadata.assetId)!.objectUrl;expect(toBoardFabricObjects([object],id=>first.get(id)?.objectUrl)[0]?.imageAssetUrl).toBe(oldUrl);first.dispose();const peer=new BoardDurableImageSession('board',()=>{},fetcher);expect(peer.get(metadata.assetId)).toBeUndefined();await peer.ensure(metadata);expect(fetcher).toHaveBeenCalledTimes(2);expect(peer.get(metadata.assetId)!.objectUrl).not.toBe(oldUrl);expect(JSON.stringify(object)).not.toContain('blob:');peer.dispose();});
 it('does not reuse a same-digest handle across boards',async()=>{const fetcher=vi.fn(async(_url:RequestInfo|URL)=>content()),a=new BoardDurableImageSession('a',()=>{},fetcher),b=new BoardDurableImageSession('b',()=>{},fetcher);await a.ensure(metadata);await b.ensure(metadata);expect(fetcher.mock.calls.map(call=>String(call[0]))).toEqual([expect.stringContaining('/whiteboards/a/'),expect.stringContaining('/whiteboards/b/')]);a.dispose();b.dispose();});
 it('fails closed on corruption and upload failure without installing a preview',async()=>{const corrupt=new BoardDurableImageSession('board',()=>{},vi.fn(async()=>new Response(new Uint8Array([9]),{headers:{'content-type':'image/png'}})));await expect(corrupt.ensure(metadata)).rejects.toThrow('IMAGE_ASSET_INTEGRITY');expect(corrupt.get(metadata.assetId)).toBeUndefined();const failed=new BoardDurableImageSession('board',()=>{},vi.fn(async()=>new Response(null,{status:503})));await expect(failed.upload(new Blob([bytes]),'a.png')).rejects.toThrow('IMAGE_ASSET_UNAVAILABLE');expect(failed.get(metadata.assetId)).toBeUndefined();corrupt.dispose();failed.dispose();});
 it('revocation clears existing previews, aborts pending reads and prevents further network requests',async()=>{const fetcher=vi.fn(async()=>content()),session=new BoardDurableImageSession('board',()=>{},fetcher);await session.ensure(metadata);fetcher.mockImplementationOnce(async()=>new Response(null,{status:403}));const other={...metadata,assetId:'board-image-'+'b'.repeat(64)};await expect(session.ensure(other)).rejects.toThrow('IMAGE_ACCESS_DENIED');expect(session.get(metadata.assetId)).toBeUndefined();await expect(session.ensure(metadata)).rejects.toThrow('IMAGE_SESSION_CLOSED');expect(fetcher).toHaveBeenCalledTimes(2);expect(URL.revokeObjectURL).toHaveBeenCalled();});
 it('an in-flight read cannot populate the cache after unmount',async()=>{let finish!:(r:Response)=>void;const session=new BoardDurableImageSession('board',()=>{},vi.fn(()=>new Promise<Response>(resolve=>{finish=resolve;})));const pending=session.ensure(metadata);session.dispose();finish(content());await expect(pending).rejects.toThrow('IMAGE_SESSION_CLOSED');expect(session.get(metadata.assetId)).toBeUndefined();});
});
