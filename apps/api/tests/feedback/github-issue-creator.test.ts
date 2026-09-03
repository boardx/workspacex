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

  describe("uploadImage(⑥ 反馈附件图片推给 GitHub)", () => {
    it("PUT Contents API,base64 编码字节,返回 download_url", async () => {
      let capturedUrl: string | undefined;
      let capturedInit: RequestInit | undefined;
      const fakeFetch = (async (url: string, init?: RequestInit) => {
        capturedUrl = url;
        capturedInit = init;
        return jsonResponse({
          content: { download_url: "https://raw.githubusercontent.com/boardx/workspacex/main/feedback-attachments/fbattach-1.png" },
        });
      }) as typeof fetch;
      const creator = new FetchGithubIssueCreator(fakeConfig(), fakeFetch);

      const result = await creator.uploadImage({
        path: "feedback-attachments/fbattach-1.png",
        content: new Uint8Array([1, 2, 3]),
        contentType: "image/png",
      });

      expect(capturedUrl).toBe(
        "https://api.github.com/repos/boardx/workspacex/contents/feedback-attachments/fbattach-1.png",
      );
      expect(capturedInit?.method).toBe("PUT");
      const headers = capturedInit?.headers as Record<string, string>;
      expect(headers.authorization).toBe("Bearer ghp_fake_token");
      const body = JSON.parse(capturedInit?.body as string) as { message: string; content: string };
      expect(body.content).toBe(Buffer.from([1, 2, 3]).toString("base64"));
      expect(body.message).toContain("feedback-attachments/fbattach-1.png");
      expect(result).toEqual({
        url: "https://raw.githubusercontent.com/boardx/workspacex/main/feedback-attachments/fbattach-1.png",
      });
    });

    it("HTTP 非 2xx ⇒ 抛 GithubIssueApiError(op: uploadImage)", async () => {
      const fakeFetch = (async () => jsonResponse({ message: "Bad credentials" }, 401)) as typeof fetch;
      const creator = new FetchGithubIssueCreator(fakeConfig(), fakeFetch);
      const error = await creator
        .uploadImage({ path: "feedback-attachments/x.png", content: new Uint8Array([1]), contentType: "image/png" })
        .catch((e) => e as GithubIssueApiError);
      expect(error).toBeInstanceOf(GithubIssueApiError);
      expect((error as GithubIssueApiError).op).toBe("uploadImage");
      expect((error as GithubIssueApiError).status).toBe(401);
    });

    it("响应缺 content.download_url ⇒ 视为无效响应,抛错", async () => {
      const fakeFetch = (async () => jsonResponse({})) as typeof fetch;
      const creator = new FetchGithubIssueCreator(fakeConfig(), fakeFetch);
      await expect(
        creator.uploadImage({ path: "feedback-attachments/x.png", content: new Uint8Array([1]), contentType: "image/png" }),
      ).rejects.toBeInstanceOf(GithubIssueApiError);
    });

    it("没有 token ⇒ 直接拒绝,不发请求", async () => {
      let called = false;
      const fakeFetch = (async () => {
        called = true;
        return jsonResponse({});
      }) as typeof fetch;
      const creator = new FetchGithubIssueCreator(fakeConfig({ token: "" }), fakeFetch);
      await expect(
        creator.uploadImage({ path: "feedback-attachments/x.png", content: new Uint8Array([1]), contentType: "image/png" }),
      ).rejects.toBeInstanceOf(GithubIssueApiError);
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
