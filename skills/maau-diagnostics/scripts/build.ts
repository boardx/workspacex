import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {sha256,verifySkillStarterPack} from '../../../apps/api/src/domain/skill/starter-pack';
const root=resolve(import.meta.dirname,'../maau-venture-valuation');
const mediaTypes:Record<string,string>={md:'text/markdown',cjs:'text/javascript',json:'application/json'};
const paths=['SKILL.md','references/model.md','references/input-schema.md','scripts/calc.cjs','scripts/render.cjs','scripts/cli.cjs','examples/sample-index.json','examples/sample-usd.json'];
const files=paths.map(path=>{const bytes=readFileSync(resolve(root,path));return {path,mediaType:mediaTypes[path.split('.').pop()!]!,digest:sha256(bytes),contentBase64:bytes.toString('base64')};});
const unsigned={schemaVersion:1,packId:'maau-diagnostics',packVersion:'2.0.1',skills:[{stableName:'maau-venture-valuation',name:'AI 原生递归资产与估值预测',semanticVersion:'2.0.1',manifest:{capabilityId:'WX-S022',runtime:'offline-node-pdf-lib'},files}]};
const pack={...unsigned,packDigest:sha256(JSON.stringify(unsigned))};verifySkillStarterPack(pack,{packId:'maau-diagnostics',packVersion:'2.0.1'});
const directory=resolve(root,'../../starter-packs/maau-diagnostics'),path=resolve(directory,'2.0.1.json'),content=JSON.stringify(pack,null,2)+'\n';
if(process.argv.includes('--check')){if(readFileSync(path,'utf8')!==content)throw new Error('maau-diagnostics starter pack stale; run skills/maau-diagnostics/scripts/build.ts');}else{mkdirSync(directory,{recursive:true});writeFileSync(path,content);}
