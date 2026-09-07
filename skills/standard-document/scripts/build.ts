import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {sha256,verifySkillStarterPack} from '../../../apps/api/src/domain/skill/starter-pack';
const root=resolve(import.meta.dirname,'../document-understanding');
const files=['SKILL.md','references/verification.md','references/runtime.md'].map(path=>{const bytes=readFileSync(resolve(root,path));return {path,mediaType:'text/markdown',digest:sha256(bytes),contentBase64:bytes.toString('base64')};});
const unsigned={schemaVersion:1,packId:'standard-document',packVersion:'1.1.0',skills:[{stableName:'document-understanding',name:'文档理解与结构提取',semanticVersion:'1.1.0',manifest:{capabilityId:'WX-S018',runtime:'anydoc-markdown-tesseract-ocr'},files}]};
const pack={...unsigned,packDigest:sha256(JSON.stringify(unsigned))};verifySkillStarterPack(pack,{packId:'standard-document',packVersion:'1.1.0'});
const directory=resolve(root,'../../starter-packs/standard-document'),path=resolve(directory,'1.1.0.json'),content=JSON.stringify(pack,null,2)+'\n';
if(process.argv.includes('--check')){if(readFileSync(path,'utf8')!==content)throw new Error('document package stale');}else{mkdirSync(directory,{recursive:true});writeFileSync(path,content);}
