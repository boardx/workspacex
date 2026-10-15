/** Test-only composition: real Nest/PG; GitHub HTTP protocol is loopback. */
import {startGithubProtocolFixture} from './github-loopback';
import {createRequire} from 'node:module';
import {CHAT_READ_E2E as F} from '../../../apps/web/e2e/chat-read-fixture';
import {migrationConfig} from '../../../apps/api/src/infrastructure/db/pg-config';
const require=createRequire(new URL('../../../apps/api/package.json',import.meta.url));
const pg=require('pg');
function need(v:unknown,code:string):asserts v{if(!v)throw Error(code);}
const cfg=migrationConfig();
need(process.env.CN_RELEASE_FULLSTACK_FIXTURE==='1'&&cfg.host==='127.0.0.1'&&/^wsx_[a-f0-9]{20}$/.test(cfg.database??'')&&cfg.database===process.env.WORKSPACEX_DB,'EXPLICIT_ISOLATED_DATABASE_REQUIRED');
need(process.env.WORKSPACEX_REUSE_INFRA!=='1','FRESH_INFRA_REQUIRED');
const port=Number(process.env.WORKSPACEX_API_PORT);need(Number.isInteger(port)&&port>0&&port<65536,'ISOLATED_PORT_REQUIRED');
const owner=new pg.Client(cfg);await owner.connect();
try{
 await owner.query('BEGIN');
 const updated=await owner.query("UPDATE org_memberships SET org_role='admin' WHERE user_id=$1 AND org_id=$2",[F.userId,F.orgId]);need(updated.rowCount===1,'FIXTURE_USER_REQUIRED');
 await owner.query("INSERT INTO product_feedback(id,org_id,submitted_by,kind,target_kind,title,detail,github_issue_url,github_issue_number) VALUES($1,$2,$3,'缺陷','product','isolated six journey','synthetic only','https://github.com/fixture-only/six-journey/issues/1',1)",['cn-six-feedback',F.orgId,F.userId]);
 await owner.query('COMMIT');
}finally{await owner.end();}
const github=await startGithubProtocolFixture();
globalThis.fetch=github.fetch;
process.env.GITHUB_ISSUE_TOKEN='synthetic-loopback-only';process.env.GITHUB_ISSUE_REPO_OWNER='fixture-only';process.env.GITHUB_ISSUE_REPO_NAME='six-journey';
const {startApi}=await import('../../../apps/api/src/main');
const app=await startApi({port,listenHost:'127.0.0.1',loadLocalEnv:false});
const close=async()=>{await app.close();await github.close();process.stdout.write(JSON.stringify({kind:'cn-six-provider-observation',githubReads:github.reads(),githubProvider:'loopback',productionAccepted:false})+'\n');process.exit(0);};
process.once('SIGTERM',()=>void close());process.once('SIGINT',()=>void close());
