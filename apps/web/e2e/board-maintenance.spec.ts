import {test,expect} from '@playwright/test';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {resolve} from 'node:path';
import {writeFile} from 'node:fs/promises';
const exec=promisify(execFile);
test('real PostgreSQL and files retain live roots and recover the exact snapshot',async({},info)=>{
 const {stdout}=await exec('pnpm',['--filter','@repo/api','exec','vitest','run','--config','vitest.board-maintenance-acceptance.config.ts'],{cwd:resolve(__dirname,'../../..'),env:process.env,timeout:220000,maxBuffer:1024*1024});
 const records=stdout.split('\n').filter(line=>line.includes('BOARD_MAINTENANCE_')).map(line=>line.slice(line.indexOf('BOARD_MAINTENANCE_')));
 expect(records).toHaveLength(2);await writeFile(info.outputPath('maintenance-evidence.json'),JSON.stringify({records},null,2));
});
