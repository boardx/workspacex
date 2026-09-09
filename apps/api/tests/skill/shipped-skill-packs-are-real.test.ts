/**
 * 标准 skill 包的 ③④ 层：**真的发货出去的那些字节**，内容对不对、它让模型调的工具存不存在。
 *
 * ## 为什么看 `starter-packs/<pack>/<version>.json` 而不是看 `skills/<pack>/<skill>/`
 *
 * 被 seed 进平台组织、最终挂到模型面前的，是构建产物 JSON 里那串 base64——不是仓库里
 * 那个源文件。两者是**同一事实的两处声明**：源文件改了、包没重建，仓库里看起来一切正常，
 * 发货的还是旧正文。本仓 2026-09-09 已经在版本号上栽过同一形态（构建侧 1.1.2 / 发货侧
 * 1.1.1，`lint-shipped-pack-version.mjs` 的模块注释）。这里补的是**正文字节**那一半。
 *
 * ## ④ 的判据（禁止用大小/存在性）
 *
 * 真的 base64 解码、真的重算 sha256、真的和磁盘上的源文件**逐字节**比对，
 * 真的 UTF-8 解出 frontmatter 读 `name`。不看文件大小，不看"文件在不在"。
 *
 * ## ③ 的前置条件：skill 让模型调的工具必须真的存在
 *
 * SKILL.md 里写着"用 `wx_knowledge_search` 找资料"。这个名字如果不在服务端准入表里，
 * 那句指令就是死的——模型照做也调不到任何东西，而且没有任何报错（`native_factory`
 * 的静默过滤，见 #3159）。`web_fetch` / `bash_exec` 已经证明"看着像真的名字"能在仓库里
 * 活很多年（#3160）。所以：**发货正文里点到的工具名，必须逐个存在于准入表**。
 *
 * 空集防线：比对不到文件、扫不出工具名，一律判红——本仓九次"全绿但空转"。
 */
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { STANDARD_PLATFORM_PACKS } from "../../src/infrastructure/skill/ensure-standard-skill-packs";
import { NATIVE_PROFILE_TOOLS } from "../../src/application/agent-run/native-invocation";

const SKILLS_ROOT = fileURLToPath(new URL("../../../../skills/", import.meta.url));

interface ShippedFile { readonly path: string; readonly digest: string; readonly contentBase64: string }
interface ShippedSkill { readonly stableName: string; readonly files: readonly ShippedFile[] }

function shippedPacks() {
  const packs = STANDARD_PLATFORM_PACKS.map(pack => ({
    ...pack,
    skills: JSON.parse(readFileSync(`${SKILLS_ROOT}starter-packs/${pack.packId}/${pack.packVersion}.json`, "utf8")).skills as ShippedSkill[],
  }));
  expect(packs.length).toBeGreaterThan(5);
  return packs;
}

describe("发货出去的标准 skill 包", () => {
  it("每个文件的 digest 与正文一致，且与仓库里的源文件逐字节相同", () => {
    let comparedToSource = 0;
    const corrupt: string[] = [];
    const drifted: string[] = [];
    for (const pack of shippedPacks()) {
      for (const skill of pack.skills) {
        for (const file of skill.files) {
          const bytes = Buffer.from(file.contentBase64, "base64");
          if (createHash("sha256").update(bytes).digest("hex") !== file.digest) {
            corrupt.push(`${pack.packId}@${pack.packVersion}/${skill.stableName}/${file.path}`);
          }
          // 构建产物（PROVENANCE.json、upstream/ 快照等）在仓库里没有对应源文件，
          // 它们由 digest 那条覆盖；这里只比对确有源文件的那些。
          const source = `${SKILLS_ROOT}${pack.packId}/${skill.stableName}/${file.path}`;
          if (!existsSync(source)) continue;
          comparedToSource += 1;
          if (!readFileSync(source).equals(bytes)) {
            drifted.push(`${pack.packId}@${pack.packVersion}/${skill.stableName}/${file.path}`);
          }
        }
      }
    }
    expect(corrupt).toEqual([]);
    expect(drifted).toEqual([]);
    // 一个都没比对上 = 路径拼错，全称断言平凡为真。宁可红。
    expect(comparedToSource).toBeGreaterThan(40);
  });

  it("每个 skill 的 SKILL.md 真的能解码，且 frontmatter 的 name 就是它的 stableName", () => {
    let checked = 0;
    const mismatched: string[] = [];
    for (const pack of shippedPacks()) {
      for (const skill of pack.skills) {
        const entry = skill.files.find(file => file.path === "SKILL.md");
        expect(entry, `${pack.packId}/${skill.stableName} 没有 SKILL.md`).toBeDefined();
        const text = Buffer.from(entry!.contentBase64, "base64").toString("utf8");
        const name = /^---\r?\n(?:[\s\S]*?\r?\n)?name:\s*(\S+)\s*$/m.exec(text)?.[1]
          ?? /^\s*name:\s*(\S+)\s*$/m.exec(text)?.[1];
        checked += 1;
        if (name !== skill.stableName) mismatched.push(`${pack.packId}/${skill.stableName}: frontmatter name=${name}`);
      }
    }
    expect(mismatched).toEqual([]);
    expect(checked).toBeGreaterThan(10);
  });

  it("发货正文里点名的工具，必须真的在服务端准入表里（点了不存在的名字 = 那条指令是死的）", () => {
    const admitted = new Set<string>(NATIVE_PROFILE_TOOLS);
    // 只认反引号里的、长得像工具名的 token：`wx_*` / `browser_*` / `sql_db_*` 三个族，
    // 外加执行内核那几个固定名字。散文里的普通词不在此列。
    const shape = /^(?:wx_[a-z0-9_]+|browser_[a-z0-9_]+|sql_db_[a-z0-9_]+|web_search|fetch_url|spawn_async_task|write_todos|call_skill)$/;
    const referenced = new Map<string, string[]>();
    for (const pack of shippedPacks()) {
      for (const skill of pack.skills) {
        for (const file of skill.files) {
          if (!file.path.endsWith(".md")) continue;
          const text = Buffer.from(file.contentBase64, "base64").toString("utf8");
          for (const match of text.matchAll(/`([a-z][a-z0-9_]+)`/g)) {
            const token = match[1]!;
            if (!shape.test(token)) continue;
            referenced.set(token, [...(referenced.get(token) ?? []), `${pack.packId}/${skill.stableName}/${file.path}`]);
          }
        }
      }
    }
    // 扫不出工具名 = 正则或解码坏了，下面的全称断言会平凡为真。
    expect(referenced.size).toBeGreaterThan(8);
    const dead = [...referenced.entries()].filter(([token]) => !admitted.has(token))
      .map(([token, where]) => `${token} (${where[0]}${where.length > 1 ? ` +${where.length - 1}` : ""})`);
    expect(dead).toEqual([]);
  });
});
