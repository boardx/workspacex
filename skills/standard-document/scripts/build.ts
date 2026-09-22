import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {sha256,verifySkillStarterPack} from '../../../apps/api/src/domain/skill/starter-pack';
import {parseSkillFrontmatter} from '../../../apps/api/src/domain/skill/skill-frontmatter';
const root=resolve(import.meta.dirname,'../document-understanding');
const files=['SKILL.md','references/verification.md','references/runtime.md'].map(path=>{const bytes=readFileSync(resolve(root,path));return {path,mediaType:'text/markdown',digest:sha256(bytes),contentBase64:bytes.toString('base64')};});
// stable_name / version / capability_id 的唯一来源是 SKILL.md frontmatter（issue #3154）。
const meta=parseSkillFrontmatter(readFileSync(resolve(root,'SKILL.md'),'utf8'),'document-understanding');
const unsigned={schemaVersion:1,packId:'standard-document',packVersion:'1.2.0',skills:[{stableName:meta.stableName,name:'文档理解与结构提取',semanticVersion:meta.semanticVersion,manifest:{capabilityId:meta.capabilityId,runtime:'anydoc-native-locators-ocr'},files}]};
const pack={...unsigned,packDigest:sha256(JSON.stringify(unsigned))};verifySkillStarterPack(pack,{packId:'standard-document',packVersion:'1.2.0'});
const directory=resolve(root,'../../starter-packs/standard-document'),path=resolve(directory,'1.2.0.json'),content=JSON.stringify(pack,null,2)+'\n';
if(process.argv.includes('--check')){if(readFileSync(path,'utf8')!==content)throw new Error('document package stale');}else{mkdirSync(directory,{recursive:true});writeFileSync(path,content);}
