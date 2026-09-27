import {createHash} from 'node:crypto';
import type {Client} from 'pg';
import {assertIsolatedDatabase} from '../../../../.harness/scripts/lib/test-isolation';
import {PUBLISHED_AGENT_ENABLED,PUBLISHED_AGENT_VERSION_MATCH} from '../../src/infrastructure/agent/published-agent-sql';
export function assertBoardRealFixtureTarget(env:NodeJS.ProcessEnv){
 if(env.BOARD_REAL_MODEL_PREPARE_FIXTURE!=='1'||env.REAL_MODEL_E2E_USE_FULLSTACK_SEED!=='1')throw new Error('BOARD_REAL_MODEL_PREPARE_FIXTURE=1 and REAL_MODEL_E2E_USE_FULLSTACK_SEED=1 required');
 if(!env.WORKSPACEX_ISOLATION_ID||!/^wsx_[a-f0-9]{20}$/.test(env.PGDATABASE??'')||env.WORKSPACEX_DEPLOY_PROFILE)throw new Error('isolated local test database required');
 assertIsolatedDatabase({resolvedDatabase:env.PGDATABASE!,env});
 if(!['127.0.0.1','localhost','::1'].includes(env.PGHOST??''))throw new Error('remote PG forbidden');
 const web=new URL(env.REAL_MODEL_E2E_BASE_URL??`http://127.0.0.1:${env.WORKSPACEX_WEB_PORT}`);
 if(!['127.0.0.1','localhost','[::1]'].includes(web.hostname)||web.protocol!=='http:')throw new Error('remote deployment forbidden');
 if(!env.PGPORT||!env.WORKSPACEX_WEB_PORT||web.port!==env.WORKSPACEX_WEB_PORT)throw new Error('isolated ports required');
}
export function assertRealBoardModel(model:string){if(!model.includes('/')||/loopback|mock|fixture|e2e/i.test(model))throw new Error('published real provider/model required');}
/** Uses the existing seed account and published agent model. A dedicated immutable
 * fixture skill is assembled and published through the same product SQL function;
 * no original agent, skill or production permissions are modified. */
export async function prepareBoardRealFixture(client:Pick<Client,'query'>,identity:{orgId:string;userId:string;agentId:string}){
 const {orgId,userId,agentId}=identity;
 await client.query('BEGIN');
 try{
  await client.query("SELECT set_config('app.current_org',$1,true)",[orgId]);
  const account=await client.query('SELECT user_id FROM org_memberships WHERE org_id=$1 AND user_id=$2',[orgId,userId]);
  if(!account.rows.length)throw new Error('isolated seeded principal required');
  const source=await client.query<{model_provider:string;model_id:string}>(`SELECT v.model_provider,v.model_id FROM agents a JOIN agent_versions v ON ${PUBLISHED_AGENT_VERSION_MATCH} WHERE a.org_id=$1 AND a.id=$2 AND ${PUBLISHED_AGENT_ENABLED}`,[orgId,agentId]);
  const row=source.rows[0];if(!row)throw new Error('published seed agent required');const model=`${row.model_provider}/${row.model_id}`;assertRealBoardModel(model);
  const skillId=`${agentId}-board-organize-skill`,skillVersion=`${skillId}-v1`,actorId=`${agentId}-board-organize`,versionId=`${actorId}-${createHash('sha256').update(model).digest('hex').slice(0,12)}`;
  const content='# Semantic Board Organize\nRead every selected note, group related needs by meaning, and name concise useful themes. Preserve every input ID exactly once. Return only the requested JSON schema; never create, remove or paraphrase notes.';
  const digest=createHash('sha256').update(content).digest('hex');
  await client.query("INSERT INTO skills(id,org_id,stable_name,name,status,creator_id,created_at,updated_at) VALUES($1,$2,$1,'Board Organize acceptance','enabled',$3,now(),now()) ON CONFLICT(id) DO NOTHING",[skillId,orgId,userId]);
  await client.query("INSERT INTO skill_versions(id,org_id,skill_id,semantic_label,content_digest,manifest,creator_id,created_at,published) VALUES($1,$2,$3,'1.0.0',$4,'{}'::jsonb,$5,now(),false) ON CONFLICT(id) DO NOTHING",[skillVersion,orgId,skillId,digest,userId]);
  const skill=await client.query<{published:boolean}>('SELECT published FROM skill_versions WHERE org_id=$1 AND id=$2',[orgId,skillVersion]);
  if(skill.rows[0]?.published===false){
  await client.query("INSERT INTO skill_version_files(org_id,version_id,path,content,media_type,digest) VALUES($1,$2,'SKILL.md',$3,'text/markdown',$4) ON CONFLICT(version_id,path) DO NOTHING",[orgId,skillVersion,Buffer.from(content),digest]);
   await client.query('SELECT wave2_publish_skill_version($1,$2)',[orgId,skillVersion]);
  }
  await client.query("INSERT INTO agents(id,org_id,stable_name,name,status,creator_id,created_at,updated_at) VALUES($1,$2,$1,'Board Organize acceptance','enabled',$3,now(),now()) ON CONFLICT(id) DO NOTHING",[actorId,orgId,userId]);
  await client.query("INSERT INTO agent_versions(id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,model_provider,model_id,tool_policy,creator_id,created_at,published_at) VALUES($1,$2,$3,'1.0.0',$4,$5,$6,$7,$8,'[]'::jsonb,$9,now(),now()) ON CONFLICT(id) DO NOTHING",[versionId,orgId,actorId,digest,content,[skillVersion],row.model_provider,row.model_id,userId]);
  await client.query('UPDATE agents SET published_version_id=$1 WHERE org_id=$2 AND id=$3',[versionId,orgId,actorId]);
  await client.query("INSERT INTO whiteboard_actor_identities(org_id,actor_id,kind,delegated_by,scopes,model_snapshot,skill_snapshot,enabled) VALUES($1,$2,'ai',$3,$4,$5,$6,true) ON CONFLICT(org_id,actor_id) DO UPDATE SET delegated_by=EXCLUDED.delegated_by,scopes=EXCLUDED.scopes,model_snapshot=EXCLUDED.model_snapshot,skill_snapshot=EXCLUDED.skill_snapshot,enabled=true",[orgId,actorId,userId,['board:read','board:write'],model,skillVersion]);
  await client.query('COMMIT');return{actorId,model,skill:skillVersion,agentVersionId:versionId};
 }catch(error){await client.query('ROLLBACK');throw error;}
}
