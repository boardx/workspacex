export type ImageCleanup = () => void | Promise<void>;
/** Every allocated resource is registered immediately; one cleanup cannot suppress another. */
export async function withImageOwnedCleanup(body:(own:(cleanup:ImageCleanup)=>void)=>Promise<void>){
 const cleanups:ImageCleanup[]=[];let failed=false,primary:unknown;
 try{await body(cleanup=>cleanups.push(cleanup));}
 catch(error){failed=true;primary=error;}
 const outcomes=await Promise.allSettled(cleanups.map(cleanup=>Promise.resolve().then(cleanup)));
 const errors=outcomes.flatMap(outcome=>outcome.status==='rejected'?[outcome.reason]:[]);
 if(errors.length)throw new AggregateError(failed?[primary,...errors]:errors,'Image acceptance primary/owned cleanup failures',failed?{cause:primary}:undefined);
 if(failed)throw primary;
}
