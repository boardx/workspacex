import {randomUUID} from 'node:crypto';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {createRequire} from 'node:module';
const repo='/private/tmp/workspacex-board-i08-storage-import';
async function main(){
 if(!process.env.WORKSPACEX_ISOLATION_ID||!/^wsx_[a-f0-9]{20}$/.test(process.env.WORKSPACEX_DB??''))throw Error('ISOLATION_REQUIRED');
 const {ensureDatabase,migrateOnce,seedOrg,addOrgMember}=await import(repo+'/apps/api/tests/support/db.ts');
 const {PgDatabase}=await import(repo+'/apps/api/src/infrastructure/db/pg-database.ts');
 const {appConfig}=await import(repo+'/apps/api/src/infrastructure/db/pg-config.ts');
 const {FsObjectStore}=await import(repo+'/apps/api/src/infrastructure/storage/fs-object-store.ts');
 const {PgWhiteboardRepository}=await import(repo+'/apps/api/src/infrastructure/whiteboard/pg-whiteboard-repository.ts');
 const {PgWhiteboardCollaborationStore}=await import(repo+'/apps/api/src/infrastructure/whiteboard/pg-collaboration-store.ts');
 const {PgWhiteboardCommentStore}=await import(repo+'/apps/api/src/infrastructure/whiteboard/pg-whiteboard-comment-store.ts');
 const {PgBoardImageAssets}=await import(repo+'/apps/api/src/infrastructure/whiteboard/pg-image-assets.ts');
 const {WhiteboardImageAssets}=await import(repo+'/apps/api/src/application/whiteboard/image-assets.ts');
 const {SharpBoardImageVerifier}=await import(repo+'/apps/api/src/infrastructure/whiteboard/image-verifier.ts');
 const {WorkerWhiteboardUpdateValidator}=await import(repo+'/apps/api/src/infrastructure/whiteboard/update-validator.ts');
 ensureDatabase();await migrateOnce();const orgId='joint-drill-'+randomUUID(),userId='root-drill-owner',p={orgId,userId};
 await seedOrg({orgId,projectId:'drill-project'});await addOrgMember(orgId,userId,'consultant',null);
 const primary=await mkdtemp('/private/tmp/board-drill-primary-'),directory='/private/tmp/board-joint-drill-'+randomUUID(),db=new PgDatabase(appConfig());
 try{
  const fs=new FsObjectStore(primary),boards=new PgWhiteboardRepository(db),validator=new WorkerWhiteboardUpdateValidator(),store=new PgWhiteboardCollaborationStore(db,validator,120,fs),b=await boards.create(p,{requestId:randomUUID(),name:'Synthetic joint recovery'});
  const require=createRequire(repo+'/apps/api/package.json'),sharp=require('sharp');
  const bytes=await sharp({create:{width:32,height:24,channels:3,background:'#e71d49'}}).png().toBuffer();
  const metadata=await new WhiteboardImageAssets(boards,new PgBoardImageAssets(db),fs,new SharpBoardImageVerifier()).upload(p,b.id,bytes,'image/png');
  const object=(id:string,kind:string,text:string)=>({id,schemaVersion:1,kind,text,parentId:null,orderKey:id,geometry:{x:0,y:0,width:100,height:100,rotation:0},style:{}});
  await store.writeCommands(p,b.id,{epoch:1,requestId:randomUUID(),commands:[{type:'create',object:object('note','sticky','Synthetic recoverable note')},{type:'create',object:{...object('image','image',''),extensionData:{contentObject:{...metadata,version:1,type:'image',status:'ready',sourceUrl:null,failureCode:null,crop:{x:0,y:0,width:1,height:1},opacity:1,borderColor:'#000000',borderWidth:0,cornerRadius:0,fileName:'fixture.png',replacementOf:null}}}}]});
  await new PgWhiteboardCommentStore(db,validator,undefined,store,fs).dispatch(p,b.id,{type:'create-comment',requestId:randomUUID(),threadId:randomUUID(),commentId:randomUUID(),objectId:'note',worldPosition:null,body:'Synthetic recoverable comment',mentions:[],expectedRevision:0});
  const container=execFileSync('docker',['compose','-f',repo+'/apps/api/docker-compose.dev.yml','-p',process.env.COMPOSE_PROJECT_NAME!,'ps','-q','postgres'],{encoding:'utf8'}).trim();if(!container)throw Error('NO_OWNED_POSTGRES');
  await writeFile('/private/tmp/board-joint-current-fixture.json',JSON.stringify({directory,primary,boardId:b.id,orgId,userId})+'\n',{mode:0o600});
  execFileSync('pnpm',['--filter','api','exec','tsx','scripts/board-joint-recovery-drill.ts',orgId,userId,b.id],{cwd:repo,env:{...process.env,BOARD_JOINT_DRILL:'1',BOARD_DRILL_DIRECTORY:directory,BOARD_OBJECT_ROOT:primary,STARTER_POSTGRES_CONTAINER:container},stdio:'inherit',timeout:240000});
 }finally{await db.close();}
}
main().catch(error=>{console.error(error instanceof Error?error.message:'DRILL_FAILED');process.exitCode=1;});
