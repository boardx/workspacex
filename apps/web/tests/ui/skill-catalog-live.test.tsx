/**
 * #520 —— `/skill` 的 Skill 库屏接真实 API 的**组件测试**。
 *
 * ⚠ **F192（design-delta `skill-model-a-b-convergence` 选项②，issue #598，
 * 2026-08-16 已签核）之后**：「完全新建（契约表单）」入口已下线，`POST /skills`
 * 恒 410——本文件里所有原来打 `POST /skills` 的创建流程测试已随之移除或改写。
 * 「入口不可达」这条本身的反证锚在专门的 `skill-catalog-no-create-panel.test.tsx`，
 * 本文件此后只保留**未受本次收敛影响**的既有覆盖（空态 / 失败态 / tag 过滤 /
 * 导入路径 / G3 弹窗 / G2/G6 A-B 分流）。
 *
 * 这里的 `fetch` 是假的。组件测试里的「刷新」只是再调一次这个假 `fetch`，它**永远**
 * 分不出「写进了库」和「写进了 React state」。持久化那一条只有真实浏览器 +
 * 真实 PostgreSQL 证得了——真实写路径已经没有了，所以本文件不再需要那条持久化证明；
 * 唯一仍然真实存在的写路径（URL 导入）由下方「从 GitHub 导入」那条测试覆盖。
 *
 * 这里证的是**请求与渲染的形状**：
 *   ① 空结果渲染**真实空态**，不生成任何示例 skill；
 *   ② 列表读取失败态回显后端**真实错误信封**：reasonCode ＋ HTTP 状态，不糊成「加载失败」；
 *   ③ tag 过滤真的生效；
 *   ④ 「从 GitHub 导入」打的是契约的路径与方法，成功后真的刷新列表。
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
   * 2026-08-13 —— 「新建 Skill」曾有三条路径（人类拿两张后台原型截图核对）。
   *
   * ⚠ **F192（design-delta `skill-model-a-b-convergence` 选项②）之后只剩两条**：
   * 「完全新建（契约表单）」已下线（`POST /skills` 恒 410），默认 tab 从它改成
   * 「从 GitHub 导入」——「入口彻底不可达」这条本身的反证锚在专门的
   * `skill-catalog-no-create-panel.test.tsx`，这里保留的两条仍然真实有效：
   *   · 「从 GitHub 导入」tab 打开的就是真实组件 `SkillUrlImportPanel`，
   *     点「确认导入」真的打 `POST /admin/skills/url-imports`，请求体形状对，
   *     导入成功后真的触发一次 `GET /skills` 刷新（`onImported` 接的是真实 `load`）。
   *   · 「从市场挑一个改」tab 只显示「未接后端」的如实说明，**不发任何网络请求**——
   *     防止有人为了让界面看起来完整而悄悄塞进 mock 数字或死按钮。
   */
  describe("新建 Skill 两条路径（F192 之后）", () => {
    it("默认 tab 是「从 GitHub 导入」：点 skill-create-open 后 SkillUrlImportPanel 立即可见，不需要先选 tab", async () => {
      install(() => jsonResponse({ items: [], total: 0 }));
      render(<SkillCatalogLive />);
      await waitFor(() => expect(screen.getByTestId("skill-catalog-empty")).toBeTruthy());

      fireEvent.click(screen.getByTestId("skill-create-open"));
      expect(screen.getByTestId("skill-create-mode-import").getAttribute("aria-pressed")).toBe("true");
      expect(screen.getByTestId("skill-url-import-panel")).toBeTruthy();
      expect(screen.queryByTestId("skill-create-panel")).toBeNull();
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
   * G5（2026-08-14，人类原话：「新建的时候要支持添加tags」）—— 契约字段
   * `tags?: string[]`（design delta：`phases/phase-01-run-a-project/design-deltas/
   * skill-tags/`）。
   *
   * ⚠ **F192 之后**：「提交时 tags 输入框随请求体一起发出」那条用例随「完全新建」
   *   表单一起下线了（`skill-create-tags` 输入框只存在于那个已移除的面板里，
   *   本轮任何真实入口都不再提供填 tags 的表单）。保留渲染那一半——`tags` 仍是
   *   `SkillListItem` 的既有字段，列表渲染逻辑本身没有变化，仍需要覆盖。
   */
  describe("G5：卡片上能看见 tags", () => {
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
    it("duty 命中标记的行显示「编辑源码」链接，目标是 ?screen=catalog&edit=<skillId>；普通行仍是「查看契约」", async () => {
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
      expect(editLink.getAttribute("href")).toContain("screen=catalog");
      expect(editLink.getAttribute("href")).toContain("edit=sk-wave2");

      // 普通行（未命中标记）仍然是原来的「查看契约」按钮，两者只能各出现一次。
      expect(screen.getAllByTestId("skill-catalog-detail")).toHaveLength(1);
      expect(screen.getAllByTestId("skill-catalog-edit-source")).toHaveLength(1);
    });
  });
});
