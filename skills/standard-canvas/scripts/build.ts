import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {sha256,verifySkillStarterPack} from '../../../apps/api/src/domain/skill/starter-pack';
import {parseSkillFrontmatter} from '../../../apps/api/src/domain/skill/skill-frontmatter';
const root=resolve(import.meta.dirname,'../diagram-and-canvas');
const files=['SKILL.md','references/edit-checklist.md','references/upstream.md'].map(path=>{
 const bytes=readFileSync(resolve(root,path));return {path,mediaType:path==='LICENSE'?'text/plain':'text/markdown',digest:sha256(bytes),contentBase64:bytes.toString('base64')};});
// stable_name / version / capability_id 的唯一来源是 SKILL.md frontmatter（issue #3154）。
const meta=parseSkillFrontmatter(readFileSync(resolve(root,'SKILL.md'),'utf8'),'diagram-and-canvas');
const unsigned={schemaVersion:1,packId:'standard-canvas',packVersion:'1.0.1',skills:[{stableName:meta.stableName,name:'图表与画布',semanticVersion:meta.semanticVersion,manifest:{capabilityId:meta.capabilityId,source:'existing-workspacex-canvas'},files}]};
const pack={...unsigned,packDigest:sha256(JSON.stringify(unsigned))};verifySkillStarterPack(pack,{packId:'standard-canvas',packVersion:'1.0.1'});
writeFileSync(resolve(root,'../../starter-packs/standard-canvas/1.0.1.json'),JSON.stringify(pack,null,2)+'\n');
