import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {sha256,verifySkillStarterPack} from '../../../apps/api/src/domain/skill/starter-pack';
const root=resolve(import.meta.dirname,'..');
const collect=(directory:string,paths:string[])=>paths.map(path=>{const bytes=readFileSync(resolve(root,directory,path));return {path,mediaType:path==='LICENSE'?'text/plain':'text/markdown',digest:sha256(bytes),contentBase64:bytes.toString('base64')};});
const skills=[
 {stableName:'web-research',name:'联网研究',semanticVersion:'1.0.0',manifest:{capabilityId:'WX-S002',upstreamCommit:'07d2952d346d81d06bd181db8c560a77f2b51bc8'},files:collect('web-research',['SKILL.md','references/evidence-ledger.md','references/upstream.md','LICENSE'])},
 {stableName:'web-artifact',name:'交互式网页产物',semanticVersion:'1.0.2',manifest:{capabilityId:'WX-S013',upstreamCommit:'41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f'},files:collect('web-artifact',['SKILL.md','references/acceptance.md','references/upstream.md','LICENSE'])},
];
const unsigned={schemaVersion:1,packId:'standard-web',packVersion:'1.1.2',skills};
const pack={...unsigned,packDigest:sha256(JSON.stringify(unsigned))};verifySkillStarterPack(pack,{packId:'standard-web',packVersion:'1.1.2'});
writeFileSync(resolve(root,'../starter-packs/standard-web/1.1.2.json'),JSON.stringify(pack,null,2)+'\n');
