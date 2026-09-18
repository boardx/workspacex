import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {sha256,verifySkillStarterPack} from '../../../apps/api/src/domain/skill/starter-pack';
const root=resolve(import.meta.dirname,'../maau-recursive-asset-report');
const mediaTypes:Record<string,string>={md:'text/markdown',cjs:'text/javascript',json:'application/json'};
const paths=['SKILL.md','references/model.md','references/input-schema.md','scripts/compute.cjs','scripts/render-report.cjs','scripts/cli.cjs','examples/sample-canvas.json','examples/sample-canvas-strong.json'];
const files=paths.map(path=>{const bytes=readFileSync(resolve(root,path));return {path,mediaType:mediaTypes[path.split('.').pop()!]!,digest:sha256(bytes),contentBase64:bytes.toString('base64')};});
const unsigned={schemaVersion:1,packId:'maau-diagnostics',packVersion:'1.0.0',skills:[{stableName:'maau-recursive-asset-report',name:'AI 原生递归资产诊断报告',semanticVersion:'1.0.0',manifest:{capabilityId:'WX-S022',runtime:'offline-node-pdf-lib'},files}]};
const pack={...unsigned,packDigest:sha256(JSON.stringify(unsigned))};verifySkillStarterPack(pack,{packId:'maau-diagnostics',packVersion:'1.0.0'});
const directory=resolve(root,'../../starter-packs/maau-diagnostics'),path=resolve(directory,'1.0.0.json'),content=JSON.stringify(pack,null,2)+'\n';
if(process.argv.includes('--check')){if(readFileSync(path,'utf8')!==content)throw new Error('maau-diagnostics starter pack stale; run skills/maau-diagnostics/scripts/build.ts');}else{mkdirSync(directory,{recursive:true});writeFileSync(path,content);}
