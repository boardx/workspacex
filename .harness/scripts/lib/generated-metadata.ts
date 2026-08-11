/**
 * generated-metadata.ts —— PROP-HARNESS-MODEL-001 Epic E2（HMV2-015）：
 * generated 文件元数据（写入/解析/哈希三件原语）。
 *
 * 口径：coord-main 裁决条件下先行提案的主案（issue #422，2026-08-11，未见异议）——
 * **文件内注释头 + 正文哈希**，不用 sidecar manifest（文件与 manifest 可分离漂移，
 * 恰是 drift gate 要防的问题本身）。P6 原文"所有 generated 文件带来源和 revision"：
 * "带"在文件自身，文件被单独挪走/复制时指纹跟着走。
 *
 * 头部五字段（机器可解析，顺序固定）：
 *   generated-by:     <rendererId>
 *   source-instance:  <instance_id>
 *   source-template:  <TPL-xxx-NNN>
 *   source-revision:  <exact SHA>
 *   content-hash:     <正文 sha256 前 16 位十六进制>
 *
 * content-hash 只覆盖**正文**（头部之后的内容）——这让 HMV2-016 的 drift gate
 * 成为纯本地判定：重算正文哈希 vs 头部声明，不用回查渲染源；手改生成物立刻可测。
 *
 * 注释语法按扩展名登记（初期 .md / .yaml / .yml）。**遇到未登记的扩展名抛错**，
 * 不静默省略头——静默省略 = 产出一份永远测不出漂移的生成物，比失败更糟（P7
 * 失败开放禁止进入权威视图的同款精神）。
 *
 * 范围纪律（HMV2-015 只做这一条）：本文件只提供 wrap/parse/verify 三件原语，
 * 不扫描仓库（HMV2-016 drift gate）、不接 CLI（HMV2-017）。
 * 风格同 renderer-model.ts：纯函数、无 IO、显式报错。
 */
import { createHash } from "node:crypto";

export interface GeneratedHeader {
  rendererId: string;
  sourceInstanceId: string;
  sourceTemplateId: string;
  sourceRevision: string;
  contentHash: string;
}

/** 支持的注释语法。key 是小写扩展名（含点）。 */
interface CommentSyntax {
  open: string;
  linePrefix: string;
  close: string | null;
}

const COMMENT_SYNTAX: Record<string, CommentSyntax> = {
  ".md": { open: "<!--", linePrefix: "  ", close: "-->" },
  ".yaml": { open: "", linePrefix: "# ", close: null },
  ".yml": { open: "", linePrefix: "# ", close: null },
};

const HEADER_FIELDS = [
  ["generated-by", "rendererId"],
  ["source-instance", "sourceInstanceId"],
  ["source-template", "sourceTemplateId"],
  ["source-revision", "sourceRevision"],
  ["content-hash", "contentHash"],
] as const;

export function supportedExtensions(): string[] {
  return Object.keys(COMMENT_SYNTAX);
}

function extOf(path: string): string {
  const i = path.lastIndexOf(".");
  return i === -1 ? "" : path.slice(i).toLowerCase();
}

/** 正文 sha256 前 16 位。正文以传入原文计算，不做行尾归一化——归一化会掩盖真实字节漂移。 */
export function hashBody(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex").slice(0, 16);
}

/**
 * 给正文包上元数据头，返回最终文件内容。contentHash 在这里计算——调用方
 * 不传哈希，防止"声明的哈希"与"实际正文"在源头就不一致。
 */
export function wrapWithHeader(
  path: string,
  body: string,
  meta: Omit<GeneratedHeader, "contentHash">,
): string {
  const syntax = COMMENT_SYNTAX[extOf(path)];
  if (!syntax) {
    throw new Error(
      `不支持给 ${JSON.stringify(path)} 嵌元数据头（扩展名未登记注释语法，已登记：${supportedExtensions().join(" ")}）——` +
        "宁可失败也不产出测不了漂移的生成物",
    );
  }
  const header: GeneratedHeader = { ...meta, contentHash: hashBody(body) };
  const lines: string[] = [];
  if (syntax.open) lines.push(syntax.open);
  for (const [key, prop] of HEADER_FIELDS) {
    lines.push(`${syntax.linePrefix}${key}: ${header[prop]}`);
  }
  if (syntax.close) lines.push(syntax.close);
  return `${lines.join("\n")}\n${body}`;
}

export interface ParsedGenerated {
  header: GeneratedHeader;
  body: string;
}

export interface ParseIssue {
  path: string;
  message: string;
}

/**
 * 解析一份带头文件。三种结果：
 *   - `{ parsed }`：头完整合法；
 *   - `{ parsed: null, issues: [] }`：**没有**元数据头（这不是错误——仓库里
 *     大量文件本来就不是生成物；是否"该有头而没有"由 HMV2-016 按目录约定判定）；
 *   - `{ parsed: null, issues: [...] }`：有头但残缺/畸形——这必须报，半个头
 *     意味着有人手动动过头部。
 */
export function parseGeneratedHeader(path: string, content: string): { parsed: ParsedGenerated | null; issues: ParseIssue[] } {
  const syntax = COMMENT_SYNTAX[extOf(path)];
  if (!syntax) return { parsed: null, issues: [] };

  const lines = content.split("\n");
  let idx = 0;
  if (syntax.open) {
    if (lines[idx] !== syntax.open) return { parsed: null, issues: [] };
    idx++;
  } else if (!(lines[0] ?? "").startsWith(`${syntax.linePrefix}${HEADER_FIELDS[0][0]}:`)) {
    return { parsed: null, issues: [] };
  }

  const issues: ParseIssue[] = [];
  const collected: Partial<Record<(typeof HEADER_FIELDS)[number][1], string>> = {};
  for (const [key, prop] of HEADER_FIELDS) {
    const line = lines[idx] ?? "";
    const prefix = `${syntax.linePrefix}${key}: `;
    if (!line.startsWith(prefix) || line.slice(prefix.length).trim().length === 0) {
      issues.push({ path, message: `元数据头第 ${idx + 1} 行应为 "${prefix}<值>"，实得 ${JSON.stringify(line)}` });
    } else {
      collected[prop] = line.slice(prefix.length).trim();
    }
    idx++;
  }
  if (syntax.close) {
    if (lines[idx] !== syntax.close) {
      issues.push({ path, message: `元数据头缺闭合行 ${JSON.stringify(syntax.close)}` });
    }
    idx++;
  }
  if (issues.length > 0) return { parsed: null, issues };

  return {
    parsed: {
      header: collected as unknown as GeneratedHeader,
      body: lines.slice(idx).join("\n"),
    },
    issues: [],
  };
}

/**
 * 校验一份已解析文件的正文哈希。mismatch = 头部声明与实际正文对不上——
 * 要么正文被手改，要么头被伪造。这是 HMV2-016 drift gate 的核心判定原语。
 */
export function verifyContentHash(parsed: ParsedGenerated): { ok: boolean; declared: string; actual: string } {
  const actual = hashBody(parsed.body);
  return { ok: actual === parsed.header.contentHash, declared: parsed.header.contentHash, actual };
}
