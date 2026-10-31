/** Shadow only: describes coverage; never executes or skips a test. */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const policyBytes=readFileSync(new URL('../config/ci-test-impact.json',import.meta.url));
export function planImpact(paths,policyInput=policyBytes){
 const policy=JSON.parse(policyInput);
 if(!Array.isArray(paths)||paths.length===0||paths.some(p=>typeof p!=='string'||!p||p.startsWith('/')||p.split('/').includes('..')))throw Error('INVALID_CHANGE_PATHS');
 const changedFiles=[...new Set(paths)].sort(),affected=new Set(),reasons=[];
 let full=false;
 for(const path of changedFiles){
  const matches=Object.entries(policy.modules).filter(([,m])=>m.prefixes.some(p=>path.startsWith(p))&&(!m.extensions||m.extensions.some(ext=>path.endsWith(ext)))).map(([id])=>id);
  if(policy.globalFiles.includes(path)||policy.globalPrefixes.some(p=>path.startsWith(p))||matches.length===0){full=true;reasons.push({path,reason:'shared-or-unclassified: full coverage required'});}
  for(const id of matches){affected.add(id);reasons.push({path,reason:`module:${id}`});}
 }
 // Propagate actual changes downstream, then add prerequisite test coverage.
 let changed=true;
 while(changed){changed=false;for(const [id,m]of Object.entries(policy.modules)){
  if(m.dependencies.some(dep=>affected.has(dep))&&!affected.has(id)){affected.add(id);changed=true;}
 }}
 changed=true;
 while(changed){changed=false;for(const id of [...affected])for(const dep of policy.modules[id].dependencies){
  if(!affected.has(dep)){affected.add(dep);changed=true;}
 }}
 const ids=full?Object.keys(policy.modules).sort():[...affected].sort();
 return {schemaVersion:1,shadow:true,mode:full?'full':'targeted',policyDigest:createHash('sha256').update(policyInput).digest('hex'),changedFiles,affectedModules:ids,risk:ids.some(id=>policy.modules[id].risk==='high')?'high':'normal',suites:full?["full-regression"]:[...new Set(ids.flatMap(id=>policy.modules[id].suites))].sort(),reasons,fallback:full?'All existing verification remains required; suite list is not an exhaustive full-test inventory.':null};
}
export function gitPlan(baseSha,headSha,git=args=>execFileSync('git',args,{encoding:'utf8'})){
 if(![baseSha,headSha].every(s=>/^[a-f0-9]{40}$/.test(s??'')&&!/^0+$/.test(s)))throw Error('EXPLICIT_COMMIT_SHA_REQUIRED');
 for(const sha of [baseSha,headSha])git(['cat-file','-e',`${sha}^{commit}`]);
 git(['merge-base','--is-ancestor',baseSha,headSha]);
 const paths=git(['diff','--no-renames','--name-only','-z',baseSha,headSha]).split('\0').filter(Boolean);
 const plan=planImpact(paths);
 return {...plan,baseSha,headSha,planDigest:createHash('sha256').update(JSON.stringify({baseSha,headSha,...plan})).digest('hex')};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{console.log(JSON.stringify(gitPlan(process.env.CI_SCOPE_BASE_SHA,process.env.GITHUB_SHA),null,2));}
 catch(error){console.error(error.message);process.exitCode=1;}
}
