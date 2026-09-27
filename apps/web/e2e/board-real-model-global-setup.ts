import {execFileSync} from 'node:child_process';
import path from 'node:path';
/** Only root's explicit local test invocation mutates fixture PG. */
export default async function setup(){
 if(process.env.BOARD_REAL_MODEL_PREPARE_FIXTURE!=='1')return;
 const output=execFileSync('pnpm',['--filter','@repo/api','exec','tsx','scripts/prepare-board-real-model.ts'],{cwd:path.resolve(__dirname,'../../..'),env:process.env,encoding:'utf8',stdio:['ignore','pipe','pipe']});
 const fixture=JSON.parse(output.trim()) as {actorId:string;model:string};
 if(process.env.BOARD_REAL_MODEL_EXPECTED_MODEL&&process.env.BOARD_REAL_MODEL_EXPECTED_MODEL!==fixture.model)throw new Error('expected real model does not match published fixture');
 process.env.BOARD_REAL_MODEL_EXPECTED_MODEL=fixture.model;
 process.env.BOARD_REAL_MODEL_ACTOR_ID=fixture.actorId;
}
