import {randomUUID,randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {tsImport} from 'tsx/esm/api';
import {identity} from '@repo/contracts';
import {FULLSTACK_E2E as F} from '../fullstack-smoke-fixture';
const load=(path:string)=>tsImport(pathToFileURL(resolve(__dirname,`../../../api/${path}`)).href,{parentURL:pathToFileURL(__filename).href,tsconfig:resolve(__dirname,'../../../api/tsconfig.json')});
export const BOARD_SECURITY_ORG_ROLE=identity.OrgRole.parse('admin');
export async function securityFixture(){
 if(!process.env.WORKSPACEX_ISOLATION_ID||!process.env.WORKSPACEX_DB||process.env.WORKSPACEX_DB==='workspacex')throw new Error('ISOLATED_MAIN_SESSION_STACK_REQUIRED');
 const db=await load('tests/support/db.ts'),auth=await load('src/infrastructure/auth/bcrypt-password-hasher.ts');
 const id=randomUUID(),userId=`board-security-${id}`,orgId=`board-security-org-${id}`,email=`${userId}@example.test`,password=randomBytes(24).toString('base64url');
 const hash=await new auth.BcryptPasswordHasher().hash(password);
 await db.asOwner(async(c:any)=>{const actual=await c.query('SELECT current_database() AS name');if(actual.rows[0].name!==process.env.WORKSPACEX_DB)throw new Error('WRONG_DB');await c.query('INSERT INTO credentials(user_id,email,display_name,password_hash,email_verified_at) VALUES($1,$2,$3,$4,now())',[userId,email,'Security outsider',hash]);});
 await db.seedOrg({orgId,projectId:`security-project-${id}`,teamNames:[],groupNames:[]});await db.addOrgMember(orgId,userId,BOARD_SECURITY_ORG_ROLE,null);
 return{userId,orgId,email,password,cleanup:async()=>{await db.resetOrgs(orgId);await db.asOwner((c:any)=>c.query('DELETE FROM credentials WHERE user_id=$1',[userId]));}};
}
/** A real, independently stored short-lived session. Positive HTTP access precedes
 * actual wall-clock expiry; no clock mocking or arbitrary invalid bearer string. */
export async function shortLivedSecuritySession(){
 if(!process.env.WORKSPACEX_ISOLATION_ID)throw new Error('ISOLATION_REQUIRED');
 const {RedisSessionTokenStore,redisConfig}=await load('src/infrastructure/auth/redis-session-token-store.ts');
 const store=new RedisSessionTokenStore(redisConfig()),issuedAt=Date.now(),expiresAt=issuedAt+10000;
 const token=await store.issue({id:randomUUID(),userId:F.userId,currentOrgId:F.orgId,issuedAt,expiresAt,revokedAt:null,device:'board-security-expiry',location:null,lastActiveAt:issuedAt});
 await store.close();return{token,issuedAt,expiresAt};
}
