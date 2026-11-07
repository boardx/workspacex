/** Complete only the fixed proof history through the existing origin; never bypass unrelated history. */
import type {ProofGit,SquashReconstruction} from "./squash-integration-proof";
const oid=(s:string)=>/^[a-f0-9]{40}$/.test(s);
export function completeSquashProofHistory(git:ProofGit,proofs:SquashReconstruction[],note:(line:string)=>void):void{
 const shallow=()=>{const r=git("rev-parse --is-shallow-repository");if(r.code!==0||!["true","false"].includes(r.out.trim()))throw new Error("PROOF_HISTORY_UNKNOWN");return r.out.trim()==="true";};
 const bases=(p:SquashReconstruction)=>{const r=git(`merge-base --all ${p.parent} ${p.source}`);
  const ids=r.out.trim().split(/\s+/).filter(Boolean);return r.code===0&&ids.length>0&&ids.every(oid)?ids.length:0;};
 for(const p of proofs)if(![p.source,p.parent,p.squash].every(oid))throw new Error("PROOF_HISTORY_IDENTITY");
 const before=shallow(),counts=proofs.map(bases);
 note("PROOF_HISTORY_BEFORE "+JSON.stringify({shallow:before,mergeBaseCounts:counts}));
 if(before||counts.some(n=>n===0)){
  const ids=[...new Set(proofs.flatMap(p=>[p.parent,p.source,p.squash]))];
  if(ids.length===0)throw new Error("PROOF_HISTORY_NO_INPUTS");
  // One ordinary fetch to the existing origin. No depth limit, alternate remote or retry.
  const result=git(`fetch --no-tags --no-write-fetch-head ${before?"--unshallow ":""}origin ${ids.join(" ")}`);
  if(result.code!==0)throw new Error("PROOF_HISTORY_FETCH_REJECTED");
 }
 const after=shallow(),actual=proofs.map(bases);
 note("PROOF_HISTORY_AFTER "+JSON.stringify({shallow:after,mergeBaseCounts:actual}));
 if(after||actual.some(n=>n===0))throw new Error("PROOF_HISTORY_INCOMPLETE");
}
