import { describe,expect,it } from 'vitest';
import { PgWhiteboardDiscussion } from '../../src/infrastructure/whiteboard/pg-whiteboard-discussion';
import type { DatabasePort,TenantSession } from '../../src/application/ports/database.port';
const principal={orgId:'org-a' as never,userId:'user-a'}; const board='11111111-1111-4111-8111-111111111111'; const thread='22222222-2222-4222-8222-222222222222';
function repository(rows:unknown[][]){const calls:{sql:string;params?:readonly unknown[]}[]=[];const session:TenantSession={query:async(sql,params)=>{calls.push({sql,params});return {rows:(rows.shift()??[]) as never[]};}};const db={withTenant:async(_org:string,fn:(s:TenantSession)=>Promise<unknown>)=>fn(session)} as unknown as DatabasePort;return {repo:new PgWhiteboardDiscussion(db),calls};}
describe('PgWhiteboardDiscussion permission failures',()=>{
 it('allows viewers to read but performs no write',async()=>{const {repo,calls}=repository([[{role:'viewer',archived:false}]]);expect(await repo.reply(principal,board,thread,{requestId:crypto.randomUUID(),body:'no',mentionUserIds:[]})).toBeNull();expect(calls).toHaveLength(1);expect(calls[0]!.sql).toContain('whiteboards');});
 it('makes archived boards read-only for editors',async()=>{const {repo,calls}=repository([[{role:'editor',archived:true}]]);expect(await repo.resolve(principal,board,thread,{resolved:true})).toBeNull();expect(calls).toHaveLength(1);});
 it('does not reveal or persist a mention outside current board membership',async()=>{const {repo,calls}=repository([[{role:'editor',archived:false}],[]]);expect(await repo.reply(principal,board,thread,{requestId:crypto.randomUUID(),body:'secret',mentionUserIds:['other-tenant']})).toBeNull();expect(calls).toHaveLength(2);expect(calls[1]!.sql).toContain('org_memberships');expect(calls.some(c=>c.sql.includes('INSERT INTO whiteboard_discussion_comments'))).toBe(false);});
 it('treats freshly revoked membership like a missing board',async()=>{const {repo,calls}=repository([[]]);expect(await repo.createTask(principal,board,thread,{requestId:crypto.randomUUID(),assigneeId:null,dueAt:null})).toBeNull();expect(calls).toHaveLength(1);});
});
