import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {tsImport} from 'tsx/esm/api';
type Session={query<T>(sql:string,values?:unknown[]):Promise<{rows:T[]}>};
/** Read-only durable counterproof remains available after board access is revoked. */
export async function connectorDurableState(orgId:string,boardId:string){
 if(!process.env.WORKSPACEX_ISOLATION_ID||!process.env.WORKSPACEX_DB||process.env.WORKSPACEX_DB==='workspacex')throw new Error('CONNECTOR_ISOLATED_DATABASE_REQUIRED');
 const fixture=await tsImport(pathToFileURL(resolve(__dirname,'../../../api/tests/support/db.ts')).href,{parentURL:pathToFileURL(__filename).href,tsconfig:resolve(__dirname,'../../../api/tsconfig.json')}) as {asApp<T>(org:string,action:(session:Session)=>Promise<T>):Promise<T>};
 return fixture.asApp(orgId,async session=>{
  const identity=(await session.query<{database:string;role:string;tenant:string;superuser:boolean;bypass:boolean;owner:string;rls:boolean;forced:boolean}>("SELECT current_database() AS database,current_user AS role,current_setting('app.current_org',true) AS tenant,p.rolsuper AS superuser,p.rolbypassrls AS bypass,pg_get_userbyid(c.relowner) AS owner,c.relrowsecurity AS rls,c.relforcerowsecurity AS forced FROM pg_roles p JOIN pg_class c ON c.relname='whiteboard_documents' AND c.relnamespace='public'::regnamespace WHERE p.rolname=current_user")).rows[0];
  if(!identity||identity.database!==process.env.WORKSPACEX_DB||identity.role!=='app_rw'||identity.tenant!==orgId||identity.superuser||identity.bypass||identity.owner===identity.role||!identity.rls||!identity.forced)throw new Error('CONNECTOR_REAL_TENANT_RLS_REQUIRED');
  const documents=(await session.query<{epoch:number;seq:string;content_hash:string|null;object_key:string|null;byte_size:string|null}>('SELECT epoch,seq::text,content_hash,object_key,byte_size::text FROM whiteboard_documents WHERE org_id=$1 AND board_id=$2',[orgId,boardId])).rows;
  if(documents.length!==1)throw new Error('CONNECTOR_DURABLE_DOCUMENT_REQUIRED');
  const updates=(await session.query<{epoch:number;seq:string;actor_id:string;update_id:string;request_hash:string}>('SELECT epoch,seq::text,actor_id,update_id,request_hash FROM whiteboard_updates WHERE org_id=$1 AND board_id=$2 ORDER BY epoch,seq',[orgId,boardId])).rows;
  return {identity,document:documents[0]!,updates};
 });
}
