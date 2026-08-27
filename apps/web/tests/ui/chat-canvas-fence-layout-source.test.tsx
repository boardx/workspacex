/**
 * #2221 回归钉子：chat 内置 canvas 模板渲染要读 `layoutSource`，不能因为「组织库里
 * 有这个内置 key 的行」就当作已自定义（`backfill-canvas-builtin-templates.ts` 给每个
 * 开通过的组织都建好了这一行，"有行"对 19 个内置 key 恒真）。
 *
 * 只验**分派判据**（builtin vs org-generated 走哪条），不验几何像素——那是
 * `auto-template-layout.test.ts` 的范围，fabric 画布本身需要真实 canvas context，
 * 这里同 `chat-canvas-fence.test.tsx` 一样只验到 `data-template-source`。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MarkdownMessage } from "@/components/chat/markdown-message";
import { __resetFenceTemplateCache } from "@/lib/canvas/fence-template-resolver";

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    parse: vi.fn().mockResolvedValue(true),
    render: vi.fn().mockResolvedValue({ svg: "<svg></svg>" }),
  },
}));

const listCanvasTemplates = vi.fn();
vi.mock("@/lib/live-canvas", () => ({
  listCanvasTemplates: (...args: unknown[]) => listCanvasTemplates(...args),
}));

vi.mock("@/components/session/session-provider", () => ({
  useOptionalSession: () => ({ session: { currentOrgId: "org-signoff-1" } }),
}));

/** 一行 backfill/编辑器可能产出的 `persona` 行——内置 key，非内置 key 的字段照抄既有测试。 */
function personaRow(over: Record<string, unknown> = {}) {
  return {
    key: "persona",
    displayName: "用户画像",
    version: 3,
    status: "published",
    builtin: true,
    visibility: "org-wide",
    underlyingType: "canvas",
    usageCount: 7,
    sections: [
      { sectionId: "who", name: "是谁", order: 0, required: true, capacity: 6 },
      { sectionId: "goal", name: "目标", order: 1, required: true, capacity: 6 },
    ],
    layoutSource: "builtin-derived",
    ...over,
  };
}

const PERSONA_FENCE = [
  "```canvas",
  "模板: persona",
  "姓名: 林可",
  "## 用户描述",
  "- 项目型采购",
  "```",
].join("\n");

beforeEach(() => {
  __resetFenceTemplateCache();
  listCanvasTemplates.mockReset();
});

describe("#2221：内置 key 的 layoutSource 判据", () => {
  it("组织库里有 persona 行，但 layoutSource 是 builtin-derived（backfill 默认值）→ " +
    "仍用内置原生几何，不当作已自定义（这正是 #2221 之前的 bug：以前『有行就当自定义』）", async () => {
    listCanvasTemplates.mockResolvedValue({ templates: [personaRow({ layoutSource: "builtin-derived" })] });
    render(<MarkdownMessage text={PERSONA_FENCE} />);
    const el = await screen.findByTestId("chat-canvas-fabric");
    expect(el.getAttribute("data-template-source")).toBe("builtin");
  });

  it("组织真的在编辑器里自定义过 persona（layoutSource: user-edited）→ " +
    "渲染走组织自定义的几何，不是内置默认值——这是 #2221 要修的行为本身", async () => {
    listCanvasTemplates.mockResolvedValue({
      templates: [personaRow({ layoutSource: "user-edited", displayName: "自定义用户画像" })],
    });
    render(<MarkdownMessage text={PERSONA_FENCE} />);
    const el = await screen.findByTestId("chat-canvas-fabric");
    expect(el.getAttribute("data-template-source")).toBe("org-generated");
    const { getTemplate } = await import("@repo/fabric-markdown");
    expect(getTemplate("persona")?.title).toBe("自定义用户画像");
  });

  it("同一 key 多版本，只有最高版本是 user-edited 时才采用它；最高版本若是 " +
    "builtin-derived 则不采用，即便更早的版本曾是 user-edited（判据只看『用这个模板』" +
    "此刻用的是哪一行，即最高版本）", async () => {
    listCanvasTemplates.mockResolvedValue({
      templates: [
        personaRow({ version: 2, layoutSource: "user-edited", displayName: "旧版自定义" }),
        personaRow({ version: 3, layoutSource: "builtin-derived", displayName: "新版但未自定义" }),
      ],
    });
    render(<MarkdownMessage text={PERSONA_FENCE} />);
    const el = await screen.findByTestId("chat-canvas-fabric");
    expect(el.getAttribute("data-template-source")).toBe("builtin");
  });

  it("查询组织模板库失败时，内置 key 仍优雅退回原生几何渲染，不炸围栏", async () => {
    listCanvasTemplates.mockRejectedValue(new Error("DEPENDENCY_UNAVAILABLE"));
    render(<MarkdownMessage text={PERSONA_FENCE} />);
    const el = await screen.findByTestId("chat-canvas-fabric");
    expect(el.getAttribute("data-template-source")).toBe("builtin");
    expect(screen.queryByTestId("chat-canvas-error")).toBeNull();
  });

  it("一条消息里两个内置围栏，只打一次 listCanvasTemplates（30 秒缓存摊薄新增的这一跳）", async () => {
    listCanvasTemplates.mockResolvedValue({ templates: [personaRow({ layoutSource: "builtin-derived" })] });
    const text = `${PERSONA_FENCE}\n\n中间一段\n\n${PERSONA_FENCE}`;
    render(<MarkdownMessage text={text} />);
    await screen.findAllByTestId("chat-canvas-fabric");
    expect(listCanvasTemplates).toHaveBeenCalledTimes(1);
  });
});
