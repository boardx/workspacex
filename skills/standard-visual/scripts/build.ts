import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {sha256,verifySkillStarterPack} from '../../../apps/api/src/domain/skill/starter-pack';
const root=resolve(import.meta.dirname,'../visual-content');
const files=['SKILL.md','references/quality.md','references/runtime.md','LICENSE.txt'].map(path=>{const bytes=readFileSync(resolve(root,path));return {path,mediaType:'text/markdown',digest:sha256(bytes),contentBase64:bytes.toString('base64')};});
const unsigned={schemaVersion:1,packId:'standard-visual',packVersion:'1.0.1',skills:[{stableName:'visual-content',name:'视觉内容制作',semanticVersion:'1.0.1',manifest:{capabilityId:'WX-S017',runtime:'bailian-and-offline-visual'},files}]};
const pack={...unsigned,packDigest:sha256(JSON.stringify(unsigned))};verifySkillStarterPack(pack,{packId:'standard-visual',packVersion:'1.0.1'});
const directory=resolve(root,'../../starter-packs/standard-visual'),path=resolve(directory,'1.0.1.json'),content=JSON.stringify(pack,null,2)+'\n';
if(process.argv.includes('--check')){if(readFileSync(path,'utf8')!==content)throw new Error('document package stale');}else{mkdirSync(directory,{recursive:true});writeFileSync(path,content);}
