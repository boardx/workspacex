/**
 * #1865 —— "给一个仓库/目录 URL，找出里面所有的 SKILL.md"。
 *
 * ## 这条用例的边界：只读，不落库
 *
 * 真正的持久化仍然只有一条路径——`import-skill-from-url.ts` 的
 * `importSkillFromUrl`（落 `skills`/`skill_versions`/`skill_version_files` +
 * `capability_listings`）。本文件产出的每个候选都带一个 `treeUrl`，前端拿它
 * 当 `sourceUrl` 再打一次既有端点，⇒ 落库、幂等 key、名字冲突、发布触发器
 * （`wave2_publish_skill_version`）等既有纪律**全部原样复用**，不重新发明。
 *
 * ## SSRF 门与单文件/单目录导入是同一套
 *
 * 每一次 HTTP 调用（仓库元信息 / 目录列表 / `SKILL.md` 内容）都走
 * `deps.fetch`——与 `import-skill-from-url.ts` 的 `fetchGithubDirectoryFiles`
 * 同一条纪律：两道 SSRF 门都在取回层里，本文件不另开一条不经过校验的取回路径，
 * 也不吞取回层的拒绝（`ImportSourceRefusedError` 原样冒泡）。
 *
 * ## GitHub API host 从 `sourceUrl` 自己的 host 派生，不写死 `api.github.com`
 *
 * 写死会让这条用例只能连真实网络才能测——`fetchGithubDirectoryFiles`（目录单文件
 * 导入，#595 G1）就是这样，落地以来只有手工真栈 e2e 验证过，仓库里一个自动化
 * 测试都没有。本文件的 host 派生自调用方传入的 `sourceUrl`（正常情况下就是
 * `github.com` ⇒ 派生出 `api.github.com`，与生产行为一致），测试时可以把
 * `sourceUrl` 换成一个带自定义端口的 `github.com:<port>` fixture 地址，
 * 派生出的 API host 自动带上同一个端口，指向本地 loopback 的 fixture 服务器。
 */
import { toOrgId } from "../../domain/org-id";
import type { IdentityRepository } from "../identity/ports";
import type { ImportUrlPolicy } from "../../domain/skill/import-source";
import type { ImportSourceFetcher } from "./import-skill-from-url";
import { wave2Runtime as C } from "@repo/contracts";
import type { z } from "zod";

export type DiscoverSkillsFromUrlInput = z.infer<typeof C.operations.discoverSkillsFromUrl.in> & {
  readonly orgId: string;
  readonly actorId: string;
};

export type DiscoverSkillsFromUrlResult = z.infer<typeof C.operations.discoverSkillsFromUrl.out>;

export type DiscoverSkillsFromUrlFailure = Extract<
  z.infer<typeof C.SkillDiscoveryError>,
  "IMPORT_NOT_ORG_ADMIN" | "IMPORT_CONTENT_INVALID" | "IMPORT_NO_SKILLS_FOUND" | "IMPORT_TOO_MANY_SKILLS_FOUND"
>;

export class DiscoverSkillsFromUrlError extends Error {
  constructor(readonly code: DiscoverSkillsFromUrlFailure) {
    super(`discover skills from url failed: ${code}`);
    this.name = "DiscoverSkillsFromUrlError";
  }
}

export interface DiscoverSkillsFromUrlDeps {
  readonly identities: IdentityRepository;
  readonly fetch: ImportSourceFetcher;
  readonly policy: ImportUrlPolicy;
}

export interface DiscoverSkillsFromUrlDepsFactory {
  (input: { readonly localOnlyOrg: boolean }): DiscoverSkillsFromUrlDeps;
}

export const DISCOVER_SKILLS_FROM_URL_DEPS_FACTORY = Symbol("DiscoverSkillsFromUrlDepsFactory");

/**
 * 扫描的保守上限：找的是仓库里的几个 skill 目录，不是整个大型仓库。
 *
 * ⚠ `MAX_DISCOVERY_API_CALLS` 实测（真栈，`anthropics/skills` 仓库 `skills/` 目录，
 *   19 个真实 skill）需要 ~110 次 Contents API 调用才能扫完（目录发现 + 每个候选
 *   一层 `approximateFileCount` 探测），80 那档在这个完全合法的真实仓库上会先
 *   触发这条上限——所以量级定在能覆盖这一真实案例，而不是拍脑袋的数字。
 */
const MAX_DISCOVERY_API_CALLS = 160;
const MAX_DISCOVERY_SKILLS = 30;
const MAX_DISCOVERY_DEPTH = 4;

interface GithubContentEntry {
  readonly type: string;
  readonly name: string;
  readonly path: string;
  readonly download_url: string | null;
}

interface ParsedRepoUrl {
  readonly apiBase: string;
  readonly owner: string;
  readonly repo: string;
  /** null = URL 没指定分支，需要问 API 要 default_branch。 */
  readonly branch: string | null;
  /** 仓库内起始扫描目录，空串代表仓库根。 */
  readonly dirPath: string;
}

/**
 * 解析调用方传入的仓库/目录 URL。接受三种形态：
 *   · `https://github.com/<owner>/<repo>`                        —— 仓库根，用默认分支
 *   · `https://github.com/<owner>/<repo>/tree/<branch>`          —— 仓库根，指定分支
 *   · `https://github.com/<owner>/<repo>/tree/<branch>/<path>`   —— 子目录，指定分支
 *
 * ⚠ host 不写死 `github.com` 字符串比较之外的任何东西——`new URL().hostname` 已经
 *   替我们剥掉了端口，测试用的 `github.com:<port>` fixture 地址一样能过。
 */
function parseRepoSourceUrl(raw: string): ParsedRepoUrl | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== "github.com") return null;

  const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const [owner, repoRaw, maybeTree, branch, ...rest] = segments;
  if (owner === undefined || repoRaw === undefined) return null;
  const repo = repoRaw.replace(/\.git$/, "");
  const apiBase = `${url.protocol}//api.${url.hostname}${url.port ? `:${url.port}` : ""}`;

  if (maybeTree === undefined) return { apiBase, owner, repo, branch: null, dirPath: "" };
  if (maybeTree !== "tree" || branch === undefined) return null;
  return { apiBase, owner, repo, branch, dirPath: rest.join("/") };
}

/**
 * `SKILL.md` 的 YAML frontmatter 里抠 `name`/`description`。
 *
 * ⚠ 只解析这两个平铺的字符串字段，不是一个通用 YAML 解析器——`SKILL.md` 的
 *   frontmatter 事实标准就是这两行，仓库里没有别的地方需要更多。解析失败时
 *   两个字段都缺省（调用方用目录名兜底 `name`，`description` 落空字符串），
 *   不因为一个格式古怪的 `SKILL.md` 让整次扫描失败——那会让"仓库里其它正常的
 *   skill 也发现不了"，比"这一个 skill 的描述是空的"糟得多。
 */
function parseSkillFrontmatter(text: string): { name?: string; description?: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (match === null) return {};
  const body = match[1] ?? "";
  const result: { name?: string; description?: string } = {};
  for (const line of body.split(/\r?\n/)) {
    const kv = /^(name|description):\s*(.*)$/.exec(line.trim());
    if (kv === null) continue;
    const key = kv[1] as "name" | "description";
    let value = (kv[2] ?? "").trim();
    if (value.length >= 2) {
      const quoted =
        (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
      if (quoted) value = value.slice(1, -1);
    }
    if (value !== "") result[key] = value;
  }
  return result;
}

export async function discoverSkillsFromUrl(
  input: DiscoverSkillsFromUrlInput,
  deps: DiscoverSkillsFromUrlDeps,
): Promise<DiscoverSkillsFromUrlResult> {
  /**
   * ⚠⚠ 授权门，必须是第一件事——与 `importSkillFromUrl` 逐字同一条纪律
   *   （放在任何 `deps.fetch` 之前，否则非 admin 也能让服务端替他发出站请求）。
   */
  const membership = await deps.identities.findOrgMembership(input.actorId, toOrgId(input.orgId));
  if (!membership || membership.orgRole !== "admin") {
    throw new DiscoverSkillsFromUrlError("IMPORT_NOT_ORG_ADMIN");
  }

  const parsed = parseRepoSourceUrl(input.sourceUrl);
  if (parsed === null) throw new DiscoverSkillsFromUrlError("IMPORT_CONTENT_INVALID");
  const { apiBase, owner, repo, dirPath } = parsed;

  let apiCalls = 0;
  async function callApi(url: string): Promise<unknown> {
    apiCalls += 1;
    if (apiCalls > MAX_DISCOVERY_API_CALLS) {
      throw new DiscoverSkillsFromUrlError("IMPORT_TOO_MANY_SKILLS_FOUND");
    }
    const fetched = await deps.fetch(url, deps.policy);
    try {
      return JSON.parse(fetched.body.toString("utf8"));
    } catch {
      throw new DiscoverSkillsFromUrlError("IMPORT_CONTENT_INVALID");
    }
  }

  const branch =
    parsed.branch ??
    (await (async () => {
      const meta = await callApi(`${apiBase}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
      const defaultBranch = (meta as { default_branch?: unknown } | null)?.default_branch;
      if (typeof defaultBranch !== "string" || defaultBranch === "") {
        throw new DiscoverSkillsFromUrlError("IMPORT_CONTENT_INVALID");
      }
      return defaultBranch;
    })());

  async function listDir(path: string): Promise<readonly GithubContentEntry[]> {
    const encodedPath = path
      .split("/")
      .filter(Boolean)
      .map(encodeURIComponent)
      .join("/");
    const url = `${apiBase}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents${
      encodedPath ? `/${encodedPath}` : ""
    }?ref=${encodeURIComponent(branch)}`;
    const entries = await callApi(url);
    if (!Array.isArray(entries)) throw new DiscoverSkillsFromUrlError("IMPORT_CONTENT_INVALID");
    return entries as readonly GithubContentEntry[];
  }

  /**
   * `fileCount` 是**近似值**，不是精确的递归总数——刻意的取舍。
   *
   * ⚠ 实测（真栈，`anthropics/skills` 仓库）：真实世界的 skill 目录会带一整棵
   *   资源子树（`eval-viewer/` 之类打包好的静态资源，几十上百个文件），一个
   *   "递归数到底、数不完就整次扫描判失败" 的实现，在这种**完全合法**的仓库上
   *   必然触发失败——这不是恶意仓库，是普通的大型 skill。⇒ 数深会話「防炸弹」
   *   变成了「挡住真实用例」，比不精确更糟。
   *
   * ⇒ 只往下多探一层（`SKILL.md` 所在目录的直接子目录），子目录自己的文件计入
   *   总数，但**不再往更深处递归**——多数真实 skill（`scripts/`、`references/`
   *   这类一层子目录）能被这一层覆盖到，深于两层的资源树不再精确计数，
   *   只按"这一层看到了多少"计。这也把每个候选 skill 的额外 API 调用次数
   *   卡在"直接子目录个数"这个量级，不会因为某一个 skill 内部资源树深/大
   *   而拖垮整次扫描的请求预算（其余 skill 还等着被发现）。
   */
  async function approximateFileCount(topEntries: readonly GithubContentEntry[]): Promise<number> {
    let count = 0;
    for (const entry of topEntries) {
      if (entry.type === "file") {
        count += 1;
      } else if (entry.type === "dir") {
        const inner = await listDir(entry.path);
        count += inner.filter((e) => e.type === "file").length;
      }
    }
    return Math.max(count, 1);
  }

  const treeUrlFor = (path: string): string =>
    `https://github.com/${owner}/${repo}/tree/${branch}/${path}`;

  const skills: {
    dirPath: string;
    treeUrl: string;
    name: string;
    description: string;
    fileCount: number;
  }[] = [];

  /**
   * ⚠ 只在**子目录**里找 `SKILL.md`，从不把 `walk` 的起点本身当成候选——
   *   本用例的整个存在理由是"一个仓库/目录里有好几个 skill"；如果起点自己
   *   就是恰好一个 skill 目录，既有的单目录导入（`fetchGithubDirectoryFiles`）
   *   早就覆盖了这条路径，用户直接把那个目录 URL 交给 `importSkillFromUrl` 即可。
   */
  async function walk(path: string, depth: number): Promise<void> {
    const entries = await listDir(path);
    for (const dir of entries.filter((e) => e.type === "dir")) {
      const dirEntries = await listDir(dir.path);
      const skillMd = dirEntries.find((e) => e.type === "file" && e.name === "SKILL.md");
      if (skillMd !== undefined) {
        if (skillMd.download_url === null) continue;
        const fetched = await deps.fetch(skillMd.download_url, deps.policy);
        const meta = parseSkillFrontmatter(fetched.body.toString("utf8"));
        const fileCount = await approximateFileCount(dirEntries);
        skills.push({
          dirPath: dir.path,
          treeUrl: treeUrlFor(dir.path),
          name: meta.name ?? (dir.path.split("/").filter(Boolean).pop() ?? dir.path),
          description: meta.description ?? "",
          fileCount,
        });
        if (skills.length > MAX_DISCOVERY_SKILLS) {
          throw new DiscoverSkillsFromUrlError("IMPORT_TOO_MANY_SKILLS_FOUND");
        }
        continue; // 一个 skill 目录自己的子目录（scripts/、resources/…）不再继续找 SKILL.md
      }
      if (depth + 1 < MAX_DISCOVERY_DEPTH) await walk(dir.path, depth + 1);
    }
  }

  await walk(dirPath, 0);

  if (skills.length === 0) throw new DiscoverSkillsFromUrlError("IMPORT_NO_SKILLS_FOUND");

  return { skills };
}
