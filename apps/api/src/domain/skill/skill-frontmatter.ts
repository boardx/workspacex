/**
 * skill-frontmatter.ts —— 标准 skill 三个元数据字段的**唯一**读取入口。
 *
 * ## 这个文件存在的理由（issue #3154）
 *
 * `stable_name` / `version` / `capability_id` 此前写在两处：`SKILL.md` 的 frontmatter
 * 和 `skills/<pack>/scripts/build.ts` 的 `stableName` / `semanticVersion` /
 * `manifest.capabilityId`。16 个标准 skill 里 9 个两处都写、7 个只写 `name`——
 * 两处手写、从没被比对过，正是本仓「同一事实不得声明在两处」那条硬约束点名的形态。
 *
 * 收敛方向：**frontmatter 权威**。`build.ts` 一律从这里读，自己不再写任何一个字面量，
 * 由 `.harness/scripts/lint-skill-metadata-source.mjs` 机械看住第二份副本不会重新长出来。
 *
 * ## 为什么放在 domain 而不是 skills/ 下
 *
 * `skills/*\/scripts/build.ts` 已经在 import `../../../apps/api/src/domain/skill/starter-pack`
 * 的 `sha256` / `verifySkillStarterPack`——同一条既有依赖边，不新开第二条。本文件是**纯函数**，
 * 不碰 fs、不碰 DB：调用方把已经读出来的 SKILL.md 正文传进来（build.ts 本来就要读这份字节
 * 去算 digest，不会因此多读一次文件）。
 *
 * ## 形态（#3154 待决点 ①）
 *
 * 新增 skill **一律顶层**写 `name:` / `version:` / `capability_id:`。
 * 历史上有 5 个已发货 skill 把后两个嵌在 `metadata:` 下一层，本解析器仍读得懂，
 * 但名单只减不增——名单与判定都在上面那个 lint 里，这里只负责「读得出来」。
 * 同一个字段**不许**顶层和 `metadata:` 下各写一遍：那又是同一事实两处声明。
 */

export class SkillFrontmatterError extends Error {}

export interface SkillFrontmatterMetadata {
  /** 包内稳定标识，等于 `skills/<pack>/<stableName>/` 的目录名。 */
  readonly stableName: string;
  /** 该 skill 自己的语义版本；写进产物的 `semanticVersion`。 */
  readonly semanticVersion: string;
  /** 能力编号；写进产物的 `manifest.capabilityId`。 */
  readonly capabilityId: string;
  /** 这个 skill 的 version / capability_id 是不是嵌在 `metadata:` 下的历史写法。 */
  readonly nestedMetadata: boolean;
}

const STABLE_NAME = /^[a-z0-9][a-z0-9-]*$/;
const SEMANTIC_VERSION = /^\d+\.\d+\.\d+$/;

/** 取 frontmatter 原文（首个 `---` 到下一个 `---`）。没有就是 null，不是空串。 */
function frontmatterBlock(markdown: string): string | null {
  const matched = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown);
  return matched === null ? null : matched[1]!;
}

/** 顶层（零缩进）标量字段。 */
function topLevel(block: string, key: string): string | null {
  const matched = new RegExp(`^${key}:[ \\t]*(\\S.*?)[ \\t]*$`, "m").exec(block);
  return matched === null ? null : unquote(matched[1]!);
}

/** `metadata:` 块内缩进一层的标量字段（历史写法）。 */
function underMetadata(block: string, key: string): string | null {
  const nested = /^metadata:[ \t]*\r?\n((?:[ \t]+.*(?:\r?\n|$))+)/m.exec(block);
  if (nested === null) return null;
  const matched = new RegExp(`^[ \\t]+${key}:[ \\t]*(\\S.*?)[ \\t]*$`, "m").exec(nested[1]!);
  return matched === null ? null : unquote(matched[1]!);
}

function unquote(value: string): string {
  return /^(['"]).*\1$/.test(value) ? value.slice(1, -1) : value;
}

/**
 * 同一个字段只许声明一处：顶层与 `metadata:` 下同时出现 ⇒ 红（哪怕值一样）。
 * 「值一样」不是豁免理由——两份副本本来就总是从「值一样」开始的。
 */
function single(block: string, key: string, where: string): { value: string | null; nested: boolean } {
  const flat = topLevel(block, key);
  const nested = underMetadata(block, key);
  if (flat !== null && nested !== null) {
    throw new SkillFrontmatterError(
      `${where}: frontmatter 同时在顶层和 metadata: 下写了 ${key}——同一事实两处声明，删掉一处`,
    );
  }
  return { value: flat ?? nested, nested: nested !== null };
}

/**
 * 从 SKILL.md 正文解析出三个单源字段。任何缺失/冲突/格式不合法都**抛**，
 * 不返回 null：读不出来时拒绝下判断，而不是让构建拿着 undefined 往下走。
 *
 * @param expectedStableName 调用方所在的目录名。传了就要求 frontmatter 的 `name`
 *   与它逐字相等——目录名与 `name` 漂移过就会让「按名字找目录」悄悄取错文件。
 */
export function parseSkillFrontmatter(
  markdown: string,
  expectedStableName?: string,
): SkillFrontmatterMetadata {
  const where = expectedStableName ?? "SKILL.md";
  const block = frontmatterBlock(markdown);
  if (block === null) throw new SkillFrontmatterError(`${where}: SKILL.md 没有 frontmatter`);

  const name = single(block, "name", where);
  const version = single(block, "version", where);
  const capability = single(block, "capability_id", where);

  const missing = [
    name.value === null ? "name" : null,
    version.value === null ? "version" : null,
    capability.value === null ? "capability_id" : null,
  ].filter((field): field is string => field !== null);
  if (missing.length > 0) {
    throw new SkillFrontmatterError(
      `${where}: frontmatter 缺 ${missing.join(" / ")}——这三个字段是构建的唯一来源，必须写在 SKILL.md 里`,
    );
  }

  const stableName = name.value!;
  const semanticVersion = version.value!;
  const capabilityId = capability.value!;
  if (!STABLE_NAME.test(stableName)) {
    throw new SkillFrontmatterError(`${where}: name "${stableName}" 不是合法 stable_name（^[a-z0-9][a-z0-9-]*$）`);
  }
  if (!SEMANTIC_VERSION.test(semanticVersion)) {
    throw new SkillFrontmatterError(`${where}: version "${semanticVersion}" 不是 x.y.z`);
  }
  if (capabilityId.length === 0) throw new SkillFrontmatterError(`${where}: capability_id 为空`);
  if (expectedStableName !== undefined && stableName !== expectedStableName) {
    throw new SkillFrontmatterError(
      `${where}: frontmatter 的 name "${stableName}" 与目录名 "${expectedStableName}" 不一致`,
    );
  }

  return { stableName, semanticVersion, capabilityId, nestedMetadata: version.nested || capability.nested };
}
