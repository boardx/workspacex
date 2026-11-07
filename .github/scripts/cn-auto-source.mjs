#!/usr/bin/env node
// Cloud-side complete source artifact. Metadata is audit data, never root admission.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {resolve, join} from 'node:path';
const sha = value => {if (!/^[a-f0-9]{40}$/.test(value ?? '')) throw new Error('CN_SOURCE_EXACT_SHA'); return value;};
const run = (command,args) => execFileSync(command,args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
try {
 if(process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || process.env.GITHUB_REF !== 'refs/heads/main') throw new Error('CN_SOURCE_TRUSTED_MAIN_REQUIRED');
 const source = sha(process.env.RELEASE_SHA), repository=process.env.GITHUB_REPOSITORY;
 if(!/^[\w.-]+\/[\w.-]+$/.test(repository??'')) throw new Error('CN_SOURCE_REPOSITORY');
 const api = path => run('gh',['api',`repos/${repository}/${path}`,'--jq','.object.sha']);
 const main=sha(api('git/ref/heads/main'));
 if(sha(api('git/ref/heads/main-cn'))!==source)throw new Error('CN_SOURCE_STALE_DESIRED');
 const status=run('gh',['api',`repos/${repository}/compare/${source}...${main}`,'--jq','.status']);
 if(!['ahead','identical'].includes(status))throw new Error('CN_SOURCE_NOT_ON_MAIN');
 // actions/checkout fetched full history with persist-credentials:false. Fail closed
 // rather than fetching over the production network or relying on ambient credentials.
 const git=(...args)=>run('git',args);
 const directory=git('rev-parse','--absolute-git-dir');
 if(git('rev-parse','--is-shallow-repository')!=='false' || existsSync(join(directory,'shallow')) || existsSync(join(directory,'objects/info/alternates')) || existsSync(join(directory,'objects/info/http-alternates')))throw new Error('CN_SOURCE_INCOMPLETE_CHECKOUT');
 if(/^remote\..*\.promisor=true$/m.test(git('config','--list')) || readdirSync(join(directory,'objects/pack')).some(name=>name.endsWith('.promisor')))throw new Error('CN_SOURCE_PROMISOR');
 git('fsck','--full','--no-reflogs');
 git('cat-file','-e',`${source}^{commit}`);git('cat-file','-e',`${main}^{commit}`);
 git('merge-base','--is-ancestor',source,main);
 const output=resolve(process.env.SOURCE_OUTPUT_DIR??'cn-auto-source');mkdirSync(output,{recursive:true});
 git('update-ref','refs/remotes/origin/main',source);
 const bundle=join(output,'source.bundle');
 git('bundle','create',bundle,'refs/remotes/origin/main');
 const bytes=readFileSync(bundle);const header=bytes.subarray(0,bytes.indexOf(Buffer.from('\n\n'))).toString();
 if(!/^# v[23] git bundle\n/.test(header)||/^-/m.test(header))throw new Error('CN_SOURCE_BUNDLE_PREREQUISITES');
 git('bundle','verify',bundle);
 if(sha(api('git/ref/heads/main-cn'))!==source)throw new Error('CN_SOURCE_STALE_DESIRED');
 const digest=createHash('sha256').update(bytes).digest('hex');
 writeFileSync(join(output,'source.json'),JSON.stringify({schemaVersion:1,sourceRevision:source,workflowRevision:sha(process.env.GITHUB_SHA),githubMainSha:main,githubDesiredMainCnSha:source,bundleSha256:digest,runId:process.env.GITHUB_RUN_ID,runAttempt:process.env.GITHUB_RUN_ATTEMPT},null,2)+'\n');
 if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,`bundle_sha256=${digest}\n`);
 console.log(`CN_SOURCE_BUNDLE_READY ${source} ${digest}; not production admission`);
} catch(error) {
 console.error(error.message?.startsWith('CN_SOURCE_')?error.message:'CN_SOURCE_PRODUCER_FAILED');process.exitCode=1;
}
