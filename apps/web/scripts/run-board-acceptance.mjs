import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {boardAcceptanceMatrix} from './board-acceptance-matrix.mjs';

const exactSha=process.env.BOARD_ACCEPTANCE_SHA;
if(!/^[a-f0-9]{40}$/.test(exactSha??''))throw new Error('BOARD_ACCEPTANCE_SHA must be an exact 40-character commit SHA');
if(process.env.BOARD_SOAK_DURATION_MS && Number(process.env.BOARD_SOAK_DURATION_MS)<1_800_000)throw new Error('BOARD_SOAK_DURATION_MS must be at least 1800000');
if(process.argv.includes('--list')){process.stdout.write(`${JSON.stringify({sha:exactSha,lanes:boardAcceptanceMatrix},null,2)}\n`);process.exit(0);}
const root=resolve(import.meta.dirname,'../../..'),output=resolve(root,'artifacts','board-acceptance',exactSha);mkdirSync(output,{recursive:true});
const rows=[];
for(const entry of boardAcceptanceMatrix){const startedAt=new Date().toISOString();const result=spawnSync(entry.command[0],entry.command.slice(1),{cwd:root,env:{...process.env,BOARD_ACCEPTANCE_SHA:exactSha},encoding:'utf8'});const endedAt=new Date().toISOString();const artifactPath=resolve(output,`${entry.lane}.log`);writeFileSync(artifactPath,`${result.stdout??''}${result.stderr??''}`);rows.push({lane:entry.lane,sha:exactSha,command:entry.command.join(' '),startedAt,endedAt,exitCode:result.status??1,environment:process.env.BOARD_ACCEPTANCE_ENVIRONMENT??'',artifactPath,counterproof:false});if(result.status!==0)break;}
writeFileSync(resolve(output,'run.json'),`${JSON.stringify(rows,null,2)}\n`);
if(rows.length!==boardAcceptanceMatrix.length||rows.some(row=>row.exitCode!==0))process.exitCode=1;
