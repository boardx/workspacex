/** Generated embedded policy keeps the installed root helper standalone. */
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {SOURCE_VERIFICATION_PROFILES} from './ci-devapp-integration-gate.mjs';
const path=fileURLToPath(new URL('./vm/devapp-runtime-identity.mjs',import.meta.url));
const text=readFileSync(path,'utf8');
const pattern=/export const CANDIDATE_SOURCE_VERIFICATION_PROFILES = \{[\s\S]*?\n\};/g;
if([...text.matchAll(pattern)].length!==1)throw Error('Expected exactly one embedded CI policy');
const generated='export const CANDIDATE_SOURCE_VERIFICATION_PROFILES = '+JSON.stringify(SOURCE_VERIFICATION_PROFILES,null,2)+';';
const next=text.replace(pattern,generated);
if(process.argv.includes('--check')){
 if(next!==text){console.error('Embedded Devapp CI policy drift; run node .harness/scripts/gen-devapp-ci-policy.mjs');process.exitCode=1;}
}else writeFileSync(path,next);
