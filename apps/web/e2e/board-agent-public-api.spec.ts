import {test} from '@playwright/test';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {resolve} from 'node:path';
import {readFile} from 'node:fs/promises';
const exec=promisify(execFile);
test('real public Agent API operations and authoritative Undo/Redo',async({},info)=>{
 const output=info.outputPath('agent-api-evidence.json');
 await exec('pnpm',['--filter','api','exec','tsx','scripts/verify-board-agent-api.ts'],{cwd:resolve(__dirname,'../../..'),env:{...process.env,BOARD_AGENT_API_ACCEPTANCE:'1',BOARD_AGENT_API_ACCEPTANCE_RUN:'1',BOARD_AGENT_API_EVIDENCE:output},timeout:170000,maxBuffer:1024*1024});
 await info.attach('agent-api-evidence',{body:await readFile(output),contentType:'application/json'});
});
