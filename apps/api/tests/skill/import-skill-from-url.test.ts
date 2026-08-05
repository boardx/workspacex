/**
 * #595 段 2 —— 用例接上取回层之后，**整条链**是不是真的被保护了。
 *
 * ## 这个文件和段 1 那两个的分工
 *
 * · `import-source-guard.test.ts` —— 那个**函数**正确；
 * · `import-fetch-wiring.test.ts` —— 那道门在**取回层**上被调用；
 * · 本文件 —— **用例真的走取回层**，且**拒绝会一路冒泡到调用方**。
 *
 * ⚠ 第三层不是多余的。用例里一个 `try { fetch } catch { 继续 }` 会让两道门、
 *   六条反证、27 个断言**全部失效**，而上面两个文件**一个都不会红**。
 *   这正是段 1 反证④证过的形状：绿覆盖到哪为止，必须自己说清楚。
 *
 * ## 用的是**真的**取回层，不是替身
 *
 * `deps.fetch` 绑的是生产的 `fetchImportSource`，只把 DNS 换成 stub
 * （否则要连真实网络）。⇒ 两道门、重定向逐跳过门、体积上限全部在这条链上生效。
 * ⚠ 若这里塞一个「永远成功」的假取回器，本文件就退化成只测持久化——
 *   那正是「测了个替身」的经典失败。
 *
 * ## 契约面是草案
 *
 * 输入/输出/错误码来自 `url-import-draft.ts`，**尚未经人类签核**（ADR-023，
 * 草案登记在 #595 评论）。本文件断言的是**行为**，字段名跟着草案走。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import https from "node:https";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { ImportSourceRefusedError, assertResolvedAddressAllowed } from "../../src/domain/skill/import-source";
import { fetchImportSource, type ImportFetchSeams } from "../../src/infrastructure/skill/http-import-fetcher";
import { importSkillFromUrl } from "../../src/application/skill-import/import-skill-from-url";
import type {
  ImportSourceFetcher,
  SkillUrlImportRepository,
} from "../../src/application/skill-import/import-skill-from-url";
import { ImportSkillFromUrlError } from "../../src/application/skill-import/url-import-draft";
import type { ImportSkillFromUrlResult } from "../../src/application/skill-import/url-import-draft";

const OPEN = { localOnlyOrg: false };

/** 记录落库调用——「被拒」必须意味着**一行都没写**。 */
class RecordingRepository implements SkillUrlImportRepository {
  readonly persisted: Parameters<SkillUrlImportRepository["persist"]>[0][] = [];
  async findByIdempotencyKey(): Promise<ImportSkillFromUrlResult | null> {
    return null;
  }
  async persist(
    input: Parameters<SkillUrlImportRepository["persist"]>[0],
  ): Promise<ImportSkillFromUrlResult> {
    this.persisted.push(input);
    return {
      skillId: "sk_1",
      versionId: "sv_1",
      filePaths: input.files.map((f) => f.path),
      contentDigest: input.contentDigest,
      replayed: false,
    };
  }
}

function resolveTo(address: string): ImportFetchSeams["lookup"] {
  const fn = (_h: string, o: { all?: boolean } | undefined, cb: Function): void =>
    o?.all === true ? cb(null, [{ address, family: 4 }]) : cb(null, address, 4);
  return fn as unknown as ImportFetchSeams["lookup"];
}

/** 生产取回层 + 只换 DNS。⚠ 地址判定用**生产默认** `assertResolvedAddressAllowed`。 */
function realFetcherResolvingTo(address: string, allowLoopback = false): ImportSourceFetcher {
  return (rawUrl, policy) =>
    fetchImportSource(rawUrl, policy, {
      lookup: resolveTo(address),
      checkAddress: allowLoopback ? () => {} : assertResolvedAddressAllowed,
    });
}

let server: https.Server;
let port = 0;
let handler: (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void;
let savedCa: unknown;

beforeAll(async () => {
  const dir = new URL("../support/tls/", import.meta.url);
  const cert = readFileSync(new URL("test-only.cert.pem", dir));
  const key = readFileSync(new URL("test-only.key.pem", dir));
  server = https.createServer({ key, cert }, (req, res) => handler(req, res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
  savedCa = https.globalAgent.options.ca;
  https.globalAgent.options.ca = [cert];
});
afterAll(async () => {
  https.globalAgent.options.ca = savedCa as never;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const baseInput = {
  orgId: "org_1",
  actorId: "user_1",
  name: "my-skill",
  idempotencyKey: "key-1",
  sourceUrl: "",
};

describe("用例确实走取回层：拒绝一路冒泡，且一行都不落库", () => {
  /**
   * 核心断言。⚠ 这条会红的唯一方式，就是用例吞掉了取回层的拒绝——
   * 而那时段 1 的两个测试文件**一个都不会红**。
   */
  it("SSRF：域名解析到云元数据 ⇒ 用例抛出，且 repository.persist 从未被调用", async () => {
    const repository = new RecordingRepository();
    let thrown: unknown;
    try {
      await importSkillFromUrl(
        { ...baseInput, sourceUrl: "https://metadata.example/SKILL.md" },
        { fetch: realFetcherResolvingTo("169.254.169.254"), repository, policy: OPEN },
      );
    } catch (error) {
      thrown = error;
    }
    const code =
      thrown instanceof ImportSourceRefusedError
        ? thrown.code
        : ((thrown as { cause?: unknown })?.cause as ImportSourceRefusedError | undefined)?.code;
    expect(code).toBe("IMPORT_URL_HOST_NOT_PUBLIC");
    expect(repository.persisted).toHaveLength(0); // ⚠ 一行都没写
  });

  it("personal-local 组织 ⇒ 用例抛出，且不落库", async () => {
    const repository = new RecordingRepository();
    await expect(
      importSkillFromUrl(
        { ...baseInput, sourceUrl: "https://example.com/SKILL.md" },
        {
          fetch: realFetcherResolvingTo("1.1.1.1"),
          repository,
          policy: { localOnlyOrg: true },
        },
      ),
    ).rejects.toBeInstanceOf(ImportSourceRefusedError);
    expect(repository.persisted).toHaveLength(0);
  });

  it("http:// ⇒ 被第一道门拒，不落库", async () => {
    const repository = new RecordingRepository();
    await expect(
      importSkillFromUrl(
        { ...baseInput, sourceUrl: "http://example.com/SKILL.md" },
        { fetch: realFetcherResolvingTo("1.1.1.1"), repository, policy: OPEN },
      ),
    ).rejects.toBeInstanceOf(ImportSourceRefusedError);
    expect(repository.persisted).toHaveLength(0);
  });
});

describe("正样本：门放行时，导入真的完成", () => {
  it("取回 → 落库，路径与摘要都对（证明不是恒拒）", async () => {
    handler = (_req, res) => {
      res.writeHead(200, { "content-type": "text/markdown" });
      res.end("# my skill\n");
    };
    const repository = new RecordingRepository();
    const result = await importSkillFromUrl(
      { ...baseInput, sourceUrl: `https://allowed.example:${port}/SKILL.md` },
      { fetch: realFetcherResolvingTo("127.0.0.1", true), repository, policy: OPEN },
    );
    expect(repository.persisted).toHaveLength(1);
    expect(result.filePaths).toEqual(["SKILL.md"]);
    expect(repository.persisted[0]!.files[0]!.content.toString()).toBe("# my skill\n");
    expect(result.contentDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  /**
   * URL 里塞路径穿越。⚠ 判定复用 `normalizedPath`，不另起一套。
   * 注意 `%2e%2e%2f` 会被 `decodeURIComponent` 还原成 `../`——
   * 只看原始字符串的实现会放行。
   */
  it("URL 末段是编码过的穿越 ⇒ IMPORT_CONTENT_INVALID，不落库", async () => {
    handler = (_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("x");
    };
    const repository = new RecordingRepository();
    await expect(
      importSkillFromUrl(
        { ...baseInput, sourceUrl: `https://allowed.example:${port}/%2e%2e%2fetc%2fpasswd` },
        { fetch: realFetcherResolvingTo("127.0.0.1", true), repository, policy: OPEN },
      ),
    ).rejects.toBeInstanceOf(ImportSkillFromUrlError);
    expect(repository.persisted).toHaveLength(0);
  });

  it("空响应体 ⇒ IMPORT_CONTENT_INVALID，不落库", async () => {
    handler = (_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("");
    };
    const repository = new RecordingRepository();
    await expect(
      importSkillFromUrl(
        { ...baseInput, sourceUrl: `https://allowed.example:${port}/SKILL.md` },
        { fetch: realFetcherResolvingTo("127.0.0.1", true), repository, policy: OPEN },
      ),
    ).rejects.toBeInstanceOf(ImportSkillFromUrlError);
    expect(repository.persisted).toHaveLength(0);
  });

  it("幂等键命中 ⇒ 回放，且不再取回也不再落库", async () => {
    const repository = new RecordingRepository();
    let fetched = false;
    const result = await importSkillFromUrl(
      { ...baseInput, sourceUrl: `https://allowed.example:${port}/SKILL.md` },
      {
        fetch: (async (...args) => {
          fetched = true;
          return realFetcherResolvingTo("127.0.0.1", true)(...args);
        }) as ImportSourceFetcher,
        repository: Object.assign(repository, {
          findByIdempotencyKey: async () => ({
            skillId: "sk_prev",
            versionId: "sv_prev",
            filePaths: ["SKILL.md"],
            contentDigest: "a".repeat(64),
            replayed: false,
          }),
        }),
        policy: OPEN,
      },
    );
    expect(result.replayed).toBe(true);
    expect(result.skillId).toBe("sk_prev");
    expect(fetched).toBe(false); // 回放不该再打网络
    expect(repository.persisted).toHaveLength(0);
  });
});
