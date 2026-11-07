import {sh} from "./lib/sh";
import {REPO_ROOT} from "./lib/paths";
import {parseSquashReconstructions} from "./lib/squash-integration-proof";
import {completeSquashProofHistory} from "./lib/squash-proof-history";
try{
 if(process.env.GITHUB_ACTIONS!=="true")throw new Error("PROOF_HISTORY_CI_ONLY");
 const git=(cmd:string)=>{const r=sh("git "+cmd,REPO_ROOT);return{code:r.code,out:r.stdout};};
 const config=git("show HEAD:.harness/config/squash-integration-proofs.json");
 if(config.code!==0)throw new Error("PROOF_HISTORY_CONFIG");
 completeSquashProofHistory(git,parseSquashReconstructions(config.out),console.log);
}catch(error){console.error(error instanceof Error&&/^PROOF_HISTORY_[A-Z_]+$/.test(error.message)?error.message:"PROOF_HISTORY_REJECTED");process.exitCode=1;}
