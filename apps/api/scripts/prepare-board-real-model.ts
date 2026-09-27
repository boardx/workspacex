import {assertBoardRealFixtureTarget,prepareBoardRealFixture} from './support/board-real-model-fixture';
import {FULLSTACK_E2E} from '../../web/e2e/fullstack-smoke-fixture';
async function main(){
 assertBoardRealFixtureTarget(process.env);
 // Import the established owner fixture path only after local isolation validation.
 const {asOwner}=await import('../tests/support/db');
 const result=await asOwner(client=>prepareBoardRealFixture(client,{orgId:FULLSTACK_E2E.orgId,userId:FULLSTACK_E2E.userId,agentId:FULLSTACK_E2E.agentId}));
 process.stdout.write(JSON.stringify(result)+'\n');
}
main().catch(()=>{console.error('Board real-model fixture failed; verify isolated seed, published real model, and owner fixture access. Credentials are not logged.');process.exitCode=1;});
