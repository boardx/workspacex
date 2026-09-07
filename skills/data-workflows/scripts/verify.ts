import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, posix } from 'node:path';
import { FileSkillStarterPackSource } from '../../../apps/api/src/infrastructure/skill/file-skill-starter-pack-source';
import { verifySkillStarterPack } from '../../../apps/api/src/domain/skill/starter-pack';
const root=resolve(import.meta.dirname,'..');
async function main(){
 const source=new FileSkillStarterPackSource(resolve(root,'../starter-packs'));
 const pack=verifySkillStarterPack(await source.load('data-workflows','1.0.0'),{packId:'data-workflows',packVersion:'1.0.0'});
 assert.equal(await new FileSkillStarterPackSource(undefined).load('data-workflows','1.0.0'),null);
 assert.equal(await source.load('data-workflows','missing'),null);
 assert.deepEqual(pack.skills.map(s=>s.stableName),['data-analysis','data-visualization']);
 for(const skill of pack.skills){
  assert.equal(skill.files.length,6);
  for(const file of skill.files){
   if(file.path==='PROVENANCE.json')continue;
   assert.deepEqual(Buffer.from(file.contentBase64,'base64'),readFileSync(resolve(root,file.path==='SKILL.md'?`${skill.stableName}/${file.path}`:file.path)));
   const text=Buffer.from(file.contentBase64,'base64').toString();
   // Preserve relative local Markdown links in the upstream file after packaging.
   for(const link of text.matchAll(/\]\(([^)]+\.md)\)/g)){
    if(link[1]!.startsWith('http'))continue;
    const target=posix.normalize(posix.join(posix.dirname(file.path),link[1]!));
    assert.ok(skill.files.some(f=>f.path===target),`Missing local reference ${target}`);
   }
  }
  const entry=Buffer.from(skill.files[0]!.contentBase64,'base64').toString();
  assert.doesNotMatch(entry,/risk_level:/);assert.match(entry,/未|缺失/);
 }
 const changed=structuredClone(pack);changed.skills[0]!.files[0]!.contentBase64=Buffer.from('tampered').toString('base64');
 assert.throws(()=>verifySkillStarterPack(changed,{packId:'data-workflows',packVersion:'1.0.0'}));
 console.log('DATA_WORKFLOWS_REAL_STARTER_SOURCE_TWO_PACKAGES_HASHES_REFERENCES_TAMPER_GUARD_OK');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
