import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sha256, verifySkillStarterPack } from '../../../apps/api/src/domain/skill/starter-pack';
const root=resolve(import.meta.dirname,'..');
const skills=[['interview-synthesis','访谈与反馈综合','WX-S010','evidence-ledger.md'],['user-research-planning','用户研究规划','WX-S019','planning-template.md']].map(([stableName,name,id,reference])=>({
 stableName,name,semanticVersion:'1.0.0',manifest:{capabilityId:id},files:['SKILL.md',`references/${reference}`].map(path=>{
 const bytes=readFileSync(resolve(root,stableName!,path));return {path,mediaType:'text/markdown',digest:sha256(bytes),contentBase64:bytes.toString('base64')};
 })
}));
const unsigned={schemaVersion:1,packId:'standard-methods',packVersion:'1.0.0',skills};
const pack={...unsigned,packDigest:sha256(JSON.stringify(unsigned))};
verifySkillStarterPack(pack,{packId:'standard-methods',packVersion:'1.0.0'});
writeFileSync(resolve(root,'../starter-packs/standard-methods/1.0.0.json'),JSON.stringify(pack,null,2)+'\n');
