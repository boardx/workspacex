import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { PinnedSkillContent } from "../../src/application/agent-run/ports";
import { verifyAidtPinnedSkill } from "../../src/application/aidt-run-context/approved-packs";
const raw=JSON.parse(readFileSync(new URL("../../../../skills/starter-packs/aidt-methods/1.3.0.json",import.meta.url),"utf8"));
const entry=raw.skills.find((s:{stableName:string})=>s.stableName==="aidt-understand");
const pinned=():PinnedSkillContent=>({versionId:"actual-old-fixed-pin",stableName:entry.stableName,name:entry.name,content:Buffer.from(entry.files.find((f:{path:string})=>f.path==="SKILL.md").contentBase64,"base64").toString("utf8"),package:{skillId:"visible-org-skill",versionId:"actual-old-fixed-pin",files:structuredClone(entry.files)}});
const source={load:async(id:string,v:string)=>id==="aidt-methods"&&v==="1.3.0"?raw:null};
it("matches visible immutable package bytes to the approved release without requiring a platform receipt or latest ID",async()=>{expect(await verifyAidtPinnedSkill(pinned(),source)).toMatchObject({packId:"aidt-methods",packVersion:"1.3.0",packageDigest:expect.stringMatching(/^[a-f0-9]{64}$/)});});
it("rejects same-name fabricated content even with its self-consistent package digest",async()=>{const p={...pinned()};p.content="---\nname: aidt-understand\n---\nforged";p.package!.files[0]={...p.package!.files[0]!,contentBase64:Buffer.from(p.content).toString("base64"),digest:createHash("sha256").update(p.content).digest("hex")};await expect(verifyAidtPinnedSkill(p,source)).rejects.toMatchObject({reasonCode:"AIDT_CONTEXT_NOT_AVAILABLE"});});
it("rejects extra/missing package files and unavailable deployment pack sources",async()=>{const p={...pinned()};p.package={...p.package!,files:[...p.package!.files,{path:"extra.md",contentBase64:"eA==",mediaType:"text/markdown",digest:"2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881"}]};await expect(verifyAidtPinnedSkill(p,source)).rejects.toThrow();await expect(verifyAidtPinnedSkill(pinned(),{load:async()=>null})).rejects.toMatchObject({reasonCode:"AIDT_CONTEXT_NOT_AVAILABLE"});});
it.each([
  ["aidt-methods", "1.3.1", "aidt-empathize"],
  ["aidt-methods", "1.3.2", "aidt-understand"],
  ["aidt-project-summary", "1.0.1", "dt-summarize-project"],
  ["aidt-project-summary", "1.0.2", "dt-summarize-project"],
  ["aidt-project-summary", "1.0.3", "dt-summarize-project"],
  ["aidt-project-summary", "1.0.4", "dt-summarize-project"],
])("verifies the exact new %s@%s release without rewriting an older pin", async (packId, packVersion, stableName) => {
  const pack = JSON.parse(readFileSync(new URL(`../../../../skills/starter-packs/${packId}/${packVersion}.json`, import.meta.url), "utf8"));
  const skill = pack.skills.find((candidate: { stableName: string }) => candidate.stableName === stableName);
  const files = structuredClone(skill.files);
  const content = Buffer.from(files.find((file: { path: string }) => file.path === "SKILL.md").contentBase64, "base64").toString("utf8");
  const newPin: PinnedSkillContent = { versionId: "new-explicit-pin", stableName, name: skill.name, content, package: { skillId: "existing-lineage", versionId: "new-explicit-pin", files } };
  const releaseSource = { load: async (id: string, version: string) => id === packId && version === packVersion ? pack : null };
  expect(await verifyAidtPinnedSkill(newPin, releaseSource)).toMatchObject({ packId, packVersion, packageDigest: expect.stringMatching(/^[a-f0-9]{64}$/) });
  await expect(verifyAidtPinnedSkill(newPin, source)).rejects.toMatchObject({ reasonCode: "AIDT_CONTEXT_NOT_AVAILABLE" });
  expect(await verifyAidtPinnedSkill(pinned(), source)).toMatchObject({ packId: "aidt-methods", packVersion: "1.3.0" });
  expect(pinned().versionId).toBe("actual-old-fixed-pin");
});
