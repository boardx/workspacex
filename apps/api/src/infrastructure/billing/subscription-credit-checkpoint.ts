import type {PgConfig} from "../db/pg-config";

export function backfillCheckpointScope(config:Pick<PgConfig,"host"|"port"|"database">,apply:boolean,plans:readonly string[]){
 return {apply,plans:[...plans],host:config.host,port:config.port,database:config.database};
}
export function validateBackfillCheckpoint(value:unknown,scope:ReturnType<typeof backfillCheckpointScope>):{after:string;until:string}{
 if(!value||typeof value!=="object"||Array.isArray(value))throw Error("invalid_checkpoint");
 const state=value as Record<string,unknown>;
 if(state.host!==scope.host||state.port!==scope.port||state.database!==scope.database||state.apply!==scope.apply||JSON.stringify(state.plans)!==JSON.stringify(scope.plans))throw Error("checkpoint_scope_mismatch");
 if(state.complete===true)throw Error("checkpoint_complete_start_new_audit");
 if(state.complete!==false||typeof state.after!=="string"||typeof state.until!=="string")throw Error("invalid_checkpoint");
 return {after:state.after,until:state.until};
}
