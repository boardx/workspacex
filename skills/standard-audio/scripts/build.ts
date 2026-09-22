import {readFileSync,writeFileSync,mkdirSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {sha256,verifySkillStarterPack} from '../../../apps/api/src/domain/skill/starter-pack';
import {parseSkillFrontmatter} from '../../../apps/api/src/domain/skill/skill-frontmatter';
const root=resolve(import.meta.dirname,'..');
// stable_name / version / capability_id 一律从 SKILL.md frontmatter 读（issue #3154）。
// 这张表只留**构建侧独有**的事实：显示名。semanticVersion 曾是按 stableName 推的三元表达式，
// 「忘了加分支 ⇒ 静默发成 1.1.0」是不会红的错——现在每个 skill 的版本由它自己的 frontmatter 说了算。
const entries=[['audio-transcription','音频转录工作流'],['meeting-minutes','会议纪要']] as const;
const skills=entries.map(([directory,name])=>{
 const dir=resolve(root,directory);const paths=['SKILL.md',...readdirSync(resolve(dir,'references')).sort().map(p=>`references/${p}`),'LICENSE.txt'];
 const files=paths.map(path=>{const bytes=readFileSync(resolve(dir,path));return{path,mediaType:'text/markdown',digest:sha256(bytes),contentBase64:bytes.toString('base64')};});
 const meta=parseSkillFrontmatter(readFileSync(resolve(dir,'SKILL.md'),'utf8'),directory);
 return{stableName:meta.stableName,name,semanticVersion:meta.semanticVersion,manifest:{capabilityId:meta.capabilityId,runtime:'existing-asr-and-artifacts'},files};
});
const unsigned={schemaVersion:1,packId:'standard-audio',packVersion:'1.1.2',skills};
const pack={...unsigned,packDigest:sha256(JSON.stringify(unsigned))};verifySkillStarterPack(pack,{packId:'standard-audio',packVersion:'1.1.2'});
const dir=resolve(root,'../starter-packs/standard-audio'),path=resolve(dir,'1.1.2.json'),content=JSON.stringify(pack,null,2)+'\n';
if(process.argv.includes('--check')){if(readFileSync(path,'utf8')!==content)throw new Error('audio package stale');}else{mkdirSync(dir,{recursive:true});writeFileSync(path,content);}
