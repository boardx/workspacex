/**
 * #520 —— `/skill` 的 Skill 库屏接真实 API 的**组件测试**。
 *
 * ## ⚠ 这**不能**替代 `e2e/skill-create-smoke.spec.ts`，一条也不能
 *
 * 这里的 `fetch` 是假的。组件测试里的「刷新」只是再调一次这个假 `fetch`，它**永远**
 * 分不出「写进了库」和「写进了 React state」——那正是本 issue 唯一要证的东西。
 * 持久化那一条只有真实浏览器 + 真实 PostgreSQL 证得了，那条在 e2e spec 里。
 *
 * 那这里还证什么？证**请求与渲染的形状**，也就是 e2e 跑起来之前就能钉死的部分：
 *   ① 打的是契约的路径与方法，`orgId` 来自会话而不是别处；
 *   ② 请求体里**没有** `source`（它由服务端按入口打标，写它 ⇒ `SOURCE_TAG_IMMUTABLE`）；
 *   ③ 空结果渲染**真实空态**，不生成任何示例 skill；
 *   ④ 失败态回显后端**真实错误信封**：reasonCode ＋ HTTP 状态，不糊成「加载失败」。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";

vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({
    session: { currentOrgId: "org-520" },
    identity: { org: { name: "测试组织" }, orgRole: "admin" },
  }),
}));

import { SkillCatalogLive } from "@/components/skill/skill-catalog-live";

const ORG = "org-520";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface Recorded {
  readonly method: string;
  readonly pathname: string;
  readonly search: URLSearchParams;
  readonly body: unknown;
}

describe("#520 Skill 库屏接真实 API", () => {
  let calls: Recorded[];

  function install(handler: (call: Recorded) => Response | Promise<Response>) {
    calls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(typeof input === "string" ? input : input.toString());
        const call: Recorded = {
          method: init?.method ?? "GET",
          pathname: url.pathname,
          search: url.searchParams,
          body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
        };
        calls.push(call);
        return handler(call);
      }),
    );
  }

  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-520");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("空结果渲染真实空态，不生成任何示例 skill", async () => {
    install(() => jsonResponse({ items: [], total: 0 }));
    render(<SkillCatalogLive />);

    await waitFor(() => expect(screen.getByTestId("skill-catalog-empty")).toBeTruthy());
    // 反空转：确实是「读成功且为空」，不是「还在加载」。
    expect(screen.queryByTestId("skill-catalog-loading")).toBeNull();
    expect(screen.queryByTestId("skill-catalog-error")).toBeNull();
    expect(screen.queryByTestId("skill-catalog-list")).toBeNull();

    const list = calls.find((c) => c.method === "GET" && c.pathname === "/skills");
    expect(list).toBeTruthy();
    expect(list!.search.get("orgId")).toBe(ORG);
    // 契约 I-14：四入口共用同一份可见性过滤，入口选择器不能漏。
    expect(list!.search.get("entry")).toBe("library");
  });

  it("提交打的是 POST /skills，请求体是契约的形状，且**不含** source", async () => {
    install((call) => {
      if (call.method === "GET") return jsonResponse({ items: [], total: 0 });
      return jsonResponse(
        { skillId: "sk-1", versionId: "sv-1", source: "自建", status: "草稿" },
        201,
      );
    });
    render(<SkillCatalogLive />);
    await waitFor(() => expect(screen.getByTestId("skill-catalog-empty")).toBeTruthy());

    fireEvent.click(screen.getByTestId("skill-create-open"));
    fireEvent.change(screen.getByTestId("skill-create-name"), { target: { value: "排序器" } });
    fireEvent.change(screen.getByTestId("skill-create-duty"), { target: { value: "排序" } });
    fireEvent.change(screen.getByTestId("skill-create-prompt"), { target: { value: "排 {{x}}" } });
    fireEvent.change(screen.getByTestId("skill-create-input-schema"), { target: { value: "{}" } });
    fireEvent.change(screen.getByTestId("skill-create-output-schema"), { target: { value: "{}" } });
    fireEvent.change(screen.getByTestId("skill-create-fallback"), { target: { value: "如实说" } });
    fireEvent.click(screen.getByTestId("skill-create-submit"));

    await waitFor(() => expect(screen.getByTestId("skill-catalog-notice")).toBeTruthy());

    const post = calls.find((c) => c.method === "POST");
    expect(post?.pathname).toBe("/skills");
    const body = post!.body as Record<string, unknown>;
    expect(body.orgId).toBe(ORG);
    expect(body.visibility).toBe("org-wide");
    // ⚠ 服务端按入口打标；请求体里出现 source ⇒ `SOURCE_TAG_IMMUTABLE`。
    expect("source" in body).toBe(false);
    const contract = body.contract as Record<string, unknown>;
    // 空输入折成**空数组**，不是 `[""]`——后者会被 fail-closed 的授权判成越权。
    expect(contract.dataScope).toEqual([]);
    expect(contract.readsRawTranscript).toBe(false);

    // 服务端分配的字段进了列表（状态只能是草稿：没有第二个评审人就没有已启用）。
    expect(screen.getByTestId("skill-catalog-list").textContent).toContain("排序器");
    expect(screen.getByTestId("skill-catalog-list").textContent).toContain("草稿");
  });

  /**
   * 🔴 #861 —— 这条钉的是 CI 上那个间歇失败的**根因**，不是它的症状。
   *
   * `skill-create-smoke.spec.ts` 的反证用例（「stub 掉创建请求后刷新就没了」）在 CI 上
   * 偶发红在它**自检**那一步（`toContainText(NAME)`，断言那一行一度出现过）：
   * notice 出来了，列表里却没有那一行。
   * 症状看着像 e2e 抖动，实际是本屏一个**真实的时序缺陷**：
   *
   *   `onCreated` 原来写成 `prev.status === "ready" ? 插入 : prev` ——
   *   于是「首屏列表还没读回来」这段窗口里提交成功的话，那一行被**静默丢掉**，
   *   随后到达的 GET 响应再把 state 覆盖成纯服务端结果。使用者看到的是
   *   「提示说建好了，列表里没有」。反证用例的 201 是浏览器里 stub 出来的（零网络延迟），
   *   最容易撞进这个窗口 —— 所以它是 CI 上第一个红的，但红的不是它自己的毛病。
   *
   * ⚠ 断言的是**行为**（提交在加载窗口里发生时，那一行照样看得见），不是实现细节。
   *   这里不能靠加 timeout / 重试掩盖：多等一会儿那一行也永远不会自己回来。
   */
  it("首屏列表还在飞的时候提交成功，那一行照样进列表（不被随后到达的响应吞掉）", async () => {
    let releaseList: (() => void) | null = null;
    const listArrived = new Promise<void>((resolve) => {
      releaseList = resolve;
    });

    install((call) => {
      if (call.method === "GET") {
        // 首屏 GET 一直挂着，直到本用例放行——这就是 CI 上那个窗口，只是这里是确定性的。
        return listArrived.then(() => jsonResponse({ items: [], total: 0 }));
      }
      return jsonResponse(
        { skillId: "sk-race", versionId: "sv-race", source: "自建", status: "草稿" },
        201,
      );
    });

    render(<SkillCatalogLive />);
    // 列表还在加载：这正是使用者能点到「新建」的那段时间。
    await waitFor(() => expect(screen.getByTestId("skill-catalog-loading")).toBeTruthy());

    fireEvent.click(screen.getByTestId("skill-create-open"));
    fireEvent.change(screen.getByTestId("skill-create-name"), { target: { value: "抢跑建的" } });
    fireEvent.change(screen.getByTestId("skill-create-duty"), { target: { value: "排序" } });
    fireEvent.click(screen.getByTestId("skill-create-submit"));

    await waitFor(() => expect(screen.getByTestId("skill-catalog-notice")).toBeTruthy());
    // ① 提交返回的当下就看得见——不是「等列表读回来才补上」。
    expect(screen.getByTestId("skill-catalog-list").textContent).toContain("抢跑建的");

    releaseList!();
    // ② 随后到达的**服务端空列表**不许把它吞掉：这次 GET 是在创建**之前**发出的，
    //    它根本不可能包含这一行；用它覆盖，等于用一份过期的事实否定一件刚发生的事。
    await waitFor(() => expect(screen.queryByTestId("skill-catalog-loading")).toBeNull());
    expect(screen.getByTestId("skill-catalog-list").textContent).toContain("抢跑建的");
    // 反空转：确实是「读成功了」，不是卡在加载态让上面那条恒真。
    expect(screen.queryByTestId("skill-catalog-error")).toBeNull();
  });

  /**
   * 与上一条成对：创建**之后**才发起的读取（刷新按钮 / `page.reload()`）是**新的事实**，
   * 它有权把乐观插入的那一行抹掉 —— 反证用例「刷新后就没了」靠的正是这一条。
   * 少了它，上一条的修法会滑成「乐观行永久钉在界面上」，反证再也红不了。
   */
  it("创建之后发起的读取会抹掉没落库的那一行（反证「刷新后就没了」靠这条）", async () => {
    install((call) => {
      if (call.method === "GET") return jsonResponse({ items: [], total: 0 });
      return jsonResponse(
        { skillId: "sk-ghost", versionId: "sv-ghost", source: "自建", status: "草稿" },
        201,
      );
    });
    render(<SkillCatalogLive />);
    await waitFor(() => expect(screen.getByTestId("skill-catalog-empty")).toBeTruthy());

    fireEvent.click(screen.getByTestId("skill-create-open"));
    fireEvent.change(screen.getByTestId("skill-create-name"), { target: { value: "没落库的" } });
    fireEvent.click(screen.getByTestId("skill-create-submit"));
    await waitFor(() =>
      expect(screen.getByTestId("skill-catalog-list").textContent).toContain("没落库的"),
    );

    // 服务端从来没有过这一行（假 fetch 恒返回空列表）——重新读一次，它就该消失。
    fireEvent.click(screen.getByTestId("skill-catalog-refresh"));
    await waitFor(() => expect(screen.getByTestId("skill-catalog-empty")).toBeTruthy());
    expect(screen.queryByTestId("skill-catalog-list")).toBeNull();
  });

  it("被拒绝时回显后端真实错误信封：reasonCode ＋ HTTP 状态", async () => {
    install((call) => {
      if (call.method === "GET") return jsonResponse({ items: [], total: 0 });
      return jsonResponse(
        { error: "forbidden", traceId: "t-1", reasonCode: "DATA_SCOPE_EXCEEDS_SUBMITTER" },
        403,
      );
    });
    render(<SkillCatalogLive />);
    await waitFor(() => expect(screen.getByTestId("skill-catalog-empty")).toBeTruthy());

    fireEvent.click(screen.getByTestId("skill-create-open"));
    fireEvent.change(screen.getByTestId("skill-create-name"), { target: { value: "越权的" } });
    fireEvent.change(screen.getByTestId("skill-create-data-scope"), {
      target: { value: "crm:customer:read" },
    });
    fireEvent.click(screen.getByTestId("skill-create-submit"));

    const error = await screen.findByTestId("skill-create-error");
    expect(error.textContent).toContain("DATA_SCOPE_EXCEEDS_SUBMITTER");
    expect(error.textContent).toContain("403");
    // 被拒绝的东西没有混进列表——失败态不留乐观插入的残影。
    expect(screen.queryByTestId("skill-catalog-list")).toBeNull();
    expect(screen.getByTestId("skill-catalog-empty")).toBeTruthy();
  });

  it("列表读取失败也回显真实信封，并给出重试", async () => {
    install(() => jsonResponse({ error: "forbidden", traceId: "t-2", reasonCode: "PERMISSION_REVOKED" }, 403));
    render(<SkillCatalogLive />);

    const error = await screen.findByTestId("skill-catalog-error");
    expect(error.textContent).toContain("PERMISSION_REVOKED");
    expect(error.textContent).toContain("403");
    // 失败不是空态：两者在界面上必须分得开。
    expect(screen.queryByTestId("skill-catalog-empty")).toBeNull();
    expect(screen.getByTestId("skill-catalog-retry")).toBeTruthy();
  });

  /**
   * 2026-08-13 —— tag 过滤 chip（人类原话：「另外需要有一个 tags，用来过滤」）。
   *
   * 断言的是**过滤真的生效**（点了 chip，列表真的收窄；再点一次，列表真的恢复），
   * 不是「chip 渲染出来了」这种空转断言。
   */
  describe("tag 过滤", () => {
    function twoSkills() {
      return jsonResponse({
        items: [
          {
            skillId: "sk-a", name: "排序器", duty: "排序", source: "自建",
            status: "草稿", visibility: "org-wide", currentVersionId: "sv-a", satisfaction: null,
          },
          {
            skillId: "sk-b", name: "翻译器", duty: "翻译", source: "晋升生成",
            status: "已启用", visibility: "team-only", currentVersionId: "sv-b", satisfaction: 0.8,
          },
        ],
        total: 2,
      });
    }

    it("点一个来源 chip 之后，列表只剩匹配的那一行；再点一次恢复全部", async () => {
      install((call) => (call.method === "GET" ? twoSkills() : jsonResponse({}, 500)));
      render(<SkillCatalogLive />);
      await waitFor(() => expect(screen.getByTestId("skill-catalog-list")).toBeTruthy());
      expect(screen.getByTestId("skill-catalog-list").textContent).toContain("排序器");
      expect(screen.getByTestId("skill-catalog-list").textContent).toContain("翻译器");

      fireEvent.click(screen.getByTestId("skill-tag-chip-self-built"));
      expect(screen.getByTestId("skill-catalog-list").textContent).toContain("排序器");
      expect(screen.getByTestId("skill-catalog-list").textContent).not.toContain("翻译器");

      fireEvent.click(screen.getByTestId("skill-tag-chip-self-built"));
      expect(screen.getByTestId("skill-catalog-list").textContent).toContain("排序器");
      expect(screen.getByTestId("skill-catalog-list").textContent).toContain("翻译器");
    });

    it("跨维度是「且」：同时选来源=晋升生成 与 状态=草稿，没有任何一行同时满足，显示无匹配态", async () => {
      install((call) => (call.method === "GET" ? twoSkills() : jsonResponse({}, 500)));
      render(<SkillCatalogLive />);
      await waitFor(() => expect(screen.getByTestId("skill-catalog-list")).toBeTruthy());

      fireEvent.click(screen.getByTestId("skill-tag-chip-promoted")); // source=晋升生成 → 只剩「翻译器」
      fireEvent.click(screen.getByTestId("skill-tag-chip-draft")); // status=草稿 → 「翻译器」是已启用，被排除
      expect(screen.queryByTestId("skill-catalog-list")).toBeNull();
      expect(screen.getByTestId("skill-catalog-no-match")).toBeTruthy();
      // 这不是真实空态——真实数据还在，只是被过滤条件收窄没了：两者必须分得开。
      expect(screen.queryByTestId("skill-catalog-empty")).toBeNull();

      fireEvent.click(screen.getByTestId("skill-tag-filter-clear"));
      expect(screen.getByTestId("skill-catalog-list").textContent).toContain("排序器");
      expect(screen.getByTestId("skill-catalog-list").textContent).toContain("翻译器");
      expect(screen.queryByTestId("skill-catalog-no-match")).toBeNull();
    });

    it("同一维度内选中多个 chip 是「或」：来源同时选自建＋晋升生成＝两行都要", async () => {
      install((call) => (call.method === "GET" ? twoSkills() : jsonResponse({}, 500)));
      render(<SkillCatalogLive />);
      await waitFor(() => expect(screen.getByTestId("skill-catalog-list")).toBeTruthy());

      fireEvent.click(screen.getByTestId("skill-tag-chip-self-built"));
      fireEvent.click(screen.getByTestId("skill-tag-chip-promoted"));
      expect(screen.getByTestId("skill-catalog-list").textContent).toContain("排序器");
      expect(screen.getByTestId("skill-catalog-list").textContent).toContain("翻译器");
    });

    it("真实空态（没有任何 skill）时不渲染过滤条——没有行可过滤", async () => {
      install(() => jsonResponse({ items: [], total: 0 }));
      render(<SkillCatalogLive />);
      await waitFor(() => expect(screen.getByTestId("skill-catalog-empty")).toBeTruthy());
      expect(screen.queryByTestId("skill-tag-filter")).toBeNull();
    });
  });

  /**
   * 2026-08-13 —— 「新建 Skill」三条路径（人类拿两张后台原型截图核对）。
   *
   * 断言的是**接线关系**，不是「面板渲染出来了」这种空转断言：
   *   · 「从 GitHub 导入」tab 打开的就是真实组件 `SkillUrlImportPanel`，
   *     点「确认导入」真的打 `POST /admin/skills/url-imports`，请求体形状对，
   *     导入成功后真的触发一次 `GET /skills` 刷新（`onImported` 接的是真实 `load`）。
   *   · 「从市场挑一个改」tab 只显示「未接后端」的如实说明，**不发任何网络请求**——
   *     防止有人为了让界面看起来完整而悄悄塞进 mock 数字或死按钮。
   *   · 默认 tab 仍是「完全新建（契约表单）」——上面那一整组既有用例
   *     （点 `skill-create-open` 直接操作 `skill-create-name` 等）不需要改，
   *     这条本身就是这份新增测试要保护的回归面。
   */
  describe("2026-08-13 新建 Skill 三条路径", () => {
    it("默认 tab 是「完全新建」：点 skill-create-open 后契约表单立即可见，不需要先选 tab", async () => {
      install(() => jsonResponse({ items: [], total: 0 }));
      render(<SkillCatalogLive />);
      await waitFor(() => expect(screen.getByTestId("skill-catalog-empty")).toBeTruthy());

      fireEvent.click(screen.getByTestId("skill-create-open"));
      expect(screen.getByTestId("skill-create-mode-form").getAttribute("aria-pressed")).toBe("true");
      expect(screen.getByTestId("skill-create-panel")).toBeTruthy();
      expect(screen.queryByTestId("skill-url-import-panel")).toBeNull();
    });

    it("切到「从 GitHub 导入」：渲染的是真实 SkillUrlImportPanel，确认导入打 POST /admin/skills/url-imports 且参数正确，成功后刷新列表", async () => {
      install((call) => {
        if (call.method === "GET" && call.pathname === "/skills") return jsonResponse({ items: [], total: 0 });
        if (call.method === "POST" && call.pathname === "/admin/skills/url-imports") {
          return jsonResponse(
            {
              skillId: "sk-imported",
              versionId: "sv-imported",
              filePaths: ["SKILL.md", "reference.md"],
              contentDigest: "a".repeat(64),
              replayed: false,
            },
            201,
          );
        }
        return jsonResponse({}, 500);
      });
      render(<SkillCatalogLive />);
      await waitFor(() => expect(screen.getByTestId("skill-catalog-empty")).toBeTruthy());

      fireEvent.click(screen.getByTestId("skill-create-open"));
      fireEvent.click(screen.getByTestId("skill-create-mode-import"));
      expect(screen.getByTestId("skill-url-import-panel")).toBeTruthy();

      fireEvent.click(screen.getByTestId("skill-url-import-open"));
      fireEvent.change(screen.getByTestId("skill-url-import-url"), {
        target: { value: "https://github.com/org/skill-repo" },
      });
      fireEvent.change(screen.getByTestId("skill-url-import-name"), {
        target: { value: "导入的 skill" },
      });
      fireEvent.click(screen.getByTestId("skill-url-import-confirm"));

      await waitFor(() => expect(screen.getByTestId("skill-url-import-result")).toBeTruthy());
      expect(screen.getByTestId("skill-url-import-result").textContent).toContain("2 个文件");

      const importCall = calls.find(
        (c) => c.method === "POST" && c.pathname === "/admin/skills/url-imports",
      );
      expect(importCall).toBeTruthy();
      const body = importCall!.body as Record<string, unknown>;
      expect(body.sourceUrl).toBe("https://github.com/org/skill-repo");
      expect(body.name).toBe("导入的 skill");
      expect(typeof body.idempotencyKey).toBe("string");

      // ⚠ 断言的是「真的重新打了一次 GET /skills」，不是「界面上有没有文字」——
      //   `onImported` 接的必须是本屏真实的 `load`，不是一个假装成功的 no-op。
      const listCallsAfterImport = calls.filter(
        (c) => c.method === "GET" && c.pathname === "/skills",
      );
      expect(listCallsAfterImport.length).toBeGreaterThanOrEqual(2);
    });

    it("切到「从市场挑一个改」：只显示未接后端的说明，不发任何网络请求", async () => {
      install(() => jsonResponse({ items: [], total: 0 }));
      render(<SkillCatalogLive />);
      await waitFor(() => expect(screen.getByTestId("skill-catalog-empty")).toBeTruthy());

      const callsBefore = calls.length;
      fireEvent.click(screen.getByTestId("skill-create-open"));
      fireEvent.click(screen.getByTestId("skill-create-mode-market"));

      expect(screen.getByTestId("skill-create-market-unavailable")).toBeTruthy();
      expect(screen.getByTestId("skill-create-market-unavailable").textContent).toContain("还没有后端");
      // 没有假数字、没有可点的「浏览」按钮。
      expect(screen.queryByText(/已同步/)).toBeNull();
      expect(calls.length).toBe(callsBefore);
    });
  });

  /**
   * G3（2026-08-14，人类原话：「新建skill应该弹出来一个新的popup界面」）——
   * 「新建 Skill」现在是一个真正的 Dialog（复用 `components/files/overlay.tsx` 的
   * `Modal`），不是内嵌在页面里的一块区域。
   */
  describe("G3：新建 Skill 是弹窗", () => {
    it("点「新建 skill」后出现 role=dialog 的弹窗；点关闭按钮后消失", async () => {
      install(() => jsonResponse({ items: [], total: 0 }));
      render(<SkillCatalogLive />);
      await waitFor(() => expect(screen.getByTestId("skill-catalog-empty")).toBeTruthy());

      expect(screen.queryByTestId("skill-create-modal")).toBeNull();
      fireEvent.click(screen.getByTestId("skill-create-open"));

      const dialog = screen.getByTestId("skill-create-modal");
      expect(dialog).toBeTruthy();
      expect(dialog.getAttribute("role")).toBe("dialog");
      // 三条路径的 tab 切换器仍在弹窗内部，不是被弹窗遮住的另一块。
      expect(screen.getByTestId("skill-create-mode-tabs")).toBeTruthy();

      fireEvent.click(screen.getByTestId("skill-create-modal-close"));
      expect(screen.queryByTestId("skill-create-modal")).toBeNull();
    });
  });

  /**
   * G5（2026-08-14，人类原话：「新建的时候要支持添加tags」）—— 契约新增字段
   * `tags?: string[]`（design delta：`phases/phase-01-run-a-project/design-deltas/
   * skill-tags/`）。
   */
  describe("G5：新建时可以填 tags，请求体带上它，卡片上能看见", () => {
    it("提交时 tags 输入框的逗号分隔文本被拆成数组，随请求体一起发出", async () => {
      install((call) => {
        if (call.method === "GET") return jsonResponse({ items: [], total: 0 });
        return jsonResponse(
          { skillId: "sk-tagged", versionId: "sv-tagged", source: "自建", status: "草稿" },
          201,
        );
      });
      render(<SkillCatalogLive />);
      await waitFor(() => expect(screen.getByTestId("skill-catalog-empty")).toBeTruthy());

      fireEvent.click(screen.getByTestId("skill-create-open"));
      fireEvent.change(screen.getByTestId("skill-create-name"), { target: { value: "打标签的" } });
      fireEvent.change(screen.getByTestId("skill-create-duty"), { target: { value: "职责" } });
      fireEvent.change(screen.getByTestId("skill-create-prompt"), { target: { value: "p" } });
      fireEvent.change(screen.getByTestId("skill-create-input-schema"), { target: { value: "{}" } });
      fireEvent.change(screen.getByTestId("skill-create-output-schema"), { target: { value: "{}" } });
      fireEvent.change(screen.getByTestId("skill-create-fallback"), { target: { value: "如实说" } });
      fireEvent.change(screen.getByTestId("skill-create-tags"), {
        target: { value: "客服, 数据分析 ,客服" },
      });
      fireEvent.click(screen.getByTestId("skill-create-submit"));

      await waitFor(() =>
        expect(calls.some((c) => c.method === "POST" && c.pathname === "/skills")).toBe(true),
      );
      const createCall = calls.find((c) => c.method === "POST" && c.pathname === "/skills")!;
      const body = createCall.body as Record<string, unknown>;
      // ⚠ 逐字段拆分即可——本层不去重（"客服" 出现两次原样两次），去重不是这个输入框的职责。
      expect(body.tags).toEqual(["客服", "数据分析", "客服"]);

      // 乐观插入那一行也带着刚填的 tags——不是编的，是这次提交本身的入参（同名义务见文件头③条）。
      await waitFor(() => expect(screen.getByTestId("skill-catalog-list")).toBeTruthy());
      const tagsBlock = screen.getByTestId("skill-catalog-tags");
      expect(tagsBlock.textContent).toContain("客服");
      expect(tagsBlock.textContent).toContain("数据分析");
    });

    it("没有 tags 的行不渲染 skill-catalog-tags 这个区块", async () => {
      install(() =>
        jsonResponse({
          items: [
            {
              skillId: "sk-no-tags", name: "无标签", duty: "职责", source: "自建",
              status: "草稿", visibility: "org-wide", currentVersionId: "sv-x", satisfaction: null,
              tags: [],
            },
          ],
          total: 1,
        }),
      );
      render(<SkillCatalogLive />);
      await waitFor(() => expect(screen.getByTestId("skill-catalog-list")).toBeTruthy());
      expect(screen.queryByTestId("skill-catalog-tags")).toBeNull();
    });
  });

  /**
   * G2/G6（2026-08-14，人类实测：卡片 404 `SKILL_NOT_FOUND`）—— `duty` 命中 wave2
   * 标记（`isSourceFileBacked`）的行显示「编辑源码」而不是「查看契约」，见
   * `skill-catalog-live.tsx` 文件头长注。
   */
  describe("G2/G6：wave2（skills 表来源）行不再摆一个必 404 的「查看契约」", () => {
    it("duty 命中标记的行显示「编辑源码」链接，目标是独立编辑页 /admin/skill/<skillId>；普通行仍是「查看契约」", async () => {
      install(() =>
        jsonResponse({
          items: [
            {
              skillId: "sk-wave2", name: "URL 导入的", duty: "这个 skill 的内容是文件形式（导入 / 由文件浏览器维护），不是声明式契约表单——查看/编辑源码请点卡片上的「编辑源码」。",
              source: "自建", status: "已启用", visibility: "org-wide",
              currentVersionId: "sv-wave2", satisfaction: null, tags: [],
            },
            {
              skillId: "sk-form", name: "契约表单建的", duty: "普通职责说明",
              source: "自建", status: "草稿", visibility: "org-wide",
              currentVersionId: null, satisfaction: null, tags: [],
            },
          ],
          total: 2,
        }),
      );
      render(<SkillCatalogLive />);
      await waitFor(() => expect(screen.getByTestId("skill-catalog-list")).toBeTruthy());

      const editLink = screen.getByTestId("skill-catalog-edit-source") as HTMLAnchorElement;
      // 人类反馈（2026-08-17）：「编辑」现在打开独立页面，不再是同页 query 参数深链。
      expect(editLink.getAttribute("href")).toBe("/admin/skill/sk-wave2");

      // 普通行（未命中标记）仍然是原来的「查看契约」按钮，两者只能各出现一次。
      expect(screen.getAllByTestId("skill-catalog-detail")).toHaveLength(1);
      expect(screen.getAllByTestId("skill-catalog-edit-source")).toHaveLength(1);
    });
  });
});
