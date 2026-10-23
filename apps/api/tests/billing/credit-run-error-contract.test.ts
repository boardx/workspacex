import {beforeAll,expect,it} from "vitest";
import {wave2Runtime} from "@repo/contracts";
import {asOwner,ensureDatabase,migrateOnce} from "../support/db";
beforeAll(async()=>{ensureDatabase();await migrateOnce();});
it('persists every run failure code, including credit admission, without enum drift',async()=>{
 const constraint=await asOwner(async c=>(await c.query<{definition:string}>("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='agent_runs'::regclass AND conname='agent_runs_error_code_check'")).rows[0]!.definition);
 const codes=Array.from(constraint.matchAll(/'([A-Z_]+)'/g),match=>match[1]);
 expect(new Set(codes)).toEqual(new Set(wave2Runtime.AgentRunError.options));
});
