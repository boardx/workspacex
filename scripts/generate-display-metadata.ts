/** Derived display release: requirement headings author the titles; immutable
 * legacy pack coordinates/digests pin the original execution base. */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { officialRoleSkillPacks } from "../apps/api/src/domain/agent/official-role-packs";
const root = fileURLToPath(new URL("../", import.meta.url));
export const DISPLAY_METADATA_VERSION = "2.0.0";
export function buildDisplayMetadata() {
  const titles = (directory: string) => Object.fromEntries(readdirSync(resolve(root, directory)).filter(name => name.endsWith(".md")).sort().map(name => {
    const heading = readFileSync(resolve(root,directory,name),"utf8").split("\n")[0]!;
    const match = /^# ([SD]\d{3}) — (.+?)（(.+?)）$/.exec(heading);
    if (!match) throw new Error(`Unrecognized authored title: ${name}`);
    return [match[1]!, { en: { name: match[2]! }, "zh-CN": { name: match[3]!.split("：")[0]!.replace(/数字人$/,"") } }];
  }));
  const base = resolve(root,"skills/starter-packs");
  const current = new Map<string, string>();
  for (const ref of officialRoleSkillPacks()) {
    const prior = current.get(ref.packId);
    if (!prior || ref.packVersion.localeCompare(prior,"en",{ numeric:true }) > 0) current.set(ref.packId,ref.packVersion);
  }
  const packages = Object.fromEntries(readdirSync(base).filter(name => name.startsWith("work-")).sort().map(packId => {
    // Pin current official dependencies so shared definitions remain compatible.
    // Historical package files remain immutable.
    const versions = readdirSync(resolve(base,packId)).filter(name => /^\d+\.\d+\.\d+\.json$/.test(name)).sort((a,b) => a.localeCompare(b,"en",{ numeric:true }));
    const version = current.get(packId);
    const filename = version ? `${version}.json` : versions.at(-1);
    if (!filename) throw new Error(`Missing legacy base: ${packId}`);
    const pack = JSON.parse(readFileSync(resolve(base,packId,filename),"utf8")) as { packVersion: string; packDigest: string };
    return [packId, { baseVersion: pack.packVersion, baseDigest: pack.packDigest }];
  }));
  return { metadataVersion: DISPLAY_METADATA_VERSION, skills: titles("requirements/work-stack-v2/skills"), agents: titles("requirements/work-stack-v2/digital-humans"), packages };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const path = resolve(root,"skills/localizations/work-stack-v2.json"), expected = JSON.stringify(buildDisplayMetadata(),null,2)+"\n";
  if (process.argv.includes("--check")) {
    if (readFileSync(path,"utf8") !== expected) throw new Error("Authored display metadata is stale; regenerate and review a versioned release");
    process.stdout.write("Authored display metadata matches requirement headings and pinned legacy packages\n");
  } else writeFileSync(path,expected);
}
