import {expect,it} from "vitest";
import {backfillCheckpointScope,validateBackfillCheckpoint} from "../../src/infrastructure/billing/subscription-credit-checkpoint";

const config={host:"db-one.internal",port:5432,database:"billing"};
const scope=()=>backfillCheckpointScope(config,false,["price_month"]);
const saved=()=>({...scope(),after:"user_a",until:"user_z",complete:false});
it("resumes the same endpoint and scope with its original page bounds",()=>{
 expect(validateBackfillCheckpoint(saved(),scope())).toEqual({after:"user_a",until:"user_z"});
});
it.each([{host:"db-two.internal"},{port:55432},{database:"other"}])("refuses another database endpoint or name: %j",change=>{
 expect(()=>validateBackfillCheckpoint(saved(),backfillCheckpointScope({...config,...change},false,["price_month"]))).toThrow("checkpoint_scope_mismatch");
});
it("refuses apply/mapping changes and old checkpoints lacking endpoint identity",()=>{
 expect(()=>validateBackfillCheckpoint(saved(),backfillCheckpointScope(config,true,["price_month"]))).toThrow("checkpoint_scope_mismatch");
 expect(()=>validateBackfillCheckpoint(saved(),backfillCheckpointScope(config,false,["price_other"]))).toThrow("checkpoint_scope_mismatch");
 expect(()=>validateBackfillCheckpoint({apply:false,plans:["price_month"],database:config.database,after:"",until:"z",complete:false},scope())).toThrow("checkpoint_scope_mismatch");
});
it("rejects completed or malformed page bounds before database access",()=>{
 expect(()=>validateBackfillCheckpoint({...saved(),complete:true},scope())).toThrow("checkpoint_complete_start_new_audit");
 expect(()=>validateBackfillCheckpoint({...saved(),after:7},scope())).toThrow("invalid_checkpoint");
});
