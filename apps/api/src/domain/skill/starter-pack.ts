import { createHash } from "node:crypto";
import { posix } from "node:path";
import type { z } from "zod";
import { wave2Runtime } from "@repo/contracts";

export type SkillStarterPack = z.infer<typeof wave2Runtime.SkillStarterPack>;

export class InvalidSkillStarterPackError extends Error {
  constructor() {
    super("skill starter pack is invalid");
  }
}

export const sha256 = (value: string | Buffer): string =>
  createHash("sha256").update(value).digest("hex");

function decodeBase64(value: string): Buffer {
  const decoded = Buffer.from(value, "base64");
  const normalizedInput = value.replace(/=+$/, "");
  const normalizedOutput = decoded.toString("base64").replace(/=+$/, "");
  if (normalizedInput !== normalizedOutput) throw new InvalidSkillStarterPackError();
  return decoded;
}

/**
 * skill 包内文件路径的**唯一**规范化/防穿越入口。
 *
 * ⚠ #595 导出它，是为了让「URL 导入 / 文件上传 / 后台编辑」复用**同一份**判定，
 *   而不是各写一遍。DB 侧 `skill_version_files` 上还有一条同义 CHECK 兜底
 *   （`20260804031000_wave2_skill_starter_import.sql`）——那是第二道**机械**门，
 *   不是第二份定义：两者一旦分叉，DB 会拒掉应用层放行的行，而不是反过来。
 *   要改规则请改这里，并同步那条 CHECK。
 */
export function normalizedPath(path: string): string {
  if (path.includes("\\") || path.includes("\0")) throw new InvalidSkillStarterPackError();

  /**
   * ⚠ 逐条对齐 DB 的 `skill_version_files_normal_path`，**不是各写各的**：
   *   · `path ~ '^[^/\\]+(/[^/\\]+)*$'` ⇒ 段非空、无首尾斜杠、无 `//`；
   *   · `path !~ '(^|/)\.{1,2}(/|$)'`   ⇒ 任何一段都不能是 `.` 或 `..`。
   *
   * 旧实现用「`posix.normalize` 改写过就拒 + 拒 `.` + 拒 `../` 开头」近似这套规则，
   * **实测漏掉两条**（`skill-file-path-check-parity.test.ts`）：
   *   · `".."` —— 既不等于 `"."`，也不以 `"../"` 开头，于是被放行；
   *   · `"a/"` —— `posix.normalize` 不改写结尾斜杠，于是被放行。
   * 两条都被 DB 拒掉，所以从没写进过库；但**这个函数是全仓路径判定的单一事实源**
   * （#595 段 1 要求一律复用它），任何没有 DB 兜底的复用点都会因此逃一级目录。
   * ⇒ 现在按段切，语义与 DB 一一对应，不再靠 `normalize` 的副作用近似。
   *
   * ## ⚠⚠ 给下一个改这里的人（很可能就是我自己）
   *
   * 收紧时做过调用点审计，结论是「**今天**本函数的每个生产调用点都写
   * `skill_version_files`，都有 DB CHECK 兜底」。**那是一个会过期的前提。**
   *
   * ⇒ #595 后续的**上传 / 目录浏览 / 编辑保存**正是要引入
   *   **文件系统路径、zip 解压目标、对象存储 key** 的地方——那些路径
   *   **没有任何 DB CHECK 兜底**，本函数就是唯一的门。
   *
   * **在这里新增一个无 DB 兜底的调用点之前，先回来重读这段。**
   * 别把「审计过了」当成永久结论：审计的是当时的调用图，不是未来的。
   */
  const segments = path.split("/");
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") {
      throw new InvalidSkillStarterPackError();
    }
  }

  // 仍然拒绝任何 `normalize` 会改写的形状，作为上面逐段规则的冗余兜底。
  const normalized = posix.normalize(path);
  if (normalized !== path) throw new InvalidSkillStarterPackError();
  return normalized;
}

export function verifySkillStarterPack(raw: unknown, expected: {
  readonly packId: string;
  readonly packVersion: string;
}): SkillStarterPack {
  const parsed = wave2Runtime.SkillStarterPack.safeParse(raw);
  if (!parsed.success) throw new InvalidSkillStarterPackError();
  const pack = parsed.data;
  if (pack.packId !== expected.packId || pack.packVersion !== expected.packVersion) {
    throw new InvalidSkillStarterPackError();
  }

  const unsigned = {
    schemaVersion: pack.schemaVersion,
    packId: pack.packId,
    packVersion: pack.packVersion,
    skills: pack.skills,
  };
  if (sha256(JSON.stringify(unsigned)) !== pack.packDigest) {
    throw new InvalidSkillStarterPackError();
  }

  const stableNames = new Set<string>();
  const displayNames = new Set<string>();
  for (const skill of pack.skills) {
    if (stableNames.has(skill.stableName) || displayNames.has(skill.name.toLocaleLowerCase())) {
      throw new InvalidSkillStarterPackError();
    }
    stableNames.add(skill.stableName);
    displayNames.add(skill.name.toLocaleLowerCase());

    const paths = new Set<string>();
    let rootCount = 0;
    for (const file of skill.files) {
      const path = normalizedPath(file.path);
      if (paths.has(path)) throw new InvalidSkillStarterPackError();
      paths.add(path);
      if (path === "SKILL.md") rootCount += 1;
      if (sha256(decodeBase64(file.contentBase64)) !== file.digest) {
        throw new InvalidSkillStarterPackError();
      }
    }
    if (rootCount !== 1) throw new InvalidSkillStarterPackError();
  }
  return pack;
}

export function importPayloadDigest(input: {
  readonly packId: string;
  readonly packVersion: string;
}): string {
  return sha256(JSON.stringify({ packId: input.packId, packVersion: input.packVersion }));
}

export function skillContentDigest(skill: SkillStarterPack["skills"][number]): string {
  return sha256(JSON.stringify({
    manifest: skill.manifest,
    files: skill.files.map(({ path, digest, mediaType }) => ({ path, digest, mediaType })),
  }));
}
