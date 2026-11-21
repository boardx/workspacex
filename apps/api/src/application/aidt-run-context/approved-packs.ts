import { TrustedSkillPackage } from "@repo/contracts/standard-capabilities";
import { aidtContextCanonicalJson } from "@repo/contracts/aidt-run-context";
import type { PinnedSkillContent } from "../agent-run/ports";
import type { SkillStarterPackSource } from "../skill-import/ports";
import { verifySkillStarterPack } from "../../domain/skill/starter-pack";
import { computeContentHash } from "../../domain/artifact/content-hash";
import { AidtContextError } from "./errors";
/** Immutable shipped releases only. No filesystem discovery or latest-version substitution. */
export const AIDT_CONTEXT_PACK_RELEASES = [
  {packId:"aidt-methods",packVersion:"1.0.0"}, {packId:"aidt-methods",packVersion:"1.1.0"},
  {packId:"aidt-methods",packVersion:"1.2.0"}, {packId:"aidt-methods",packVersion:"1.3.0"},
  {packId:"aidt-methods",packVersion:"1.3.1"},
  {packId:"aidt-methods",packVersion:"1.3.2"},
  {packId:"aidt-methods",packVersion:"1.4.0"},
  {packId:"aidt-methods",packVersion:"1.4.1"},
  {packId:"aidt-methods",packVersion:"1.4.2"},
  {packId:"aidt-project-summary",packVersion:"1.0.0"},
  {packId:"aidt-project-summary",packVersion:"1.0.1"},
  {packId:"aidt-project-summary",packVersion:"1.0.2"},
  {packId:"aidt-project-summary",packVersion:"1.0.3"},
  {packId:"aidt-project-summary",packVersion:"1.0.4"},
] as const;
const fail=():never=>{throw new AidtContextError("AIDT_CONTEXT_NOT_AVAILABLE");};
function manifestDigest(files: readonly {path:string;mediaType:string;digest:string;contentBase64:string}[]): string {
  for(const file of files) if(computeContentHash(Buffer.from(file.contentBase64,"base64"))!==file.digest)fail();
  const manifest=files.map(({path,mediaType,digest})=>({path,mediaType,digest})).sort((a,b)=>a.path.localeCompare(b.path));
  return computeContentHash(Buffer.from(aidtContextCanonicalJson(manifest),"utf8"));
}
/** Proves content equality with a trusted shipped pack; does not claim platform account/import lineage. */
export async function verifyAidtPinnedSkill(pinned: PinnedSkillContent, source: SkillStarterPackSource): Promise<{packId:string;packVersion:string;packageDigest:string}> {
  const parsed=TrustedSkillPackage.safeParse(pinned.package);if(!parsed.success||parsed.data.versionId!==pinned.versionId)fail();
  const files=parsed.data!.files, root=files.find(file=>file.path==="SKILL.md");
  if(!root||new TextDecoder("utf-8",{fatal:true}).decode(Buffer.from(root.contentBase64,"base64"))!==pinned.content)fail();
  const actual=manifestDigest(files);
  for(const coordinate of AIDT_CONTEXT_PACK_RELEASES){
    const raw=await source.load(coordinate.packId,coordinate.packVersion);if(raw===null)continue;
    const pack=verifySkillStarterPack(raw,coordinate), candidate=pack.skills.find(skill=>skill.stableName===pinned.stableName);
    if(candidate&&manifestDigest(candidate.files)===actual)return {...coordinate,packageDigest:actual};
  }
  return fail();
}
