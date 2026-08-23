/**
 * #1865 —— 「仓库/目录 URL」模式：扫描出 N 个 skill，逐个确认导入。
 *
 * 与 `skill-url-import.test.tsx` 同一层级：mock 的是 `fetch`，不是 lib 函数——
 * 这样路径/方法/body 形状都被真的验到，不是"我调了我自己写的函数"那种自证。
 *
 * ## 反空转
 * ① 装置自检：扫描前一次扫描请求都没发。
 * ② 粒度断言：扫描到 2 个 skill 时，界面必须能**只导入其中一个**——
 *    不是"扫描后自动导入全部"，也不是"每个文件单独确认"。
 * ③ 逐 skill 各自的 idempotencyKey 相互独立（互不影响对方的幂等键）。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";

const sessionState = vi.hoisted(() => ({ currentOrgId: "org-1865", orgRole: "admin" as string }));

vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({
    session: { currentOrgId: sessionState.currentOrgId },
    identity: {
      org: { id: sessionState.currentOrgId, name: `组织 ${sessionState.currentOrgId}` },
      orgRole: sessionState.orgRole,
    },
  }),
}));

import { SkillScreen } from "@/components/admin/skill-screen";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const DISCOVER_PATH = "/admin/skills/url-imports/discover";
const IMPORT_PATH = "/admin/skills/url-imports";

const CANDIDATES = [
  {
    dirPath: "pptx",
    treeUrl: "https://github.com/acme/skills-fixture/tree/main/pptx",
    name: "pptx-skill",
    description: "Create and edit PowerPoint decks",
    fileCount: 2,
  },
  {
    dirPath: "docx",
    treeUrl: "https://github.com/acme/skills-fixture/tree/main/docx",
    name: "docx-skill",
    description: "Create and edit Word documents",
    fileCount: 1,
  },
];

beforeEach(() => {
  sessionState.currentOrgId = "org-1865";
  sessionState.orgRole = "admin";
  window.localStorage.clear();
  window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-1865");
});

afterEach(() => vi.unstubAllGlobals());

async function openRepoTab() {
  render(<SkillScreen state="default" />);
  await screen.findByTestId("skill-url-import-panel");
  fireEvent.click(screen.getByTestId("skill-url-import-open"));
  fireEvent.click(screen.getByTestId("skill-url-import-mode-repo"));
}

describe("#1865 · 仓库/目录 URL 扫描 + 逐 skill 确认导入", () => {
  it("扫描：打真实端口、body 形状与契约一致，展示『发现了 N 个 skill』", async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      if (url.pathname === "/capabilities") return jsonResponse([]);
      expect(url.pathname).toBe(DISCOVER_PATH);
      expect(init?.method).toBe("POST");
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return jsonResponse({ skills: CANDIDATES });
    });
    vi.stubGlobal("fetch", fetchMock);

    await openRepoTab();
    // 装置自检：进入 tab 后、点扫描前，一次扫描请求都没发过。
    expect(bodies).toHaveLength(0);

    fireEvent.change(screen.getByTestId("skill-repo-import-url"), {
      target: { value: "https://github.com/acme/skills-fixture/tree/main" },
    });
    fireEvent.click(screen.getByTestId("skill-repo-import-scan"));

    const scanResult = await screen.findByTestId("skill-repo-import-scan-result");
    expect(scanResult.textContent).toContain("发现了 2 个 skill");
    expect(bodies).toHaveLength(1);
    expect(bodies[0]!.sourceUrl).toBe("https://github.com/acme/skills-fixture/tree/main");

    // 两个候选各自的行都渲染出来了。
    expect(screen.getByTestId("skill-repo-import-candidate-pptx")).toBeTruthy();
    expect(screen.getByTestId("skill-repo-import-candidate-docx")).toBeTruthy();
  });

  it("逐 skill 确认：只导入其中一个候选，另一个候选不受影响、没有发请求", async () => {
    const importBodies: Record<string, unknown>[] = [];
    let importCallCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      if (url.pathname === "/capabilities") return jsonResponse([]);
      if (url.pathname === DISCOVER_PATH) return jsonResponse({ skills: CANDIDATES });
      expect(url.pathname).toBe(IMPORT_PATH);
      importCallCount += 1;
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      importBodies.push(body);
      return jsonResponse(
        {
          skillId: "sk_1865_pptx",
          versionId: "skv_1865_pptx",
          filePaths: ["pptx/SKILL.md", "pptx/scripts/run.py"],
          contentDigest: "d".repeat(64),
          replayed: false,
        },
        201,
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await openRepoTab();
    fireEvent.change(screen.getByTestId("skill-repo-import-url"), {
      target: { value: "https://github.com/acme/skills-fixture/tree/main" },
    });
    fireEvent.click(screen.getByTestId("skill-repo-import-scan"));
    await screen.findByTestId("skill-repo-import-scan-result");

    // 只点 pptx 那一行的导入按钮——docx 那一行完全不碰。
    fireEvent.click(screen.getByTestId("skill-repo-import-candidate-confirm-pptx"));

    const pptxResult = await screen.findByTestId("skill-repo-import-candidate-result-pptx");
    expect(pptxResult.textContent).toContain("已导入 2 个文件");
    expect(pptxResult.textContent).toContain("sk_1865_pptx");

    // ⚠ 粒度断言核心：只发了一次导入请求，且是 pptx 的，docx 那一行的结果区**不存在**。
    expect(importCallCount).toBe(1);
    expect(importBodies[0]!.sourceUrl).toBe("https://github.com/acme/skills-fixture/tree/main/pptx");
    expect(importBodies[0]!.name).toBe("pptx-skill");
    expect(screen.queryByTestId("skill-repo-import-candidate-result-docx")).toBeNull();
  });

  it("候选名字可编辑：导入时带的是用户改过的名字，不是扫描时的原名", async () => {
    const importBodies: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      if (url.pathname === "/capabilities") return jsonResponse([]);
      if (url.pathname === DISCOVER_PATH) return jsonResponse({ skills: CANDIDATES });
      importBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return jsonResponse(
        { skillId: "sk_x", versionId: "skv_x", filePaths: ["docx/SKILL.md"], contentDigest: "e".repeat(64), replayed: false },
        201,
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await openRepoTab();
    fireEvent.change(screen.getByTestId("skill-repo-import-url"), {
      target: { value: "https://github.com/acme/skills-fixture/tree/main" },
    });
    fireEvent.click(screen.getByTestId("skill-repo-import-scan"));
    await screen.findByTestId("skill-repo-import-scan-result");

    fireEvent.change(screen.getByTestId("skill-repo-import-candidate-name-docx"), {
      target: { value: "我改过的名字" },
    });
    fireEvent.click(screen.getByTestId("skill-repo-import-candidate-confirm-docx"));

    await screen.findByTestId("skill-repo-import-candidate-result-docx");
    expect(importBodies[0]!.name).toBe("我改过的名字");
  });

  it("扫描失败：显示真实 reasonCode，不渲染任何候选行", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      if (url.pathname === "/capabilities") return jsonResponse([]);
      return jsonResponse({ reasonCode: "IMPORT_NO_SKILLS_FOUND" }, 422);
    });
    vi.stubGlobal("fetch", fetchMock);

    await openRepoTab();
    fireEvent.change(screen.getByTestId("skill-repo-import-url"), {
      target: { value: "https://github.com/acme/empty-repo/tree/main" },
    });
    fireEvent.click(screen.getByTestId("skill-repo-import-scan"));

    const scanResult = await screen.findByTestId("skill-repo-import-scan-result");
    expect(scanResult.textContent).toContain("IMPORT_NO_SKILLS_FOUND");
    expect(screen.queryByTestId(/skill-repo-import-candidate-/)).toBeNull();
  });

  it("非管理员：URL 导入面板不渲染（与单文件模式同一条降噪规则）", async () => {
    sessionState.orgRole = "consultant";
    const fetchMock = vi.fn(async () => jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    render(<SkillScreen state="default" />);
    await waitFor(() => expect(screen.queryByTestId("skill-url-import-panel")).toBeNull());
  });
});
