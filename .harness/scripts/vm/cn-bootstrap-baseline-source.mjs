import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';
export function readProtectedJson(file){
 for(let dir=path.dirname(file);dir!=='/';dir=path.dirname(dir)){const st=fs.lstatSync(dir);if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==0||st.gid!==0||(st.mode&0o022))throw Error('BOOTSTRAP_PRIVATE_PARENT');}
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{const before=fs.fstatSync(fd);if(!before.isFile()||before.uid!==0||before.gid!==0||(before.mode&0o777)!==0o600||before.nlink!==1||before.size>8*1024*1024)throw Error('BOOTSTRAP_PRIVATE_FILE');const raw=fs.readFileSync(fd);const after=fs.fstatSync(fd);if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)throw Error('BOOTSTRAP_PRIVATE_CHANGED');return JSON.parse(raw);}finally{fs.closeSync(fd);}
}
const shadow=process.argv[2]==='--shadow';
const args=process.argv.slice(shadow?3:2);
const [root,source,baseline,planFile,schemaFile,probeFile,contractFile]=args;
if(args.length!==7||!/^[a-f0-9]{40}$/.test(source)||!/^[a-f0-9]{40}$/.test(baseline)||planFile!==`/etc/workspacex-cn/migration-plans/${source}/${path.basename(path.dirname(planFile))}/plan.json`||(!shadow&&schemaFile!==`/etc/workspacex-cn/baseline-schemas/${baseline}.json`))process.exit(2);
const git=args=>execFileSync('git',['-C',root,...args],{env:{...process.env,GIT_NO_LAZY_FETCH:'1'},maxBuffer:16*1024*1024});
const files={};for(const file of git(['ls-tree','-r','--name-only',source,'apps/api/migrations']).toString().trim().split('\n'))if(/^apps\/api\/migrations\/[a-zA-Z0-9_-]+\.sql$/.test(file))files[file.split('/').at(-1)]=git(['show',source+':'+file]).toString('base64');
if(!Object.keys(files).length)process.exit(1);
if(shadow){
 const {createRequire}=await import('node:module');const helper=createRequire(import.meta.url)(probeFile);
 const plan=readProtectedJson(planFile);helper.verifyPlan(plan,source,baseline,Object.fromEntries(Object.entries(files).map(([k,v])=>[k,Buffer.from(v,'base64')])));
 const target=readProtectedJson(path.dirname(planFile)+'/schema-probe.json');
 const env=Object.fromEntries(fs.readFileSync(schemaFile,'utf8').trimEnd().split('\n').map(line=>{const at=line.indexOf('=');if(at<1||!/^[A-Z][A-Z0-9_]*$/.test(line.slice(0,at)))throw Error('BOOTSTRAP_ENV_FORMAT');return [line.slice(0,at),line.slice(at+1)];}));
 const image=JSON.parse(fs.readFileSync(contractFile,'utf8')).images.api.image.split('@')[1];
 const mapped=helper.candidateEnvironment(target,plan,env,source,baseline,image,path.basename(path.dirname(planFile)));
 fs.writeFileSync(schemaFile+'.shadow',Object.entries(mapped).map(([k,v])=>k+'='+v).join('\n')+'\n',{mode:0o600,flag:'wx'});
}else process.stdout.write(JSON.stringify({plan:readProtectedJson(planFile),baselineSchema:readProtectedJson(schemaFile),files,probe:fs.readFileSync(probeFile,'utf8'),contract:fs.readFileSync(contractFile,'utf8'),source,baseline}));
