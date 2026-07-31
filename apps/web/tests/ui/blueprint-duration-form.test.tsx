import { describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  BlueprintDurationForm,
  type BlueprintDurationFormProps,
} from "@/components/tpl-designer/blueprint-duration-form";
import { AGENDA_TIER_CATALOG } from "@/lib/generated/agenda-tier-catalog";

/**
 * F19 —— 「时长档位 · 形式 · 语言」表单的界面（`uc-2-1` R3 步骤 1–2）。
 *
 * 同 `blueprint-designer-shell.test.tsx`（F18）的两条纪律：
 *   ① 第一条先证明生成的目录没有漂移（机械门控，不是靠人看）；
 *   ② 断言的是集合/内容对不对，不是数量本身对不对（虽然这里数量恰好也是可断言的，
 *      因为 R3 主表本就给了确定的四个数字）。
 */

const baseProps: BlueprintDurationFormProps = {
  durationTier: "two-day",
  agendaSegmentCount: 14,
  format: "hybrid",
  language: "bilingual",
  pendingTierChange: null,
  onlineAutoSegments: [],
  onSelectTier: vi.fn(),
  onConfirmTierChange: vi.fn(),
  onCancelTierChange: vi.fn(),
  onSelectFormat: vi.fn(),
  onSelectLanguage: vi.fn(),
};

const renderForm = (patch: Partial<BlueprintDurationFormProps> = {}) => {
  render(<BlueprintDurationForm {...baseProps} {...patch} />);
  return screen.getByTestId("bp-duration-form");
};

describe("时长档位目录来自定义表（而不是前端自己列的一份 7/11/14/19）", () => {
  it("生成的档位目录与后端定义表没有漂移（机械门控，不是靠人看）", () => {
    const apiDir = join(process.cwd(), "..", "api");
    const out = execFileSync("pnpm", ["exec", "tsx", "scripts/gen-agenda-tier-catalog.ts", "--check"], {
      cwd: apiDir,
      encoding: "utf8",
    });
    expect(out).toContain("in sync");
    expect(AGENDA_TIER_CATALOG.length).toBeGreaterThan(0);
  });

  it("四档 · 议程环节数逐一对照 R3 主表：半天7/一天11/两天14/三天19", () => {
    renderForm();
    expect(screen.getByTestId("bp-duration-tier-half-day")).toHaveTextContent("7 环节");
    expect(screen.getByTestId("bp-duration-tier-one-day")).toHaveTextContent("11 环节");
    expect(screen.getByTestId("bp-duration-tier-two-day")).toHaveTextContent("14 环节");
    expect(screen.getByTestId("bp-duration-tier-three-day")).toHaveTextContent("19 环节");
  });

  it("当前档位被选中态标出（aria-pressed）", () => {
    renderForm({ durationTier: "three-day" });
    expect(screen.getByTestId("bp-duration-tier-three-day")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("bp-duration-tier-two-day")).toHaveAttribute("aria-pressed", "false");
  });

  it("点击档位调用 onSelectTier，且传入被点击的那个档位", () => {
    const onSelectTier = vi.fn();
    renderForm({ onSelectTier });
    fireEvent.click(screen.getByTestId("bp-duration-tier-half-day"));
    expect(onSelectTier).toHaveBeenCalledWith("half-day");
  });

  it("总环节数用服务端给的那个数，不是前端自己数档位表", () => {
    // 刻意让 agendaSegmentCount 与档位表的数字不一致（模拟「全线上」+2 之后的总数）：
    // 前端若是自己数，这里会显示档位表的 14 而不是服务端给的 16
    renderForm({ agendaSegmentCount: 16 });
    expect(screen.getByTestId("bp-duration-agenda-count")).toHaveTextContent("16 环节");
  });

  it("『可选环节自动增删，必留环节只压缩时间』规则句原样呈现", () => {
    renderForm();
    expect(screen.getByTestId("bp-duration-tier-rule")).toHaveTextContent(
      "可选环节自动增删，必留环节只压缩时间。",
    );
  });
});

describe("换档位确认框（G-3：会丢内容时才出现）", () => {
  it("pendingTierChange 为 null 时不渲染确认框", () => {
    renderForm();
    expect(screen.queryByTestId("bp-duration-tier-confirm")).toBeNull();
  });

  it("有 pendingTierChange 时渲染确认框，逐项列出将移除的环节，并提示可恢复", () => {
    renderForm({
      pendingTierChange: {
        targetTier: "half-day",
        added: [],
        removed: [
          { agendaSegmentId: "iteration-landing-plan-1", title: "迭代与落地计划环节 1" },
          { agendaSegmentId: "prototype-user-testing-1", title: "原型与用户测试环节 1" },
        ],
      },
    });
    const dialog = screen.getByTestId("bp-duration-tier-confirm");
    expect(dialog).toHaveAttribute("role", "alertdialog");
    expect(dialog).toHaveTextContent("移除 2 个议程环节");
    expect(screen.getByTestId("bp-duration-tier-confirm-removed")).toHaveTextContent("迭代与落地计划环节 1");
    expect(screen.getByTestId("bp-duration-tier-confirm-removed")).toHaveTextContent("原型与用户测试环节 1");
    expect(dialog).toHaveTextContent("切回该档位可恢复");
    // 没有新增时不渲染「将新增」区块
    expect(screen.queryByTestId("bp-duration-tier-confirm-added")).toBeNull();
  });

  it("确认/取消按钮各自调用对应回调", () => {
    const onConfirmTierChange = vi.fn();
    const onCancelTierChange = vi.fn();
    renderForm({
      pendingTierChange: { targetTier: "half-day", added: [], removed: [{ agendaSegmentId: "x", title: "x" }] },
      onConfirmTierChange,
      onCancelTierChange,
    });
    fireEvent.click(screen.getByTestId("bp-duration-tier-confirm-confirm"));
    expect(onConfirmTierChange).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("bp-duration-tier-confirm-cancel"));
    expect(onCancelTierChange).toHaveBeenCalledTimes(1);
    expect(onConfirmTierChange).toHaveBeenCalledTimes(1);
  });

  it("升档（只增不减）也可以带 pendingTierChange 展示新增内容，但不必然出现——本组件只按 props 渲染", () => {
    renderForm({
      pendingTierChange: {
        targetTier: "three-day",
        added: [{ agendaSegmentId: "iteration-landing-plan-1", title: "迭代与落地计划环节 1" }],
        removed: [],
      },
    });
    expect(screen.getByTestId("bp-duration-tier-confirm-added")).toHaveTextContent("迭代与落地计划环节 1");
    expect(screen.queryByTestId("bp-duration-tier-confirm-removed")).toBeNull();
    expect(screen.getByTestId("bp-duration-tier-confirm")).toHaveTextContent("移除 0 个议程环节");
  });
});

describe("形式三选一：选『全线上』展示自动追加的两个环节", () => {
  it("三个形式按钮都在，当前形式选中态标出", () => {
    renderForm({ format: "onsite" });
    expect(screen.getByTestId("bp-format-hybrid")).toHaveTextContent("混合");
    expect(screen.getByTestId("bp-format-onsite")).toHaveTextContent("线下");
    expect(screen.getByTestId("bp-format-online")).toHaveTextContent("全线上");
    expect(screen.getByTestId("bp-format-onsite")).toHaveAttribute("aria-pressed", "true");
  });

  it("点击形式调用 onSelectFormat", () => {
    const onSelectFormat = vi.fn();
    renderForm({ onSelectFormat });
    fireEvent.click(screen.getByTestId("bp-format-online"));
    expect(onSelectFormat).toHaveBeenCalledWith("online");
  });

  it("说明原话原样呈现：全线上会自动加破冰和举手排队两个议程环节", () => {
    renderForm();
    expect(screen.getByTestId("bp-format-online-note")).toHaveTextContent(
      "混合＝线下分组＋远程组员用手机进组；选「全线上」会自动加「破冰」和「举手排队」两个议程环节。",
    );
  });

  it("非『全线上』形式下不展示自动环节区块", () => {
    renderForm({ format: "hybrid", onlineAutoSegments: [] });
    expect(screen.queryByTestId("bp-online-auto-segments")).toBeNull();
  });

  it("『全线上』形式下展示当前生效的自动环节，并标明来源与可移除方式", () => {
    renderForm({
      format: "online",
      onlineAutoSegments: [
        { agendaSegmentId: "icebreaker", title: "破冰" },
        { agendaSegmentId: "hand-raise-queue", title: "举手排队" },
      ],
    });
    const list = screen.getByTestId("bp-online-auto-segments");
    expect(list).toHaveTextContent("破冰");
    expect(list).toHaveTextContent("举手排队");
    expect(screen.getByTestId("bp-online-auto-segment-icebreaker")).toHaveTextContent("来源：形式设置");
    expect(screen.queryByTestId("bp-online-auto-segments-empty")).toBeNull();
  });

  it("『全线上』但自动环节尚未生效时显式空态，不是假装什么都没发生", () => {
    renderForm({ format: "online", onlineAutoSegments: [] });
    expect(screen.getByTestId("bp-online-auto-segments-empty")).toBeVisible();
  });
});

describe("语言三选一：影响产出与报告模板语言", () => {
  it("三个语言按钮都在，当前语言选中态标出", () => {
    renderForm({ language: "en" });
    expect(screen.getByTestId("bp-language-zh")).toHaveTextContent("中文");
    expect(screen.getByTestId("bp-language-en")).toHaveTextContent("English");
    expect(screen.getByTestId("bp-language-bilingual")).toHaveTextContent("双语现场");
    expect(screen.getByTestId("bp-language-en")).toHaveAttribute("aria-pressed", "true");
  });

  it("点击语言调用 onSelectLanguage", () => {
    const onSelectLanguage = vi.fn();
    renderForm({ onSelectLanguage });
    fireEvent.click(screen.getByTestId("bp-language-bilingual"));
    expect(onSelectLanguage).toHaveBeenCalledWith("bilingual");
  });

  it("语言影响产出与报告模板生成语言的说明句原样呈现", () => {
    renderForm();
    expect(screen.getByTestId("bp-language-note")).toHaveTextContent("语言影响产出物与报告模板的生成语言。");
  });
});
