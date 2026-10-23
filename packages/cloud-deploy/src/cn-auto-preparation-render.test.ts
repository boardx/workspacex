import {it,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {deploymentExample} from './examples';
const controlled=vi.hoisted(()=>({files:new Map<string,Buffer>(),tls:''}));
vi.mock('./trusted-path',()=>({assertTrustedPath:vi.fn()}));
vi.mock('./secrets',()=>({resolveSecret:async()=>controlled.tls}));
vi.mock('node:fs/promises',()=>({readFile:async(p:string)=>{const v=controlled.files.get(p);if(!v)throw Error(p);return v;},mkdir:async()=>{},chown:async()=>{},writeFile:async(p:string,v:string)=>{controlled.files.set(p,Buffer.from(v));}}));
vi.mock('./runtime-environment',()=>({runtimeEnvironment:async()=>({api:{WORKSPACEX_DEPLOY_PROFILE:'production',PGHOST:'production.example'},bootstrap:{WORKSPACEX_DEPLOY_PROFILE:'production',PROVISION_ADMIN_EMAIL:'fixture@example.invalid'},migration:{WORKSPACEX_DEPLOY_PROFILE:'production'},web:{},agent:{}}),serializeRuntimeEnvironment:(v:Record<string,string>)=>Object.entries(v).map(([k,x])=>k+'='+x+'\n').join('')}));
import {renderAutoIsolated} from './cn-auto-preparation-render';
it('renders canonical bootstrap input with explicit starter profile and only the isolated data endpoint',async()=>{
 const temp=mkdtempSync(join(tmpdir(),'cn-render-tls-'));
 try{
  const key=join(temp,'key.pem'),cert=join(temp,'cert.pem');
  execFileSync('/usr/bin/openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-subj','/CN=workspace.example.com','-days','1'],{stdio:'ignore'});
  controlled.tls=JSON.stringify({certificatePem:readFileSync(cert,'utf8'),privateKeyPem:readFileSync(key,'utf8')});
  const sha='a'.repeat(40),attempt='gha-1-1',directory=`/var/lib/workspacex-cn/auto-preparation/${sha}/${attempt}/runtime`;
  const config=deploymentExample('production');config.environment.tlsSecretRef='file:/etc/workspacex-cn/tls.json';
  const image={image:'registry.example/runtime@sha256:'+'b'.repeat(64)};
  const manifest=Buffer.from(JSON.stringify({schemaVersion:1,sourceRevision:sha,release:config.provision.release,platform:'linux/amd64',images:Object.fromEntries(['api','web','agent','sandbox','postgres','redis'].map(k=>[k,image]))}));
  controlled.files.set(`/etc/workspacex-cn/candidate-configs/${sha}/${attempt}/deployment.json`,Buffer.from(JSON.stringify(config)));controlled.files.set(directory.slice(0,-8)+'/input-manifest.json',manifest);
  await renderAutoIsolated({identity:{sourceRevision:sha,attemptId:attempt},dependencies:{manifest:createHash('sha256').update(manifest).digest('hex')},images:{}},{environment:{stableSecretDirectory:'/unused'}},{name:'wsx-autop-test',owner:'a'.repeat(20),password:'local-secret',redisPassword:'local-cache',marker:'marker',rolePasswords:{app_rw:'local-app',app_diag_ro:'local-diag'}},directory);
  const bootstrap=controlled.files.get(directory+'/bootstrap.env')!.toString();
  expect(bootstrap).toContain('WORKSPACEX_DEPLOY_PROFILE=starter\n');expect(bootstrap).toContain('PGHOST=postgres\n');expect(bootstrap).toContain('PGSSLMODE=disable\n');expect(bootstrap).not.toContain('production.example');expect(bootstrap).not.toContain('WORKSPACEX_RDS_TLS_EXCEPTION');
  const compose=JSON.parse(controlled.files.get(directory+'/compose.json')!.toString());expect(compose.networks.default.name).toBe('wsx-autop-test-net');expect(compose.services.api.ports).toBeUndefined();
  expect(Object.fromEntries(Object.entries(compose.services).map(([k,v]:[string,any])=>[k,[v.mem_limit,v.cpus]]))).toEqual({api:['768m',.4],web:['512m',.3],agent:['1536m',.5],sandbox:['256m',.1]});
 }finally{rmSync(temp,{recursive:true,force:true});controlled.files.clear();}
});
