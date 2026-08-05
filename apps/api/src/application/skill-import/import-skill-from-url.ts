/**
 * #595 段 2 第一刀 —— 让取回层**有调用方**。
 *
 * ## 为什么这一刀排在最前面
 *
 * 段 1 交付的 `http-import-fetcher.ts` 落地时**没有任何调用方**，和它自己修好的
 * 那个「门没有调用方」是同一个形状——只是这次是已知且写明的。
 * ⚠ **「已知且写明」不改变它的危害，只改变谁该负责**：第一个是疏忽，
 *   明知故犯地留下第二个是决定。所以段 2 的第一刀就是把它接上。
 *
 * ## ⚠ 契约面是草案，未签核
 *
 * 输入/输出/错误码全部来自 `url-import-draft.ts`，那里逐字写明**尚未签核**。
 * ⛔ 本文件不重新声明任何字段名，就是为了让签核改得动。
 *
 * ## 这条用例**不自己判断地址安全**
 *
 * 所有 SSRF 判定都在取回层里（两道门）。本文件只做一件与安全有关的事：
 * **把拒绝原样往上抛，绝不吞掉**。⚠ 一个 `try { fetch } catch { 继续 }`
 * 会让两道门、六条反证、27 个断言**全部失效**，而测试不会有任何反应——
 * 所以这件事本身有独立的反证（见 `import-skill-from-url.test.ts` 反证⑦）。
 */
import { normalizedPath, sha256 } from "../../domain/skill/starter-pack";
import type { ImportUrlPolicy } from "../../domain/skill/import-source";
import {
  ImportSkillFromUrlError,
  type ImportSkillFromUrlInput,
  type ImportSkillFromUrlResult,
} from "./url-import-draft";

/** 单文件导入的上限；再大就该走 zip 那一轮（尚未开工）。 */
export const MAX_SINGLE_FILE_BYTES = 1024 * 1024;

/**
 * 取回一个导入源。**生产绑定是 `infrastructure/skill/http-import-fetcher.ts`
 * 的 `fetchImportSource`**，两道 SSRF 门都在它里面。
 *
 * ⚠ 做成端口是为了让用例层可测，**不是**为了让调用方换一个「不校验的取回器」。
 *   生产组装只允许绑那一个实现；`import-skill-from-url-wiring.test.ts` 锁住这一点。
 */
export interface ImportSourceFetcher {
  (
    rawUrl: string,
    policy: ImportUrlPolicy,
  ): Promise<{ readonly url: string; readonly mediaType: string; readonly body: Buffer }>;
}

export interface SkillUrlImportRepository {
  /** 已用同一幂等键导入过则回放，不重复落库。 */
  findByIdempotencyKey(input: {
    readonly orgId: string;
    readonly idempotencyKey: string;
  }): Promise<ImportSkillFromUrlResult | null>;

  persist(input: {
    readonly orgId: string;
    readonly actorId: string;
    readonly idempotencyKey: string;
    readonly name: string;
    readonly sourceUrl: string;
    readonly contentDigest: string;
    readonly files: readonly {
      readonly path: string;
      readonly content: Buffer;
      readonly mediaType: string;
      readonly digest: string;
    }[];
  }): Promise<ImportSkillFromUrlResult>;
}

export const SKILL_URL_IMPORT_REPOSITORY = Symbol("SkillUrlImportRepository");
export const IMPORT_SOURCE_FETCHER = Symbol("ImportSourceFetcher");

export interface ImportSkillFromUrlDeps {
  readonly fetch: ImportSourceFetcher;
  readonly repository: SkillUrlImportRepository;
  readonly policy: ImportUrlPolicy;
}

/**
 * 从取回的 URL 推出包内路径。
 *
 * ⚠ 路径判定**复用** `normalizedPath`（`domain/skill/starter-pack.ts`），
 *   不另起一套——URL 里可以塞 `../`，而那正是它挡的东西。
 */
function filePathFor(sourceUrl: string): string {
  const last = new URL(sourceUrl).pathname.split("/").filter(Boolean).pop();
  // 没有文件名（`https://host/`）时落成 skill 包的约定根文件。
  if (last === undefined || last === "") return "SKILL.md";
  try {
    return normalizedPath(decodeURIComponent(last));
  } catch {
    throw new ImportSkillFromUrlError("IMPORT_CONTENT_INVALID");
  }
}

export async function importSkillFromUrl(
  input: ImportSkillFromUrlInput,
  deps: ImportSkillFromUrlDeps,
): Promise<ImportSkillFromUrlResult> {
  const replay = await deps.repository.findByIdempotencyKey({
    orgId: input.orgId,
    idempotencyKey: input.idempotencyKey,
  });
  if (replay !== null) return { ...replay, replayed: true };

  /**
   * ⚠ 这里**故意没有 try/catch**。取回层的拒绝（SSRF / 协议 / 体积 / 本地组织）
   *   必须原样冒泡到调用方。吞掉它 = 两道门形同虚设。
   */
  const fetched = await deps.fetch(input.sourceUrl, deps.policy);

  if (fetched.body.length === 0 || fetched.body.length > MAX_SINGLE_FILE_BYTES) {
    throw new ImportSkillFromUrlError("IMPORT_CONTENT_INVALID");
  }

  // 路径按**取回后最终落地的 URL**算——重定向可能换了文件名。
  const path = filePathFor(fetched.url);
  const digest = sha256(fetched.body);

  return deps.repository.persist({
    orgId: input.orgId,
    actorId: input.actorId,
    idempotencyKey: input.idempotencyKey,
    name: input.name,
    sourceUrl: fetched.url,
    contentDigest: digest,
    files: [{ path, content: fetched.body, mediaType: fetched.mediaType, digest }],
  });
}
