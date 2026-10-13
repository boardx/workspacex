import {CHAT_READ_E2E} from '../../../apps/web/e2e/chat-read-fixture';
import {createRequire} from 'node:module';
const artifact=createRequire(import.meta.url)('./next-production-artifact.cjs');
const operation=process.argv.slice(2);
if(operation.length>1||(operation.length===1&&operation[0]!=='--verify'))throw Error('CN_SIX_PRODUCTION_OPERATION');
const task=operation[0]==='--verify'?Promise.resolve().then(()=>artifact.verify(process.env.CN_SIX_WEB_ARTIFACT,artifact.bindings(process.env,CHAT_READ_E2E.deepAgentId))):artifact.build(process.env,CHAT_READ_E2E.deepAgentId);
task.catch(()=>{process.stderr.write('CN_SIX_PRODUCTION_BUILD_FAILED\n');process.exitCode=1;});
