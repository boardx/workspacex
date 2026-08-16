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
import type { IdentityRepository } from "../identity/ports";
import { toOrgId } from "../../domain/org-id";
import type { ImportUrlPolicy } from "../../domain/skill/import-source";
import { SkillNameConflictError } from "../skill/ports";
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

/**
 * DI 边界：controller 拿到的**不是**装配好的 deps，而是一个**工厂**。
 *
 * ## 为什么必须是工厂而不是一个现成的 deps
 *
 * `policy.localOnlyOrg` 是**逐请求**的（取决于该请求所属组织的 `kind`），
 * 而 provider 是**单例**。把 deps 做成单例 = 把第一个请求的组织类型
 * 固化给所有后续请求 —— 一个普通组织的请求会带着上一个 personal-local 组织的
 * 策略跑，或者反过来。⚠ 后者更糟：它**静默地**让本地组织的出站承诺（I-9）失效。
 *
 * ## 为什么 controller 不能自己 import 装配函数
 *
 * 实测：那样写 `lint-arch-deps` 当场红——
 * 「interface layer imports infrastructure layer」。洋葱依赖方向是硬约束，
 * ⛔ 不许为了少写一个 token 而绕过它。⇒ 装配留在 infrastructure，
 * 由 `kernel.module.ts` 用这个 token 注进来，controller 只认这个**应用层**类型。
 */
export interface ImportSkillFromUrlDepsFactory {
  (input: { readonly localOnlyOrg: boolean }): ImportSkillFromUrlDeps;
}

export const IMPORT_SKILL_FROM_URL_DEPS_FACTORY = Symbol("ImportSkillFromUrlDepsFactory");

export interface ImportSkillFromUrlDeps {
  /** 授权来源。⚠ 与 starter-pack 导入同一条门槛，见下方 admin 检查。 */
  readonly identities: IdentityRepository;
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

/**
 * G1（2026-08-14）—— GitHub **目录** URL（`.../tree/<branch>/<path>`）。
 *
 * ⚠ 在这条分支加入之前，这种 URL 会被当成「单文件」处理：`filePathFor` 从路径最后一段
 *   取文件名（比如 `gpt-image-2`，没有扩展名），`fetchImportSource` 直接 GET 这个 HTML
 *   页面本身（GitHub 的目录页，不是文件内容）。只要页面字节数不超 1MB 且这次的 name
 *   没有撞现有 skill（G1 的另一半修复），这条路径会**成功**——但落库的是一份叫
 *   `gpt-image-2` 的文件、内容是整页 HTML，不是使用者以为的那个 skill 目录。
 *   这是「看起来成功、实际是垃圾」，比诚实报错更糟——所以这里改成把整个子目录当成
 *   skill 目录导入，而不是仅仅把错误提示写得更好看。
 */
const GITHUB_TREE_URL_RE =
  /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+?)\/?$/;

interface GithubTreeTarget {
  readonly owner: string;
  readonly repo: string;
  readonly branch: string;
  /** 仓库内的目录路径，比如 `skills/gpt-image-2`。不含前导/尾随斜杠。 */
  readonly dirPath: string;
}

export function parseGithubTreeUrl(raw: string): GithubTreeTarget | null {
  const match = GITHUB_TREE_URL_RE.exec(raw);
  if (match === null) return null;
  const [, owner, repo, branch, path] = match;
  if (owner === undefined || repo === undefined || branch === undefined || path === undefined) return null;
  return { owner, repo, branch, dirPath: decodeURIComponent(path) };
}

/** 目录导入的保守上限：导入的是 skill 目录，不是整个仓库。 */
const MAX_DIRECTORY_FILES = 200;
const MAX_DIRECTORY_DEPTH = 6;

interface GithubContentEntry {
  readonly type: string;
  readonly name: string;
  readonly path: string;
  readonly download_url: string | null;
}

/**
 * 单个目录里并发下载文件的上限。
 *
 * ⚠ 实测（真栈 e2e，`skill-agent-import-usecase-audit.spec.ts` ①，2026-08-16）：
 *   逐个 `await` 下载 `anthropics/skills` 的 `skill-creator` 目录（18 个文件，
 *   分散在 6 层目录里）在系统负载下总耗时越过了 **Next.js 同源代理写死的 30 秒
 *   `proxyTimeout`**（`next/dist/server/lib/router-utils/proxy-request.js`：
 *   `proxyTimeout: proxyTimeout || 30000`，框架默认值，本仓没有配置它）。
 *   浏览器侧看到的是一个没有 `traceId` 的裸 500——因为连接是被 **Next 的代理**
 *   掐断的，请求根本没走到 NestJS 的异常过滤器；单独跑（同样的 18 个文件）只要
 *   10-15 秒，说明这不是「GitHub 变慢了」，是「串行等待把总时长堆到了框架超时线附近，
 *   一旦本机同时在跑 docker/构建/浏览器就会越过去」——任何比这更大、层级更深的
 *   skill 目录，经这条同源代理路径导入，**必然**在某个负载水平下复现同一个 500，
 *   不是偶发。⇒ 修法是缩短总耗时，不是加大超时——加大超时改不动 Next 的默认值，
 *   除非自定义 server（那是另一件更大的事）。
 *
 * 目录列表本身（`walk` 的递归调用）仍然逐层顺序进行——目录数远少于文件数，
 * 且子目录列表必须先于其中的文件被发现。真正拖时长的是**文件下载**，这里只
 * 并发这一段。上限选 6：GitHub 未认证请求 60/小时的配额下，过高的并发只会
 * 更快触顶配额而不会让单次导入明显更快（下载本身不是这条链路的瓶颈，
 * 排队等待才是）。
 */
const DIRECTORY_DOWNLOAD_CONCURRENCY = 6;

/**
 * 递归走 GitHub Contents API 把一个目录取成 `{ 相对路径 → 字节 }` 的扁平文件集合。
 *
 * ⚠ 每一次 HTTP 调用（目录列表、单个文件）都走 `deps.fetch`——与单文件导入
 *   同一条两道 SSRF 门流水线，这里不另开一条不经过校验的取回路径。
 * ⚠ `entry.path` 相对 `root.dirPath` 求出**包内相对路径**（`skill 目录本身就是发布出去
 *   的目录结构`，与 `AgSkillEditor` 头注「左侧文件树就是发布出去的目录结构」同一心智）。
 */
async function fetchGithubDirectoryFiles(
  root: GithubTreeTarget,
  fetchFn: ImportSourceFetcher,
  policy: ImportUrlPolicy,
): Promise<readonly { path: string; content: Buffer; mediaType: string; digest: string }[]> {
  const files: { path: string; content: Buffer; mediaType: string; digest: string }[] = [];

  /**
   * 一个文件条目取回并落进 `files`——被 `walk` 的并发下载池复用。
   * 抛出的错误与此前逐个 `await` 时逐字相同（`IMPORT_CONTENT_INVALID`），
   * 只是现在多个条目的这段代码可能并发在跑。
   */
  async function fetchOneFile(raw: GithubContentEntry): Promise<void> {
    if (raw.download_url === null) return; // 符号链接/submodule 等，跳过
    const fetched = await fetchFn(raw.download_url, policy);
    /**
     * 实测（真栈 e2e，走 `anthropics/skills` 的 `skill-creator` 目录）：
     * `scripts/__init__.py` 是仓库里一个真实存在、合法的 0 字节文件——GitHub
     * Contents API 的 `download_url` 已经告诉我们「这确实是一个文件」，空字节数组
     * 就是它诚实的内容，不是取回失败的信号。⚠ 这里不能照抄单文件导入分支
     * （`filePathFor` 那条，第 292 行附近）的「空字节 ⇒ 判定失败」——那条判据成立
     * 的前提是「一个 URL 到底有没有指向东西」是不确定的，而目录列表已经消除了
     * 这个不确定性。照抄会让任何含空文件的真实仓库目录**必然**导入失败。
     */
    if (fetched.body.length > MAX_SINGLE_FILE_BYTES) {
      throw new ImportSkillFromUrlError("IMPORT_CONTENT_INVALID");
    }
    const relative = raw.path.startsWith(`${root.dirPath}/`)
      ? raw.path.slice(root.dirPath.length + 1)
      : raw.path;
    let path: string;
    try {
      path = normalizedPath(relative);
    } catch {
      throw new ImportSkillFromUrlError("IMPORT_CONTENT_INVALID");
    }
    files.push({ path, content: fetched.body, mediaType: fetched.mediaType, digest: sha256(fetched.body) });
  }

  /** 有界并发跑一批文件条目——池子里最多 `DIRECTORY_DOWNLOAD_CONCURRENCY` 个同时在飞。 */
  async function downloadFilesBounded(entries: readonly GithubContentEntry[]): Promise<void> {
    let cursor = 0;
    async function worker(): Promise<void> {
      for (;;) {
        const index = cursor;
        cursor += 1;
        if (index >= entries.length) return;
        await fetchOneFile(entries[index]!);
      }
    }
    const workerCount = Math.min(DIRECTORY_DOWNLOAD_CONCURRENCY, entries.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
  }

  async function walk(dirPath: string, depth: number): Promise<void> {
    if (depth > MAX_DIRECTORY_DEPTH) {
      throw new ImportSkillFromUrlError("IMPORT_CONTENT_INVALID");
    }
    const apiUrl = `https://api.github.com/repos/${root.owner}/${root.repo}/contents/${dirPath
      .split("/")
      .map(encodeURIComponent)
      .join("/")}?ref=${encodeURIComponent(root.branch)}`;
    const listing = await fetchFn(apiUrl, policy);
    let entries: unknown;
    try {
      entries = JSON.parse(listing.body.toString("utf8"));
    } catch {
      throw new ImportSkillFromUrlError("IMPORT_CONTENT_INVALID");
    }
    if (!Array.isArray(entries)) {
      // GitHub 对单文件路径也返回 200，但 body 是一个对象而不是数组——
      // 这里只接受「这是一个目录」的形状，不静默降级成单文件导入。
      throw new ImportSkillFromUrlError("IMPORT_CONTENT_INVALID");
    }

    const dirs: GithubContentEntry[] = [];
    const fileEntries: GithubContentEntry[] = [];
    for (const raw of entries as readonly GithubContentEntry[]) {
      if (raw.type === "dir") dirs.push(raw);
      else if (raw.type === "file") fileEntries.push(raw);
      // 其余类型（符号链接/submodule）两边都不进，在 `fetchOneFile`/这里静默跳过。
    }

    // 上限判在下载之前——与此前逐个判的效果一致（超限必拒），但现在是对这一层
    // 整批一次判完，不给并发下载一个「先跑起来再半路撞上限」的窗口。
    if (files.length + fileEntries.length > MAX_DIRECTORY_FILES) {
      throw new ImportSkillFromUrlError("IMPORT_CONTENT_INVALID");
    }
    await downloadFilesBounded(fileEntries);

    // 子目录仍然顺序递归——目录数量远小于文件数量，真正拖时长的是文件下载
    // （见 `DIRECTORY_DOWNLOAD_CONCURRENCY` 头注），这里不值得再上并发的复杂度。
    for (const dir of dirs) {
      if (files.length >= MAX_DIRECTORY_FILES) {
        throw new ImportSkillFromUrlError("IMPORT_CONTENT_INVALID");
      }
      await walk(dir.path, depth + 1);
    }
  }

  await walk(root.dirPath, 0);

  // 与 `wave2_skill_starter_import` 迁移里 `wave2_publish_skill_version` 校验的同一条
  // 不变量对齐（「目录里必须恰好有一个根 SKILL.md」）——这里提前判、给出可行动的错误码，
  // 而不是让请求走到发布函数那一步才因为一个 DB 触发器报错折成裸 500。
  if (!files.some((f) => f.path === "SKILL.md")) {
    throw new ImportSkillFromUrlError("IMPORT_CONTENT_INVALID");
  }
  return files;
}

/** 多文件目录导入的整体内容摘要——与 `pg-asset-file-repository.ts` 的 manifest digest 同一构造。 */
function manifestDigestOf(files: readonly { readonly path: string; readonly digest: string }[]): string {
  return sha256(
    [...files]
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
      .map((f) => `${f.path}\0${f.digest}`)
      .join("\n"),
  );
}

export async function importSkillFromUrl(
  input: ImportSkillFromUrlInput,
  deps: ImportSkillFromUrlDeps,
): Promise<ImportSkillFromUrlResult> {
  /**
   * ⚠⚠ **授权门，必须是这条用例做的第一件事。**
   *
   * 与 `import-skill-starter-pack.ts:38-39` 逐字对齐（`orgRole === "admin"`）：
   * 两条导入路径**通向同一批表**（`skills`/`skill_versions`/`skill_version_files`），
   * 门槛不同就等于在同一扇门旁边开了条矮的。
   *
   * ⚠ 放在**取回之前**：否则一个非 admin 也能让服务端替他发出站请求，
   *   那本身就是可被利用的能力（SSRF 探测器），即使最终不落库。
   *
   * ⚠ 这条门是 `lint-permission-paths` 对本链路仓储的正当性依据。
   *   ⛔ 删掉它 ⇒ 那个门控**应当重新变红**，不要去白名单里补一条。
   */
  const membership = await deps.identities.findOrgMembership(input.actorId, toOrgId(input.orgId));
  if (!membership || membership.orgRole !== "admin") {
    throw new ImportSkillFromUrlError("IMPORT_NOT_ORG_ADMIN");
  }

  const replay = await deps.repository.findByIdempotencyKey({
    orgId: input.orgId,
    idempotencyKey: input.idempotencyKey,
  });
  if (replay !== null) return { ...replay, replayed: true };

  /**
   * ⚠ 这里**故意没有 try/catch**。取回层的拒绝（SSRF / 协议 / 体积 / 本地组织）
   *   必须原样冒泡到调用方。吞掉它 = 两道门形同虚设。
   */
  const githubTree = parseGithubTreeUrl(input.sourceUrl);

  const { sourceUrl, files, contentDigest } = githubTree !== null
    ? await (async () => {
        // 目录导入：整个子目录就是要发布的 skill 目录结构（同 `filePathFor` 单文件分支
        // 「路径按取回后最终落地的 URL 算」的精神——这里「最终落地」是整个目录快照）。
        const dirFiles = await fetchGithubDirectoryFiles(githubTree, deps.fetch, deps.policy);
        return { sourceUrl: input.sourceUrl, files: dirFiles, contentDigest: manifestDigestOf(dirFiles) };
      })()
    : await (async () => {
        const fetched = await deps.fetch(input.sourceUrl, deps.policy);
        if (fetched.body.length === 0 || fetched.body.length > MAX_SINGLE_FILE_BYTES) {
          throw new ImportSkillFromUrlError("IMPORT_CONTENT_INVALID");
        }
        // 路径按**取回后最终落地的 URL**算——重定向可能换了文件名。
        const path = filePathFor(fetched.url);
        const digest = sha256(fetched.body);
        return {
          sourceUrl: fetched.url,
          files: [{ path, content: fetched.body, mediaType: fetched.mediaType, digest }],
          contentDigest: digest,
        };
      })();

  try {
    return await deps.repository.persist({
      orgId: input.orgId,
      actorId: input.actorId,
      idempotencyKey: input.idempotencyKey,
      name: input.name,
      sourceUrl,
      contentDigest,
      files,
    });
  } catch (error) {
    // G1（2026-08-14）：同组织已有同名 skill（不分大小写）。此前这条错误从
    // repository 一路裸奔到 controller，变成一个没有 reasonCode 的 500——
    // 见 `pg-skill-url-import-repository.ts` 文件头长注与 `ImportSkillFromUrlFailure`
    // 里早就声明、却从未被抛出过的 `IMPORT_NAME_CONFLICT`。
    if (error instanceof SkillNameConflictError) {
      throw new ImportSkillFromUrlError("IMPORT_NAME_CONFLICT");
    }
    throw error;
  }
}
