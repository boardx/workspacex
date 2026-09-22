import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sha256, verifySkillStarterPack } from '../../../apps/api/src/domain/skill/starter-pack';
import { parseSkillFrontmatter } from '../../../apps/api/src/domain/skill/skill-frontmatter';
const root=resolve(import.meta.dirname,'..');
const upstreamRevision='1f517b9de47e827c80cd933ed364e16838072239';
// stable_name / version / capability_id 的唯一来源是 SKILL.md frontmatter（issue #3154）；
// 这张表只留构建侧独有的事实：显示名与上游目录名。
const specs=[['data-analysis','数据分析','analyze'],['data-visualization','数据可视化','data-visualization']] as const;
const skills=specs.map(([directory,name,upstreamName])=>{
 const paths=['SKILL.md','references/runtime.md','upstream/LICENSE','upstream/data/CONNECTORS.md',`upstream/data/skills/${upstreamName}/source.md`];
 const files=paths.map(path=>{
  const bytes=readFileSync(resolve(root,path==='SKILL.md'?`${directory}/${path}`:path));
  return {path,mediaType:'text/markdown',digest:sha256(bytes),contentBase64:bytes.toString('base64')};
 });
 const provenance={repository:'https://github.com/anthropics/knowledge-work-plugins',revision:upstreamRevision,license:'Apache-2.0',sourcePath:`data/skills/${upstreamName}/SKILL.md`,localPath:`upstream/data/skills/${upstreamName}/source.md`,sourceDigest:files.at(-1)!.digest,adaptation:'Upstream bytes preserved under source.md; WorkspaceX entry and runtime reference define the offline subset.'};
 const bytes=Buffer.from(JSON.stringify(provenance,null,2)+'\n');
 files.push({path:'PROVENANCE.json',mediaType:'application/json',digest:sha256(bytes),contentBase64:bytes.toString('base64')});
 const meta=parseSkillFrontmatter(readFileSync(resolve(root,directory,'SKILL.md'),'utf8'),directory);
 return {stableName:meta.stableName,name,semanticVersion:meta.semanticVersion,manifest:{capabilityId:meta.capabilityId,upstreamRevision},files};
});
const unsigned={schemaVersion:1,packId:'data-workflows',packVersion:'1.0.0',skills};
const pack={...unsigned,packDigest:sha256(JSON.stringify(unsigned))};
verifySkillStarterPack(pack,{packId:'data-workflows',packVersion:'1.0.0'});
const file=resolve(root,'../starter-packs/data-workflows/1.0.0.json');
const serialized=JSON.stringify(pack,null,2)+'\n';
if(process.argv.includes('--check')){
 if(readFileSync(file,'utf8')!==serialized)throw new Error('Data starter pack is stale; run scripts/build.ts');
}else writeFileSync(file,serialized);
