import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {assertAgentApiTarget} from '../../scripts/verify-board-agent-api';
it('refuses disabled, shared, remote and production API acceptance before database or HTTP work',()=>{
 for(const env of [{},{BOARD_AGENT_API_ACCEPTANCE:'1'},{BOARD_AGENT_API_ACCEPTANCE:'1',WORKSPACEX_ISOLATION_ID:'x',PGDATABASE:'workspacex',PGHOST:'127.0.0.1'},{BOARD_AGENT_API_ACCEPTANCE:'1',WORKSPACEX_DEPLOY_PROFILE:'prod'}])expect(()=>assertAgentApiTarget(env)).toThrow();
});

it('provisions and revokes service actors through the public lifecycle API',()=>{
 const source=readFileSync(new URL('../../scripts/verify-board-agent-api.ts',import.meta.url),'utf8');
 expect(source).toContain('/actors/service');
 expect(source).toContain('x-board-actor-credential');
 expect(source).not.toMatch(/(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+whiteboard_actor_identities/i);
});
