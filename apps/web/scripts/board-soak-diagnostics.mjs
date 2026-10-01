import {existsSync,readdirSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
/** Retain only allowlisted classifications and counts, never source log lines. */
export function boardSoakDiagnostics(stdout, stderr, status) {
 const text=String(stdout??'')+'\n'+String(stderr??'');
 const phases=[...text.matchAll(/^BOARD_SOAK_PHASE (initial-sync|measurement|recovery|verification)\r?$/gm)].map(match=>match[1]);
 const checkoutTimeouts=(text.match(/timeout exceeded when trying to connect|POOL_CHECKOUT_TIMEOUT/gi)??[]).length;
 const unavailable=(text.match(/DEPENDENCY_UNAVAILABLE/g)??[]).length;
 return {version:1,phase:phases.at(-1)??'startup',phases,exitCode:Number.isInteger(status)&&status>=0&&status<=255?status:1,
  pool:{classification:checkoutTimeouts?'checkout-timeout':unavailable?'dependency-unavailable':'not-observed',checkoutTimeouts,unavailable}};
}

/** Remove only unclassified files in this run's disposable browser artifact directory. */
export function discardUnclassifiedSoakFiles(directory) {
 if(!existsSync(directory))return 0;
 const retained=new Set(['board-soak-ledger.json','board-soak-runtime.json','board-soak-partial.json']);
 let discarded=0;
 for(const entry of readdirSync(directory,{withFileTypes:true})){
  const path=join(directory,entry.name);
  if(entry.isDirectory())discarded+=discardUnclassifiedSoakFiles(path);
  else if(!retained.has(entry.name)){unlinkSync(path);discarded++;}
 }
 return discarded;
}
