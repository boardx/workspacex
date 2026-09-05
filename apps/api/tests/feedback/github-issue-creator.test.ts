/**
 * FB-2 —— "转开发"建 GitHub issue 的适配器（`FetchGithubIssueCreator`）。
 *
 * ⚠ 全程 fake `fetch`,**不打真实网络**——同 `cloudflare-email-transport` 的既有测试纪律。
 *   断的不是"GitHub 真的建了一个 issue",是"我们发出去的请求形状是对的":
 *   URL、method、headers(含 Authorization / User-Agent)、body(含 labels)。
 */
import { describe, expect, it } from "vitest";
import {
  FetchGithubIssueCreator,
  githubIssueConfig,
} from "../../src/infrastructure/feedback/github-issue-creator";
import { GithubIssueApiError, GithubIssueCreationError } from "../../src/application/feedback/notification-ports";

function fakeConfig(over: Partial<ReturnType<typeof githubIssueConfig>> = {}) {
  return {
    token: "ghp_fake_token",
    owner: "boardx",
    repo: "workspacex",
    requestTimeoutMs: 5_000,
    attachmentsBranch: "feedback-attachments",
    ...over,
  };
}

function jsonResponse(body: unknown, status = 201): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("FetchGithubIssueCreator", () => {
  it("请求的 URL / method / headers / body 与 GitHub REST 契约完全一致（含 labels）", async () => {
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return jsonResponse({ html_url: "https://github.com/boardx/workspacex/issues/42", number: 42 });
    }) as typeof fetch;

    const creator = new FetchGithubIssueCreator(fakeConfig(), fakeFetch);
    const result = await creator.create({
      title: "点了没反应",
      body: "详细描述……\n\n---\n来源:后台「反馈与迭代」",
      labels: ["user-feedback", "bug"],
    });

    expect(capturedUrl).toBe("https://api.github.com/repos/boardx/workspacex/issues");
    expect(capturedInit?.method).toBe("POST");
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer ghp_fake_token");
    expect(headers["user-agent"]).toBeTruthy();
    expect(headers.accept).toContain("application/vnd.github");
    expect(JSON.parse(capturedInit?.body as string)).toEqual({
      title: "点了没反应",
      body: "详细描述……\n\n---\n来源:后台「反馈与迭代」",
      labels: ["user-feedback", "bug"],
    });
    expect(result).toEqual({ url: "https://github.com/boardx/workspacex/issues/42", number: 42 });
  });

  it("owner/repo 可配置,拼进 URL", async () => {
    let capturedUrl: string | undefined;
    const fakeFetch = (async (url: string) => {
      capturedUrl = url;
      return jsonResponse({ html_url: "https://github.com/acme/other-repo/issues/1", number: 1 });
    }) as typeof fetch;
    const creator = new FetchGithubIssueCreator(
      fakeConfig({ owner: "acme", repo: "other-repo" }),
      fakeFetch,
    );
    await creator.create({ title: "t", body: "b", labels: [] });
    expect(capturedUrl).toBe("https://api.github.com/repos/acme/other-repo/issues");
  });

  it("HTTP 非 2xx ⇒ 抛 GithubIssueCreationError,带上状态码", async () => {
    const fakeFetch = (async () => jsonResponse({ message: "Bad credentials" }, 401)) as typeof fetch;
    const creator = new FetchGithubIssueCreator(fakeConfig(), fakeFetch);
    const error = await creator.create({ title: "t", body: "b", labels: [] }).catch((e) => e as GithubIssueCreationError);
    expect(error).toBeInstanceOf(GithubIssueCreationError);
    expect((error as GithubIssueCreationError).status).toBe(401);
  });

  it("响应缺 html_url / number ⇒ 视为无效响应,抛错而不是回一个残缺的 issue", async () => {
    const fakeFetch = (async () => jsonResponse({})) as typeof fetch;
    const creator = new FetchGithubIssueCreator(fakeConfig(), fakeFetch);
    await expect(creator.create({ title: "t", body: "b", labels: [] })).rejects.toBeInstanceOf(
      GithubIssueCreationError,
    );
  });

  it("没有 token ⇒ 直接拒绝,不发请求", async () => {
    let called = false;
    const fakeFetch = (async () => {
      called = true;
      return jsonResponse({});
    }) as typeof fetch;
    const creator = new FetchGithubIssueCreator(fakeConfig({ token: "" }), fakeFetch);
    await expect(creator.create({ title: "t", body: "b", labels: [] })).rejects.toBeInstanceOf(
      GithubIssueCreationError,
    );
    expect(called).toBe(false);
  });

  describe("listComments(2026-09-05 收件箱评论区)", () => {
    it("GET /issues/:n/comments?per_page=100，把 GitHub 形状换成契约形状，脏条目跳过", async () => {
      let capturedUrl: string | undefined;
      let capturedInit: RequestInit | undefined;
      const fakeFetch = (async (url: string, init?: RequestInit) => {
        capturedUrl = url;
        capturedInit = init;
        return jsonResponse(
          [
            { id: 11, html_url: "https://github.com/boardx/workspacex/issues/9#issuecomment-11", body: "看到了", created_at: "2026-09-05T01:00:00Z", user: { login: "dev-a" } },
            { id: 12, html_url: "https://github.com/boardx/workspacex/issues/9#issuecomment-12", body: null, created_at: "2026-09-05T02:00:00Z", user: null },
            { html_url: "no id" },
          ],
          200,
        );
      }) as typeof fetch;
      const creator = new FetchGithubIssueCreator(fakeConfig(), fakeFetch);
      const out = await creator.listComments(9);
      expect(capturedUrl).toBe("https://api.github.com/repos/boardx/workspacex/issues/9/comments?per_page=100");
      expect(capturedInit?.method).toBe("GET");
      expect(out).toEqual([
        { id: 11, url: "https://github.com/boardx/workspacex/issues/9#issuecomment-11", author: "dev-a", body: "看到了", createdAt: "2026-09-05T01:00:00Z" },
        { id: 12, url: "https://github.com/boardx/workspacex/issues/9#issuecomment-12", author: null, body: "", createdAt: "2026-09-05T02:00:00Z" },
      ]);
    });

    it("非 2xx ⇒ GithubIssueApiError(listComments, status)", async () => {
      const fakeFetch = (async () => jsonResponse({ message: "rate limited" }, 403)) as typeof fetch;
      const creator = new FetchGithubIssueCreator(fakeConfig(), fakeFetch);
      const err = await creator.listComments(9).catch((e) => e as GithubIssueApiError);
      expect(err).toBeInstanceOf(GithubIssueApiError);
      expect((err as GithubIssueApiError).op).toBe("listComments");
      expect((err as GithubIssueApiError).status).toBe(403);
    });

    it("响应不是数组 ⇒ 视为无效响应抛错，不回一个空列表假装没评论", async () => {
      const fakeFetch = (async () => jsonResponse({ message: "weird" }, 200)) as typeof fetch;
      const creator = new FetchGithubIssueCreator(fakeConfig(), fakeFetch);
      await expect(creator.listComments(9)).rejects.toBeInstanceOf(GithubIssueApiError);
    });
  });

  describe("uploadImage(⑥ 反馈附件图片推给 GitHub，2026-09-03 人类两轮决策：真上传 + 不碰 main)", () => {
    /**
     * 统一的路由 fake——`uploadImage` 现在最多打四类端点(建孤儿分支的 `git/ref` /
     * `git/trees` / `git/commits` / `git/refs`，加上 `contents` 的探测/上传)，每条
     * 测试只需要覆盖跟自己相关的那部分状态码/响应体，其余用默认的"一切顺利"值。
     */
    function routedFetch(
      calls: Array<{ url: string; init?: RequestInit }>,
      over: Partial<{
        refStatus: number; refBody: unknown;
        /** `ensureAttachmentsBranch` 撞见 422 之后重新 `GET` 那个 ref 时的响应——
         *  与第一次探测(`refStatus`)分开配置,因为"分支起初不存在、后来建好了"
         *  这条路径必须让同一个端点前后两次返回不同状态。默认沿用 `refStatus`。 */
        refRecheckStatus: number;
        treeStatus: number; treeBody: unknown;
        commitStatus: number; commitBody: unknown;
        createRefStatus: number; createRefBody: unknown;
        contentGetStatus: number; contentGetBody: unknown; contentGetThrows: boolean;
        putStatus: number; putBody: unknown;
      }> = {},
    ): typeof fetch {
      const o = {
        refStatus: 200, refBody: {},
        refRecheckStatus: over.refStatus ?? 200,
        treeStatus: 201, treeBody: { sha: "tree-sha" },
        commitStatus: 201, commitBody: { sha: "commit-sha" },
        createRefStatus: 201, createRefBody: {},
        contentGetStatus: 404, contentGetBody: {}, contentGetThrows: false,
        putStatus: 201,
        putBody: { content: { download_url: "https://raw.githubusercontent.com/boardx/workspacex/feedback-attachments/feedback-attachments/fbattach-1.png" } },
        ...over,
      };
      let refCalls = 0;
      return (async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        const method = init?.method ?? "GET";
        if (url.includes("/git/ref/heads/")) {
          refCalls += 1;
          return refCalls === 1 ? jsonResponse(o.refBody, o.refStatus) : jsonResponse({}, o.refRecheckStatus);
        }
        if (url.includes("/git/trees")) return jsonResponse(o.treeBody, o.treeStatus);
        if (url.includes("/git/commits")) return jsonResponse(o.commitBody, o.commitStatus);
        if (url.includes("/git/refs")) return jsonResponse(o.createRefBody, o.createRefStatus);
        if (url.includes("/contents/") && method === "GET") {
          if (o.contentGetThrows) throw new Error("network down");
          return jsonResponse(o.contentGetBody, o.contentGetStatus);
        }
        if (url.includes("/contents/") && method === "PUT") return jsonResponse(o.putBody, o.putStatus);
        throw new Error(`routedFetch: unexpected request ${method} ${url}`);
      }) as typeof fetch;
    }

    const input = { path: "feedback-attachments/fbattach-1.png", content: new Uint8Array([1, 2, 3]), contentType: "image/png" as const };

    it("分支已存在 + 首次上传：不带 sha，body 带 branch，base64 编码字节，返回 download_url", async () => {
      const calls: Array<{ url: string; init?: RequestInit }> = [];
      const creator = new FetchGithubIssueCreator(fakeConfig(), routedFetch(calls));

      const result = await creator.uploadImage(input);

      expect(calls[0]!.url).toBe("https://api.github.com/repos/boardx/workspacex/git/ref/heads/feedback-attachments");
      expect(calls[0]!.init?.method).toBe("GET");
      const contentGet = calls[1]!;
      expect(contentGet.url).toBe(
        "https://api.github.com/repos/boardx/workspacex/contents/feedback-attachments/fbattach-1.png?ref=feedback-attachments",
      );
      const put = calls[2]!;
      expect(put.url).toBe("https://api.github.com/repos/boardx/workspacex/contents/feedback-attachments/fbattach-1.png");
      expect(put.init?.method).toBe("PUT");
      const headers = put.init?.headers as Record<string, string>;
      expect(headers.authorization).toBe("Bearer ghp_fake_token");
      const body = JSON.parse(put.init?.body as string) as { message: string; content: string; branch?: string; sha?: string };
      expect(body.content).toBe(Buffer.from([1, 2, 3]).toString("base64"));
      expect(body.branch).toBe("feedback-attachments"); // ⚠ 不写 main
      expect(body.sha).toBeUndefined(); // 首次上传，文件不存在，不该带 sha
      expect(result.url).toContain("raw.githubusercontent.com");
    });

    /**
     * ⚠ 独立 review 二轮抓到的真实问题:不带 `branch` 的 `PUT` 会直接提交默认分支
     * `main`，绕过整个 PR/CI/review、可能触发本仓监听 `push: branches: [main]` 的
     * 部署流水线。人类决策后改成专用分支，且首次使用时惰性建一个**孤儿分支**——
     * 这条断的正是"分支不存在时怎么建"这一步(空树 → 无父提交 → ref)。
     */
    it("专用分支不存在 ⇒ 惰性建孤儿分支(空树/无父提交/ref)，再继续上传", async () => {
      const calls: Array<{ url: string; init?: RequestInit }> = [];
      const creator = new FetchGithubIssueCreator(fakeConfig(), routedFetch(calls, { refStatus: 404 }));

      await creator.uploadImage(input);

      const [refGet, treePost, commitPost, refPost, contentGet, put] = calls;
      expect(refGet!.init?.method).toBe("GET");
      expect(treePost!.url).toBe("https://api.github.com/repos/boardx/workspacex/git/trees");
      expect(JSON.parse(treePost!.init?.body as string)).toEqual({ tree: [] }); // 空树,孤儿分支不带任何源码
      expect(commitPost!.url).toBe("https://api.github.com/repos/boardx/workspacex/git/commits");
      const commitBody = JSON.parse(commitPost!.init?.body as string) as { tree: string; parents: unknown[] };
      expect(commitBody.tree).toBe("tree-sha");
      expect(commitBody.parents).toEqual([]); // 无父提交 = 孤儿,不从 main 分叉
      expect(refPost!.url).toBe("https://api.github.com/repos/boardx/workspacex/git/refs");
      expect(JSON.parse(refPost!.init?.body as string)).toEqual({ ref: "refs/heads/feedback-attachments", sha: "commit-sha" });
      expect(contentGet!.url).toContain("/contents/");
      expect(put!.init?.method).toBe("PUT");
    });

    /**
     * ⚠ review 二轮的修正:`422` 不是"ref 已存在"的唯一含义,也可能是真正的
     * validation failure——所以这里不再无条件相信 `422`,而是重新 `GET` 这个 ref
     * 确认它真的存在了才继续。这条覆盖"确实是并发冲突"的那一半:重新 `GET` 拿到
     * `200` ⇒ 放行。另一半("422 但 ref 其实不存在")见下一条用例。
     */
    it("建分支时并发冲突(POST git/refs 收到 422)⇒ 重新 GET 确认 ref 真的存在才放行，继续上传", async () => {
      const calls: Array<{ url: string; init?: RequestInit }> = [];
      const creator = new FetchGithubIssueCreator(
        fakeConfig(),
        routedFetch(calls, { refStatus: 404, createRefStatus: 422, refRecheckStatus: 200 }),
      );
      const result = await creator.uploadImage(input);
      expect(result.url).toBeTruthy();
      const refGets = calls.filter((c) => c.url.includes("/git/ref/heads/"));
      expect(refGets).toHaveLength(2); // 首次探测(404) + 422 之后的复核(200)
    });

    it("POST git/refs 收到 422 但复核 ref 其实不存在(真正的 validation failure)⇒ 报错，不放行", async () => {
      const calls: Array<{ url: string; init?: RequestInit }> = [];
      const creator = new FetchGithubIssueCreator(
        fakeConfig(),
        routedFetch(calls, { refStatus: 404, createRefStatus: 422, refRecheckStatus: 404 }),
      );
      const error = await creator.uploadImage(input).catch((e) => e as GithubIssueApiError);
      expect(error).toBeInstanceOf(GithubIssueApiError);
    });

    /**
     * ⑥ 独立 review 一轮抓到的真实幂等 bug:同一路径重试(如"上传成功、issue 创建
     * 失败、释放认领、管理员重试")之前不带 `sha`，GitHub 会 422。修法是先 `GET`
     * 探测已存在文件的 `sha`，`PUT` 时带上——这条断的正是这一步。
     */
    it("路径已存在(重试场景)：GET 探测到 sha，PUT 带上这个 sha，不会 422", async () => {
      const calls: Array<{ url: string; init?: RequestInit }> = [];
      const creator = new FetchGithubIssueCreator(
        fakeConfig(),
        routedFetch(calls, { contentGetStatus: 200, contentGetBody: { sha: "existing-blob-sha" } }),
      );

      await creator.uploadImage(input);

      const put = calls[2]!;
      const body = JSON.parse(put.init?.body as string) as { sha?: string };
      expect(body.sha).toBe("existing-blob-sha");
    });

    /**
     * ⚠ 独立 review 二轮再指出的边界:`200` 但响应体没有合法字符串 `sha` 是一个
     * **无效响应**,不是"文件不存在"——此前会退化成 `null`(当作首次上传),对
     * 已存在文件必然 422、被 best-effort 吞掉、丢图。现在改成直接失败。
     */
    it("内容探测 200 但响应体没有合法 sha ⇒ 视为无效响应,直接失败,不当成「不存在」", async () => {
      const calls: Array<{ url: string; init?: RequestInit }> = [];
      const creator = new FetchGithubIssueCreator(
        fakeConfig(),
        routedFetch(calls, { contentGetStatus: 200, contentGetBody: {} }), // 200 但没有 sha 字段
      );
      const error = await creator.uploadImage(input).catch((e) => e as GithubIssueApiError);
      expect(error).toBeInstanceOf(GithubIssueApiError);
    });

    /**
     * ⚠ 独立 review 二轮的修正:探测失败(网络异常/401/403/429/5xx)**不能**当成
     * "文件不存在"悄悄发一个不带 sha 的 PUT——那对已存在文件必然 422、被上层
     * best-effort 吞掉、issue 建出来但没带图。只有 404 才是"真的不存在"，
     * 其余一律直接失败，交给调用方(`withAttachmentImages`)跳过这一张。
     */
    it("内容探测网络异常 ⇒ 直接失败,不当成「不存在」去猜", async () => {
      const calls: Array<{ url: string; init?: RequestInit }> = [];
      const creator = new FetchGithubIssueCreator(fakeConfig(), routedFetch(calls, { contentGetThrows: true }));
      await expect(creator.uploadImage(input)).rejects.toBeInstanceOf(GithubIssueApiError);
      expect(calls).toHaveLength(2); // 建分支的 GET + 探测内容的 GET——没有走到 PUT
    });

    it("内容探测非 404 的非 2xx(如 403)⇒ 直接失败,不当成「不存在」去猜", async () => {
      const calls: Array<{ url: string; init?: RequestInit }> = [];
      const creator = new FetchGithubIssueCreator(fakeConfig(), routedFetch(calls, { contentGetStatus: 403 }));
      const error = await creator.uploadImage(input).catch((e) => e as GithubIssueApiError);
      expect(error).toBeInstanceOf(GithubIssueApiError);
      expect((error as GithubIssueApiError).status).toBe(403);
    });

    it("HTTP 非 2xx(PUT 失败) ⇒ 抛 GithubIssueApiError(op: uploadImage)", async () => {
      const calls: Array<{ url: string; init?: RequestInit }> = [];
      const creator = new FetchGithubIssueCreator(fakeConfig(), routedFetch(calls, { putStatus: 401, putBody: { message: "Bad credentials" } }));
      const error = await creator.uploadImage(input).catch((e) => e as GithubIssueApiError);
      expect(error).toBeInstanceOf(GithubIssueApiError);
      expect((error as GithubIssueApiError).op).toBe("uploadImage");
      expect((error as GithubIssueApiError).status).toBe(401);
    });

    it("响应缺 content.download_url ⇒ 视为无效响应,抛错", async () => {
      const calls: Array<{ url: string; init?: RequestInit }> = [];
      const creator = new FetchGithubIssueCreator(fakeConfig(), routedFetch(calls, { putBody: {} }));
      await expect(creator.uploadImage(input)).rejects.toBeInstanceOf(GithubIssueApiError);
    });

    it("没有 token ⇒ 直接拒绝,不发请求", async () => {
      let called = false;
      const fakeFetch = (async () => {
        called = true;
        return jsonResponse({});
      }) as typeof fetch;
      const creator = new FetchGithubIssueCreator(fakeConfig({ token: "" }), fakeFetch);
      await expect(creator.uploadImage(input)).rejects.toBeInstanceOf(GithubIssueApiError);
      expect(called).toBe(false);
    });
  });

  describe("githubIssueConfig", () => {
    it("非生产环境允许缺 token(可选子系统,不该拖垮启动)", () => {
      expect(() => githubIssueConfig({ NODE_ENV: "test" } as NodeJS.ProcessEnv)).not.toThrow();
    });

    it("生产环境缺 token 直接拒绝", () => {
      expect(() => githubIssueConfig({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toThrow(
        /GITHUB_ISSUE_TOKEN/,
      );
    });

    it("owner/repo 默认 boardx/workspacex", () => {
      const config = githubIssueConfig({ NODE_ENV: "test", GITHUB_ISSUE_TOKEN: "x" } as NodeJS.ProcessEnv);
      expect(config.owner).toBe("boardx");
      expect(config.repo).toBe("workspacex");
    });
  });
});
