/**
 * #1865 —— `discoverSkillsFromUrl` 用例：给一个仓库/目录 URL，找出里面所有的 SKILL.md。
 *
 * ## fixture 服务器模拟的是什么
 *
 * 一个 loopback 上的 HTTPS 服务器，路由形状照抄真实 GitHub Contents API
 * （`GET /repos/:owner/:repo` 拿 `default_branch`；`GET /repos/:owner/:repo/contents/:path?ref=`
 * 拿目录列表；`download_url` 指向的地址拿文件内容），模拟一个"一个仓库多个 skill
 * 子目录"的真实形态（`pptx/`、`docx/` 各自有自己的 `SKILL.md`，外加一个不含
 * `SKILL.md` 的普通目录 `notes/`，以及 `pptx/` 下自己的 `scripts/` 子目录）。
 *
 * ## 为什么可以指向 `https://github.com:<port>/...`
 *
 * 用例把 GitHub API host 从调用方传入的 `sourceUrl` 派生（见
 * `discover-skills-from-url.ts` 文件头），不写死 `api.github.com`。测试证书的
 * SAN 里加了 `github.com`/`api.github.com`（`tests/support/tls/openssl.cnf`），
 * 配合 DNS 打桩（`loopbackFetcher`，与 `url-import-http-route.test.ts` 同一手法），
 * 一次真实的 TLS 握手 + HTTP 往返就能在本机完整跑通整条扫描逻辑。
 */
import https from "node:https";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  discoverSkillsFromUrl,
  DiscoverSkillsFromUrlError,
  type DiscoverSkillsFromUrlDeps,
} from "../../src/application/skill-import/discover-skills-from-url";
import { fetchImportSource, type ImportFetchSeams } from "../../src/infrastructure/skill/http-import-fetcher";
import type { ImportSourceFetcher } from "../../src/application/skill-import/import-skill-from-url";
import { ImportSourceRefusedError } from "../../src/domain/skill/import-source";
import { testTlsMaterial } from "../support/tls";

let server: https.Server;
let port = 0;
let savedCa: unknown;

const OWNER = "acme";
const REPO = "skills-fixture";
const BRANCH = "main";

const SKILL_MD_PPTX = `---
name: pptx-skill
description: "Create and edit PowerPoint decks"
---

# pptx skill

Body content, not parsed.
`;

const SKILL_MD_DOCX = `---
name: docx-skill
description: Create and edit Word documents
---

# docx skill
`;

/** 没有 frontmatter 的 `SKILL.md`——name 必须退化成目录名，description 退化成空串。 */
const SKILL_MD_NO_FRONTMATTER = `# xlsx skill\n\nplain body, no --- fences.\n`;

type RawEntry = { type: "file" | "dir"; name: string; path: string };

/**
 * ⚠ 这里**不**预先烤入 `download_url`（那正是本文件第一版的坑：`port` 在
 *   `beforeAll` 里服务器真正监听之后才有值，任何在模块加载时就求值一次的
 *   字符串都会把 `port=0` 焊死进去）。`download_url` 改在**请求处理器里**
 *   现算——那时服务器早就在监听了，`port` 已经是真实值。
 */
const LISTINGS: Record<string, RawEntry[]> = {
  "": [
    { type: "dir", name: "pptx", path: "pptx" },
    { type: "dir", name: "docx", path: "docx" },
    { type: "dir", name: "xlsx", path: "xlsx" },
    { type: "dir", name: "notes", path: "notes" },
    { type: "file", name: "README.md", path: "README.md" },
  ],
  pptx: [
    { type: "file", name: "SKILL.md", path: "pptx/SKILL.md" },
    { type: "dir", name: "scripts", path: "pptx/scripts" },
  ],
  "pptx/scripts": [{ type: "file", name: "run.py", path: "pptx/scripts/run.py" }],
  docx: [{ type: "file", name: "SKILL.md", path: "docx/SKILL.md" }],
  xlsx: [{ type: "file", name: "SKILL.md", path: "xlsx/SKILL.md" }],
  notes: [{ type: "file", name: "todo.txt", path: "notes/todo.txt" }],
};

const RAW_FILES: Record<string, string> = {
  "pptx/SKILL.md": SKILL_MD_PPTX,
  "pptx/scripts/run.py": "# a script\n",
  "docx/SKILL.md": SKILL_MD_DOCX,
  "xlsx/SKILL.md": SKILL_MD_NO_FRONTMATTER,
  "notes/todo.txt": "buy milk\n",
  "README.md": "# fixture repo\n",
};

beforeAll(async () => {
  const { cert, key } = testTlsMaterial();
  server = https.createServer({ key, cert }, (req, res) => {
    const url = new URL(req.url ?? "/", "https://placeholder/");
    const path = url.pathname;

    if (path === `/repos/${OWNER}/${REPO}`) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ default_branch: BRANCH }));
      return;
    }
    // #1865 SSRF 反证 fixture：这个仓库的根目录列表**重定向**到一个字面量被拒
    // 地址，用来证明「取回层的两道 SSRF 门在扫描这条路径上真的在跑」，而不是
    // 只测「host 不是 github.com 就拒」（那条只是本用例自己的输入形状校验，
    // 不经过 `deps.fetch`，盖不住「真的连了一次才被拒」这件事）。
    if (path === `/repos/${OWNER}/redirect-repo/contents`) {
      res.writeHead(302, { location: `https://127.0.0.1:${port}/never` });
      res.end();
      return;
    }
    const contentsPrefix = `/repos/${OWNER}/${REPO}/contents`;
    if (path === contentsPrefix || path.startsWith(`${contentsPrefix}/`)) {
      const dirPath = path === contentsPrefix ? "" : decodeURIComponent(path.slice(contentsPrefix.length + 1));
      const listing = LISTINGS[dirPath];
      if (listing === undefined) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ message: "Not Found" }));
        return;
      }
      const withUrls = listing.map((entry) => ({
        ...entry,
        download_url: entry.type === "file" ? `https://github.com:${port}/raw/${entry.path}` : null,
      }));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(withUrls));
      return;
    }
    if (path.startsWith("/raw/")) {
      const key = decodeURIComponent(path.slice("/raw/".length));
      const body = RAW_FILES[key];
      if (body === undefined) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      res.writeHead(200, { "content-type": "text/markdown" });
      res.end(body);
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
  savedCa = https.globalAgent.options.ca;
  https.globalAgent.options.ca = [cert];
}, 60_000);

afterAll(async () => {
  https.globalAgent.options.ca = savedCa as never;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** DNS 打桩：任意主机名一律解到 loopback——与 `url-import-http-route.test.ts` 同一手法。 */
function loopbackFetcher(): ImportSourceFetcher {
  const lookup = ((_h: string, o: { all?: boolean } | undefined, cb: Function): void =>
    o?.all === true ? cb(null, [{ address: "127.0.0.1", family: 4 }]) : cb(null, "127.0.0.1", 4)) as
    unknown as ImportFetchSeams["lookup"];
  return (rawUrl, policy) => fetchImportSource(rawUrl, policy, { lookup, checkAddress: () => {} });
}

function depsFor(orgRole: string | null): DiscoverSkillsFromUrlDeps {
  return {
    identities: {
      findOrgMembership: async () => (orgRole === null ? null : { orgRole }),
    } as never,
    fetch: loopbackFetcher(),
    policy: { localOnlyOrg: false },
  };
}

/**
 * ⚠ 函数，不是常量：`port` 直到 `beforeAll` 里 fixture 服务器真正监听后才有值。
 *   写成模块顶层常量会在导入这个文件的那一刻就把 `port=0` 烤进字符串——
 *   这正是本文件第一版踩到的坑（连到了真实公网 `:443` 而不是 fixture）。
 */
const rootUrl = () => `https://github.com:${port}/${OWNER}/${REPO}/tree/${BRANCH}`;
const repoRootNoBranchUrl = () => `https://github.com:${port}/${OWNER}/${REPO}`;

describe("扫描一个多 skill 仓库", () => {
  it("找出所有直接含 SKILL.md 的子目录，not.notes（不含 SKILL.md 的目录被跳过）", async () => {
    const result = await discoverSkillsFromUrl(
      { orgId: "org-1865", actorId: "u-1865-admin", sourceUrl: rootUrl() },
      depsFor("admin"),
    );

    const byDir = new Map(result.skills.map((s) => [s.dirPath, s]));
    expect([...byDir.keys()].sort()).toEqual(["docx", "pptx", "xlsx"]);

    const pptx = byDir.get("pptx")!;
    expect(pptx.name).toBe("pptx-skill");
    expect(pptx.description).toBe("Create and edit PowerPoint decks");
    expect(pptx.fileCount).toBe(2); // SKILL.md + scripts/run.py
    // ⚠ treeUrl 必须是**真实公网** github.com（不带测试端口）——它要能原样喂给
    //   既有 importSkillFromUrl，那条端点认的就是真实 GitHub 地址。
    expect(pptx.treeUrl).toBe(`https://github.com/${OWNER}/${REPO}/tree/${BRANCH}/pptx`);

    const docx = byDir.get("docx")!;
    expect(docx.name).toBe("docx-skill");
    expect(docx.fileCount).toBe(1);

    // 没有 frontmatter 的 SKILL.md：name 退化成目录名，description 退化成空串。
    const xlsx = byDir.get("xlsx")!;
    expect(xlsx.name).toBe("xlsx");
    expect(xlsx.description).toBe("");
  });

  it("仓库根 URL（不带分支）能先问出 default_branch 再扫描，结果与显式分支一致", async () => {
    const result = await discoverSkillsFromUrl(
      { orgId: "org-1865", actorId: "u-1865-admin", sourceUrl: repoRootNoBranchUrl() },
      depsFor("admin"),
    );
    expect(result.skills.map((s) => s.dirPath).sort()).toEqual(["docx", "pptx", "xlsx"]);
  });

  it("直接把某个 skill 子目录当起点：不误报兄弟目录，也不把起点自己算成候选", async () => {
    // pptx 自己没有 SKILL.md 之外的子目录含 SKILL.md（scripts/ 没有）——起点本身
    // 不算候选（见用例文件头：起点是不是恰好一个 skill 目录，由既有单目录导入负责），
    // ⇒ 一个都没找到，落到与"整个仓库没有 skill"同一条 `IMPORT_NO_SKILLS_FOUND`。
    await expect(
      discoverSkillsFromUrl(
        {
          orgId: "org-1865",
          actorId: "u-1865-admin",
          sourceUrl: `https://github.com:${port}/${OWNER}/${REPO}/tree/${BRANCH}/pptx`,
        },
        depsFor("admin"),
      ),
    ).rejects.toMatchObject({ code: "IMPORT_NO_SKILLS_FOUND" });
  });
});

describe("扫描不到任何 skill", () => {
  it("整个子目录都没有 SKILL.md ⇒ IMPORT_NO_SKILLS_FOUND", async () => {
    await expect(
      discoverSkillsFromUrl(
        {
          orgId: "org-1865",
          actorId: "u-1865-admin",
          sourceUrl: `https://github.com:${port}/${OWNER}/${REPO}/tree/${BRANCH}/notes`,
        },
        depsFor("admin"),
      ),
    ).rejects.toMatchObject({ code: "IMPORT_NO_SKILLS_FOUND" });
  });
});

describe("授权：非 admin 被拒，且在取回之前", () => {
  it("consultant 提交任意地址 ⇒ IMPORT_NOT_ORG_ADMIN，不触碰网络", async () => {
    let fetchCalled = false;
    const deps: DiscoverSkillsFromUrlDeps = {
      identities: { findOrgMembership: async () => ({ orgRole: "consultant" }) } as never,
      fetch: async (...args) => {
        fetchCalled = true;
        return loopbackFetcher()(...args);
      },
      policy: { localOnlyOrg: false },
    };
    await expect(
      discoverSkillsFromUrl({ orgId: "org-1865", actorId: "u-1865-member", sourceUrl: rootUrl() }, deps),
    ).rejects.toMatchObject({ code: "IMPORT_NOT_ORG_ADMIN" });
    expect(fetchCalled).toBe(false);
  });
});

describe("SSRF 门在扫描这条路径上仍然生效（⚠ 证明真的连了一次才被拒，不是输入形状校验）", () => {
  it("目录列表重定向到 loopback 字面量地址 ⇒ 取回层的拒绝原样冒泡，不被扫描逻辑吞掉", async () => {
    const failure = await discoverSkillsFromUrl(
      {
        orgId: "org-1865",
        actorId: "u-1865-admin",
        sourceUrl: `https://github.com:${port}/${OWNER}/redirect-repo/tree/${BRANCH}`,
      },
      depsFor("admin"),
    ).catch((e: unknown) => e);
    // ⚠ 两条断言都要：是取回层自己的错误类型（不是本用例包装过的 `DiscoverSkillsFromUrlError`），
    //   且码是 SSRF 门给的那个——一个把它 catch 住又原样 throw error 的实现两条都过，
    //   而一个悄悄 catch 住却吞掉/换成别的错误类型的实现，第一条就会先红。
    expect(failure).toBeInstanceOf(ImportSourceRefusedError);
    expect((failure as { code: string }).code).toBe("IMPORT_URL_HOST_NOT_PUBLIC");
  });
});

describe("不是一个能理解的仓库/目录形状", () => {
  it("非 github.com host ⇒ IMPORT_CONTENT_INVALID", async () => {
    await expect(
      discoverSkillsFromUrl(
        { orgId: "org-1865", actorId: "u-1865-admin", sourceUrl: "https://example.com/owner/repo" },
        depsFor("admin"),
      ),
    ).rejects.toMatchObject({ code: "IMPORT_CONTENT_INVALID" });
  });

  it("装置自检：DiscoverSkillsFromUrlError 携带的码真的是传入的那个", () => {
    const err = new DiscoverSkillsFromUrlError("IMPORT_NO_SKILLS_FOUND");
    expect(err.code).toBe("IMPORT_NO_SKILLS_FOUND");
    expect(err).toBeInstanceOf(Error);
  });
});
