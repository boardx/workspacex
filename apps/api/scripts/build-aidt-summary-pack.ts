/** Build/check the opt-in summary task; never install, publish or overwrite a released pack. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSkillFrontmatter } from "../src/domain/skill/skill-frontmatter";
import { sha256, verifySkillStarterPack, type SkillStarterPack } from "../src/domain/skill/starter-pack";
import { AIDT_SUMMARY_SKILL_PACK } from "../src/infrastructure/aidt/aidt-module";
const repo = fileURLToPath(new URL("../../..", import.meta.url));
export const AIDT_SUMMARY_SOURCE = join(repo,"skills","aidt-reporting-candidates",AIDT_SUMMARY_SKILL_PACK.packVersion,"dt-summarize-project","SKILL.md");
export const AIDT_SUMMARY_OUTPUT_ROOT = join(repo,"skills","starter-packs",AIDT_SUMMARY_SKILL_PACK.packId);
export const AIDT_SUMMARY_CANDIDATE = AIDT_SUMMARY_SKILL_PACK;
export const AIDT_SUMMARY_CANDIDATE_SOURCE = join(repo,"skills","aidt-reporting-candidates",AIDT_SUMMARY_CANDIDATE.packVersion,"dt-summarize-project","SKILL.md");
export function buildAidtSummaryPack(source = AIDT_SUMMARY_SOURCE, coordinate:{packId:string;packVersion:string}=AIDT_SUMMARY_SKILL_PACK): SkillStarterPack {
  if(coordinate.packId!==AIDT_SUMMARY_SKILL_PACK.packId)throw new Error("AIDT summary pack lineage must remain unchanged");
  const bytes=readFileSync(source), text=bytes.toString("utf8"), meta=parseSkillFrontmatter(text,"dt-summarize-project");
  if(meta.semanticVersion!==coordinate.packVersion) throw new Error("AIDT summary source version differs from its requested coordinate");
  const title=/^# (.+)$/m.exec(text)?.[1];if(!title?.trim()) throw new Error("AIDT summary title missing");
  const unsigned={schemaVersion:1 as const,...coordinate,skills:[{stableName:meta.stableName,name:`AIDT · ${title.trim()}`,semanticVersion:meta.semanticVersion,
    manifest:{capabilityId:meta.capabilityId},files:[{path:"SKILL.md",mediaType:"text/markdown",digest:sha256(bytes),contentBase64:bytes.toString("base64")}]}]};
  return verifySkillStarterPack({...unsigned,packDigest:sha256(JSON.stringify(unsigned))},coordinate);
}
export function checkOrWriteAidtSummaryPack(pack: SkillStarterPack, outputRoot=AIDT_SUMMARY_OUTPUT_ROOT, check=false):{path:string;created:boolean} {
  const path=join(outputRoot,`${pack.packVersion}.json`),bytes=JSON.stringify(pack,null,2)+"\n";
  if(existsSync(path)) {if(readFileSync(path,"utf8")!==bytes)throw new Error("AIDT summary release exists with different bytes; use a new version, never overwrite a release");return {path,created:false};}
  if(check)throw new Error("AIDT summary release missing; build it before --check");
  mkdirSync(dirname(path),{recursive:true});writeFileSync(path,bytes,{flag:"wx"});return {path,created:true};
}
if(process.argv[1]!==undefined && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const candidate=process.argv.includes("--candidate");
  const pack=candidate?buildAidtSummaryPack(AIDT_SUMMARY_CANDIDATE_SOURCE,AIDT_SUMMARY_CANDIDATE):buildAidtSummaryPack();
  const result=checkOrWriteAidtSummaryPack(pack,AIDT_SUMMARY_OUTPUT_ROOT,process.argv.includes("--check"));
  process.stdout.write(`${result.created?"Created":"Verified"} ${result.path}\n`);
}
