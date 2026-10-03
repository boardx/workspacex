#!/usr/bin/env node
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createPrivateEvidenceDirectory,writeSafeFailure} from './support/sticky-suite/wsx-r06-private-evidence.mjs';

const args=process.argv.slice(2);let out,phase='evidence-root';
try{
 const outputIndex=args.indexOf('--out');
 if(outputIndex<0||args.lastIndexOf('--out')!==outputIndex||!args[outputIndex+1]||args[outputIndex+1].startsWith('--'))throw new Error('STICKY_SUITE_OUTPUT_REQUIRED');
 out=createPrivateEvidenceDirectory(args[outputIndex+1]);
 phase='source-preflight';
 const {runStickySuiteCli}=await import('./support/sticky-suite/wsx-r06-full-suite-cli.mjs');
 phase='suite-preflight-and-execution';await runStickySuiteCli(args,out);
}catch(error){
 process.exitCode=1;
 if(out){
  try{writeSafeFailure(out,phase);}catch{console.error(JSON.stringify({status:'failed',phase:'safe-receipt',code:'STICKY_SUITE_FAILURE'}));}
  try{writeFileSync(join(out,'private-failure.json'),JSON.stringify({phase,error:error?.stack??String(error)},null,2),{flag:'wx',mode:0o600});}catch{}
 }
 console.error(JSON.stringify({status:'failed',requiredSuiteComplete:false,phase,code:'STICKY_SUITE_FAILURE'}));
}
