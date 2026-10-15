// Fixed markers only; primary error text stays in the private reporter.
export const NATIVE_FAILURE_STAGES=Object.freeze({R01:Object.freeze(['SETUP','SOURCE','MANIFEST','LOGIN','ACTOR','CREATE_BOARD','CASE','END_RUNTIME','FINAL_PROOF']),R08:Object.freeze(['SETUP','INITIAL_ORIGIN_SYNC','INITIAL_PEER_SYNC','TAKEOVER_ROWS','TAKEOVER_SYNC','REAL503_DENIAL','REAL503_SYNC','RELOAD_SYNC'])});
export function fixedNativeFailure(suite,stage){return NATIVE_FAILURE_STAGES[suite]?.includes(stage)?`${suite}_NATIVE_FAILURE ${stage}`:`${suite}_NATIVE_FAILURE UNKNOWN`;}
export function parseNativeFailure(message,file){
 if(typeof message!=='string'||message.length>8192)return null;
 const line=message.split(/\r?\n/,1)[0],match=/^(?:AggregateError: )?(R01|R08)_NATIVE_FAILURE ([A-Z0-9_]+)( FINAL_PROOF)?$/.exec(line);
 if(!match||file!==(match[1]==='R01'?'board-r01-native-matrix.spec.ts':'board-peer-origin-close.spec.ts')||!NATIVE_FAILURE_STAGES[match[1]].includes(match[2]))return null;
 return {suite:match[1],stage:match[2],primaryFailure:'PRIVATE_REPORT_RETAINED',...(match[3]?{secondaryStage:'FINAL_PROOF'}:{})};
}
