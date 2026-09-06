import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {sha256,verifySkillStarterPack} from '../../../apps/api/src/domain/skill/starter-pack';
const root=resolve(import.meta.dirname,'../web-research');
const files=['SKILL.md','references/evidence-ledger.md','references/upstream.md','LICENSE'].map(path=>{
 const bytes=readFileSync(resolve(root,path));return {path,mediaType:path==='LICENSE'?'text/plain':'text/markdown',digest:sha256(bytes),contentBase64:bytes.toString('base64')};});
const unsigned={schemaVersion:1,packId:'standard-web',packVersion:'1.0.0',skills:[{stableName:'web-research',name:'联网研究',semanticVersion:'1.0.0',manifest:{capabilityId:'WX-S002',upstreamCommit:'07d2952d346d81d06bd181db8c560a77f2b51bc8'},files}]};
const pack={...unsigned,packDigest:sha256(JSON.stringify(unsigned))};verifySkillStarterPack(pack,{packId:'standard-web',packVersion:'1.0.0'});
writeFileSync(resolve(root,'../../starter-packs/standard-web/1.0.0.json'),JSON.stringify(pack,null,2)+'\n');
