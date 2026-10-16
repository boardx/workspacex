import {readFileSync} from 'node:fs';
import {asApp} from '../../tests/support/db';
import {FsObjectStore} from '../../src/infrastructure/storage/fs-object-store';
import {objectStoreRoot} from '../../src/infrastructure/storage/object-store-root';
import {ObjectExistsError} from '../../src/application/artifact/ports';
import {chatPublicShareThreadId} from '../../../web/e2e/chat-public-share-fixture';

/** Only called by the isolated fullstack seed, after its real owner identity exists. */
export async function seedChatPublicShare(orgId:string,userId:string):Promise<void>{
 if(process.env.FULLSTACK_E2E_FIXTURE!=='1')throw new Error('ISOLATED_FULLSTACK_FIXTURE_REQUIRED');
 const threadId=chatPublicShareThreadId(userId),key=`fullstack-chat-share/${threadId}/image`;
 const image=readFileSync(new URL('../../../web/public/apple-icon.png',import.meta.url));
 const store=new FsObjectStore(objectStoreRoot());
 try{await store.putOnce(key,image,'image/png');}catch(error){
  if(!(error instanceof ObjectExistsError))throw error;
  const existing=await store.get(key);if(!existing||!Buffer.from(existing).equals(image))throw new Error('CHAT_SHARE_FIXTURE_IMAGE_MISMATCH');
 }
 await asApp(orgId,async client=>{
  await client.query(`INSERT INTO chat_threads (id,org_id,project_id,visibility_scope,title,created_by,title_source)
   VALUES ($1,$2,NULL,'private','与朋友分享的对话',$3,'user') ON CONFLICT (id) DO NOTHING`,[threadId,orgId,userId]);
  await client.query(`INSERT INTO chat_messages (id,org_id,thread_id,author_kind,author_id,body)
   VALUES ($1,$2,$3,'human',$4,$5),($6,$2,$3,'agent','assistant',$7) ON CONFLICT (id) DO NOTHING`,
   [`${threadId}-question`,orgId,threadId,userId,'帮我解释一下这个计划，朋友无需账号也能看。',`${threadId}-answer`,
    "这是 **公开分享** 的阅读页。\n\n```typescript\nconst message = 'hello friend';\nconsole.log(message);\n```\n\n<script>window.shareXss=true</script>\n\n[不安全链接](javascript:alert(1))"]);
  await client.query(`INSERT INTO chat_message_attachments (id,org_id,thread_id,message_id,filename,mime,bytes,storage_ref,uploaded_by)
   VALUES ($1,$2,$3,$4,'图片.png','image/png',$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
   [`${threadId}-image`,orgId,threadId,`${threadId}-question`,image.length,key,userId]);
 });
}
