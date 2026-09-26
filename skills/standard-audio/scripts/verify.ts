import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {FileSkillStarterPackSource} from '../../../apps/api/src/infrastructure/skill/file-skill-starter-pack-source';
import {verifySkillStarterPack} from '../../../apps/api/src/domain/skill/starter-pack';
async function main(){
 const root=resolve(import.meta.dirname,'..');const source=new FileSkillStarterPackSource(resolve(root,'../starter-packs'));
 const pack=verifySkillStarterPack(await source.load('standard-audio','1.1.2'),{packId:'standard-audio',packVersion:'1.1.2'});
 const previous=verifySkillStarterPack(await source.load('standard-audio','1.1.1'),{packId:'standard-audio',packVersion:'1.1.1'});
 assert.equal(previous.packDigest,'dc1bd12ee048c407a62ef4b75a6241aea2421c3993c69f8d5544af124b51eeb6');
 // 1.1.2 相对 1.1.1 的**唯一**实质差异：两个 skill 的 SKILL.md frontmatter 补上了
 // capability_id / version（issue #3154，元数据收敛到 frontmatter 单源）。所以这里不再断言
 // 「某个 skill 逐字不变」——两个都变了——改断言**除 SKILL.md 外每个文件逐字节不变**，
 // 外加两个 semanticVersion 各自进了一格。后者是硬性的：`skill_versions_semantic_uniq`
 // 不允许同一个语义版本号指向两份不同的正文，改了正文不 bump 会在导入时
 // 判 SKILL_STARTER_PACK_VERSION_LABEL_REUSED，那一版就发不出去。
 for(const name of ['audio-transcription','meeting-minutes']){
  const now=pack.skills.find(s=>s.stableName===name)!,before=previous.skills.find(s=>s.stableName===name)!;
  assert.notDeepEqual(now.files.find(f=>f.path==='SKILL.md'),before.files.find(f=>f.path==='SKILL.md'));
  assert.notEqual(now.semanticVersion,before.semanticVersion);
  for(const file of now.files)if(file.path!=='SKILL.md')assert.deepEqual(file,before.files.find(f=>f.path===file.path));
 }
 assert.equal(pack.skills.find(s=>s.stableName==='audio-transcription')?.semanticVersion,'1.1.1');
 assert.equal(pack.skills.find(s=>s.stableName==='meeting-minutes')?.semanticVersion,'1.1.2');
 assert.equal(pack.skills.length,2);
 for(const skill of pack.skills){assert.equal(skill.files.length,4);for(const file of skill.files)assert.deepEqual(Buffer.from(file.contentBase64,'base64'),readFileSync(resolve(root,skill.stableName,file.path)));}
 const changed=structuredClone(pack);changed.skills[0]!.files[0]!.contentBase64='dGFtcGVy';assert.throws(()=>verifySkillStarterPack(changed,{packId:'standard-audio',packVersion:'1.1.2'}));
 console.log('PASS two complete four-file skills through actual starter loader; only SKILL.md changed since 1.1.1 and both semantic versions advanced; tampering rejected. Not live-model G-SKILL.');
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
