import { generateKeyPairSync } from 'node:crypto';
import { spawn } from 'node:child_process';

function run(command:string,args:string[],env:NodeJS.ProcessEnv):Promise<void>{
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{stdio:'inherit',env});
    child.once('error',reject);
    child.once('exit',(code,signal)=>code===0?resolve():reject(new Error(`${command} exited ${code??signal}`)));
  });
}

async function main():Promise<void>{
  const {privateKey,publicKey}=generateKeyPairSync('ed25519');
  const publicPem=publicKey.export({type:'spki',format:'pem'}).toString();
  const privatePem=privateKey.export({type:'pkcs8',format:'pem'}).toString();
  const base={...process.env,WHITEBOARD_SOAK_LEDGER_PUBLIC_KEY:publicPem};
  await run('pnpm',['--dir','../..','run','verify:whiteboard-collaboration-soak:playwright'],{...base,WHITEBOARD_SOAK_LEDGER_PRIVATE_KEY:privatePem});
  await run(process.execPath,['--import','tsx','scripts/verify-whiteboard-soak-report.ts'],base);
}

void main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;});
