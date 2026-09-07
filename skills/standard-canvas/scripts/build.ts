import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {sha256,verifySkillStarterPack} from '../../../apps/api/src/domain/skill/starter-pack';
const root=resolve(import.meta.dirname,'../diagram-and-canvas');
const files=['SKILL.md','references/edit-checklist.md','references/upstream.md'].map(path=>{
 const bytes=readFileSync(resolve(root,path));return {path,mediaType:path==='LICENSE'?'text/plain':'text/markdown',digest:sha256(bytes),contentBase64:bytes.toString('base64')};});
const unsigned={schemaVersion:1,packId:'standard-canvas',packVersion:'1.0.0',skills:[{stableName:'diagram-and-canvas',name:'图表与画布',semanticVersion:'1.0.0',manifest:{capabilityId:'WX-S012',source:'existing-workspacex-canvas'},files}]};
const pack={...unsigned,packDigest:sha256(JSON.stringify(unsigned))};verifySkillStarterPack(pack,{packId:'standard-canvas',packVersion:'1.0.0'});
writeFileSync(resolve(root,'../../starter-packs/standard-canvas/1.0.0.json'),JSON.stringify(pack,null,2)+'\n');
