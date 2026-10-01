import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const root=path.resolve(import.meta.dirname,'../../../..');
const require=createRequire(path.join(root,'apps/api/package.json'));
const {parse}=require('yaml');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const walk=p=>fs.readdirSync(path.join(root,p),{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(`${p}/${e.name}`):[`${p}/${e.name}`]);
const planning=read('requirements/work-stack-v2/WORK-STACK-320-LIST.md').split('\n').map(l=>l.split('|').map(x=>x.trim())).filter(c=>/^S\d{3}$/.test(c[2]??''));
if(planning.length!==200 || new Set(planning.map(c=>c[2])).size!==200)throw Error('Expected 200 unique planned Skills');
const sources=[];
for(const p of walk('skills').filter(p=>p.endsWith('/SKILL.md'))){const body=read(p);if(!/stableId:\s*S\d{3}/.test(body))continue;const front=body.match(/^---\r?\n([\s\S]*?)\r?\n---/);const m=parse(front[1]);sources.push({path:p,version:m.version,work:m.metadata?.work??m.work});}
const packs=[];
for(const p of walk('skills/starter-packs').filter(p=>p.endsWith('.json'))){const pack=JSON.parse(read(p));for(const s of pack.skills??[]){const id=s.manifest?.work?.stableId;if(id)packs.push({id,path:p,coordinate:`${pack.packId}@${pack.packVersion}:${s.stableName}@${s.semanticVersion}`,digest:s.contentDigest??'',work:s.manifest.work});}}
const roles=read('requirements/work-stack-v2/DIGITALHUMAN-COMPOSITION-MATRIX.md').split('\n').filter(l=>/^\| D\d{3} /.test(l));
const workflows=read('requirements/work-stack-v2/WORKFLOW-SKILL-MATRIX.md').split('\n').filter(l=>/^\| W\d{3} /.test(l));
const subjectBlock=read('apps/api/src/application/work-eval/loopback-agents.ts').split('export const LOOPBACK_SUBJECTS')[1]?.match(/=\s*\{([\s\S]*?)\};/)[1]??'';
const registeredIds=new Set([...subjectBlock.matchAll(/\b(S\d{3}):/g)].map(m=>m[1]));
const authorPaths=walk('requirements/work-stack-v2/skills');
const reviewPaths=walk('requirements/work-stack-v2').filter(x=>x.endsWith('.review.md'));
const list=items=>items.join(';');
const rows=planning.map(c=>{const id=c[2],s=sources.filter(x=>x.work?.stableId===id),p=packs.filter(x=>x.id===id);const authorFiles=authorPaths.filter(x=>path.basename(x).startsWith(`${id}-`)||path.basename(x)===`${id}.md`);const reviewFiles=reviewPaths.filter(x=>path.basename(x).startsWith(id));const suitePath=`evals/work-stack/${id}/suite.json`;const suite=fs.existsSync(path.join(root,suitePath))?JSON.parse(read(suitePath)):null;const registered=registeredIds.has(id);const blockers=p.length?[...(suite?[]:['missing_eval_suite']),...(registered?[]:['unregistered_eval_subject']),'runtime_configuration_and_real_model_execution_not_verified']:['no_executable_starter_package'];return {stable_id:id,name:c[4],planning_review_mark:c[1],author_files:list(authorFiles),review_files:list(reviewFiles),source_manifests:list(s.map(x=>`${x.path}@${x.version}`)),starter_coordinates:list(p.map(x=>x.coordinate)),starter_paths:list([...new Set(p.map(x=>x.path))]),starter_digests:list(p.map(x=>x.digest)),direct_roles:list(roles.filter(l=>new RegExp(`\\b${id}\\b`).test(l.split('|')[4]??'')).map(l=>l.split('|')[1].trim())),workflows:list(workflows.filter(l=>new RegExp(`\\b${id}\\b`).test(l.split('|')[4]??'')).map(l=>l.split('|')[1].trim())),required_runtime_dependencies:list([...new Set(s.flatMap(x=>x.work.dependencies?.required??[]))]),input_schema_present:s.length?s.every(x=>Boolean(x.work.inputSchema)):'',output_schema_present:s.length?s.every(x=>Boolean(x.work.outputSchema)):'',machine_validation:'NOT_RUN',eval_suite:suite?suitePath:'',eval_grader:suite?.graderVersion??'',eval_tools:list(suite?.toolsUnderTest??[]),loopback_subject_registered:registered,execution_evidence:'NOT_RUN',status:p.length?'BLOCKED':'NOT_IMPLEMENTED',blocking_reasons:list(blockers)};});
const headers=Object.keys(rows[0]);const csv=[headers,...rows.map(r=>headers.map(h=>r[h]))].map(row=>row.map(v=>`"${String(v).replaceAll('"','""')}"`).join(',')).join('\n')+'\n';
const output=path.join(import.meta.dirname,'inventory.csv');
if(process.argv.includes('--check')){if(fs.readFileSync(output,'utf8')!==csv)throw Error('Inventory stale');}else fs.writeFileSync(output,csv);
const counts={planned:rows.length,authored:rows.filter(r=>r.author_files).length,reviewed:rows.filter(r=>r.review_files).length,manifestFiles:sources.length,uniqueManifestSkills:new Set(sources.map(s=>s.work.stableId)).size,packaged:rows.filter(r=>r.starter_coordinates).length,suites:rows.filter(r=>r.eval_suite).length,registeredSubjects:registeredIds.size,statuses:Object.fromEntries(['PASS','FAIL','BLOCKED','NOT_IMPLEMENTED'].map(x=>[x,rows.filter(r=>r.status===x).length]))};
console.log(JSON.stringify(counts,null,2));
