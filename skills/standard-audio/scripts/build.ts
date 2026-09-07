import {readFileSync,writeFileSync,mkdirSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {sha256,verifySkillStarterPack} from '../../../apps/api/src/domain/skill/starter-pack';
const root=resolve(import.meta.dirname,'..');
const skills=[['audio-transcription','音频转录工作流','WX-S016'],['meeting-minutes','会议纪要','WX-S009']].map(([stableName,name,capabilityId])=>{
 const dir=resolve(root,stableName!);const paths=['SKILL.md',...readdirSync(resolve(dir,'references')).sort().map(p=>`references/${p}`),'LICENSE.txt'];
 return{stableName:stableName!,name:name!,semanticVersion:stableName==='meeting-minutes'?'1.1.1':'1.1.0',manifest:{capabilityId:capabilityId!,runtime:'existing-asr-and-artifacts'},files:paths.map(path=>{const bytes=readFileSync(resolve(dir,path));return{path,mediaType:'text/markdown',digest:sha256(bytes),contentBase64:bytes.toString('base64')};})};
});
const unsigned={schemaVersion:1,packId:'standard-audio',packVersion:'1.1.1',skills};
const pack={...unsigned,packDigest:sha256(JSON.stringify(unsigned))};verifySkillStarterPack(pack,{packId:'standard-audio',packVersion:'1.1.1'});
const dir=resolve(root,'../starter-packs/standard-audio'),path=resolve(dir,'1.1.1.json'),content=JSON.stringify(pack,null,2)+'\n';
if(process.argv.includes('--check')){if(readFileSync(path,'utf8')!==content)throw new Error('audio package stale');}else{mkdirSync(dir,{recursive:true});writeFileSync(path,content);}
