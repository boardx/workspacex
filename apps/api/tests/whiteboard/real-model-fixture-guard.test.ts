import {expect,it,vi} from 'vitest';
import {assertBoardRealFixtureTarget,assertRealBoardModel,prepareBoardRealFixture} from '../../scripts/support/board-real-model-fixture';
const env={BOARD_REAL_MODEL_PREPARE_FIXTURE:'1',REAL_MODEL_E2E_USE_FULLSTACK_SEED:'1',WORKSPACEX_ISOLATION_ID:'board-acceptance',WORKSPACEX_DB:'wsx_1234567890abcdef1234',PGDATABASE:'wsx_1234567890abcdef1234',PGHOST:'127.0.0.1',PGPORT:'54329',WORKSPACEX_WEB_PORT:'31299',REAL_MODEL_E2E_BASE_URL:'http://127.0.0.1:31299'};
it('accepts explicit isolated local fixture target',()=>expect(()=>assertBoardRealFixtureTarget(env)).not.toThrow());
it.each([{PGHOST:'production.example'},{REAL_MODEL_E2E_BASE_URL:'https://devapp.example'},{WORKSPACEX_ISOLATION_ID:''},{PGDATABASE:'workspacex'},{WORKSPACEX_DB:'wsx_wrong'},{BOARD_REAL_MODEL_PREPARE_FIXTURE:'0'},{REAL_MODEL_E2E_USE_FULLSTACK_SEED:'0'},{WORKSPACEX_DEPLOY_PROFILE:'production'},{REAL_MODEL_E2E_BASE_URL:'http://127.0.0.1:3000'}])('rejects unsafe target %j',patch=>expect(()=>assertBoardRealFixtureTarget({...env,...patch})).toThrow());
it.each(['loopback/e2e','mock/model','fixture/model','model'])('rejects non-real published model %s',model=>expect(()=>assertRealBoardModel(model)).toThrow());
it('rejects missing principal before any fixture writes',async()=>{const query=vi.fn(async(_sql:string)=>({rows:[]}));await expect(prepareBoardRealFixture({query} as never,{orgId:'org',userId:'user',agentId:'agent'})).rejects.toThrow('seeded principal');expect(query.mock.calls.some(([sql])=>String(sql).startsWith('INSERT'))).toBe(false);expect(query).toHaveBeenLastCalledWith('ROLLBACK');});
it('rejects loopback source before creating actor or skill',async()=>{const query=vi.fn(async(sql:string)=>({rows:sql.includes('org_memberships')?[{user_id:'user'}]:sql.includes('JOIN agent_versions')?[{model_provider:'loopback',model_id:'e2e'}]:[]}));await expect(prepareBoardRealFixture({query} as never,{orgId:'org',userId:'user',agentId:'agent'})).rejects.toThrow('real provider');expect(query.mock.calls.some(([sql])=>sql.startsWith('INSERT'))).toBe(false);});
it('uses published source model, immutable skill publish and a separate delegated actor',async()=>{
 const query=vi.fn(async(sql:string)=>({rows:sql.includes('org_memberships')?[{user_id:'user'}]:sql.includes('JOIN agent_versions')?[{model_provider:'dashscope',model_id:'qwen-plus'}]:sql.startsWith('SELECT published')?[{published:false}]:[]}));
 const result=await prepareBoardRealFixture({query} as never,{orgId:'org',userId:'user',agentId:'seed-agent'});
 expect(result).toMatchObject({model:'dashscope/qwen-plus',actorId:'seed-agent-board-organize',skill:'seed-agent-board-organize-skill-v1'});
 expect(query).toHaveBeenCalledWith('SELECT wave2_publish_skill_version($1,$2)',['org',result.skill]);
 expect(query.mock.calls.some(([sql])=>/GRANT|ALTER ROLE|UPDATE agent_versions|UPDATE skill_versions/.test(sql))).toBe(false);
 expect(query).toHaveBeenLastCalledWith('COMMIT');
});
