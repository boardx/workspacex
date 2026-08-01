/**
 * F39 -- REVIEW_PENDING 人工复核 + AI 补齐缺料 + 上传弹层幂等二选一（uc-22-2 R3 步骤 11 /
 * A3 / A4 / R8）。
 *
 * The UI for all three was already built ahead of this feature (`upload-modal.tsx`,
 * `review-panel.tsx`, `ingestion-drawer.tsx`, `use-review-state.ts`) -- this file is what was
 * missing: the assertions that lock the behaviour in, per the issue's named anchors
 * (`files-review-panel` / `files-review-accept` / `files-review-reject` / `files-review-pii` /
 * `files-upload-duplicate-choice` / `files-upload-use-existing` / `files-upload-as-new`).
 *
 * Three independent facts:
 *
 *   1. 幂等命中二选一默认「使用已有」（A3）-- 上传弹层。
 *   2. 复核批量视图（D-U11）：接受/拒绝前强制填写处置理由（≥4 字，写入审计的界面前置），
 *      PII 检出详情脱敏展示（O-39），处置后状态可见且不可二次处置。
 *   3. D-U11 的核心断言 -- 摄取抽屉是复核处置的权威入口，独立复核屏是同一动作的批量视图，
 *      两处共享 `useReviewState`：在复核屏接受一条，摄取抽屉里同一条（同 artifactId）立刻
 *      同步，不需要各自重新处置一遍。
 */
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { UploadModal } from "@/components/files/upload-modal";
import { ReviewPanel } from "@/components/files/review-panel";
import { IngestionDrawer } from "@/components/files/ingestion-drawer";
import { FILES, INGESTION_RUNS } from "@/lib/mock/files";

describe("上传弹层：幂等命中二选一，默认「使用已有」（A3）", () => {
  it("默认选中使用已有；切到「仍然作为新版本上传」后提示文案随之变化", () => {
    render(<UploadModal boundSegment={null} onClose={() => undefined} onSubmit={() => undefined} />);

    const useExisting = screen.getByTestId("files-upload-use-existing");
    const asNew = screen.getByTestId("files-upload-as-new");
    const choice = screen.getByTestId("files-upload-duplicate-choice");

    // 默认态：使用已有是当前选中项（primary 变体），文案说明复用旧版本。
    expect(choice.textContent).toContain("复用库中");

    fireEvent.click(asNew);
    expect(screen.getByTestId("files-upload-duplicate-choice").textContent).toContain("追加");

    fireEvent.click(useExisting);
    expect(screen.getByTestId("files-upload-duplicate-choice").textContent).toContain("复用库中");
  });
});

describe("复核批量视图（files-review-panel）：D-U11 批量视图", () => {
  it("待复核队列非空，默认展开第一条，PII 检出以脱敏形式展示（不回显真实值）", () => {
    render(<ReviewPanel />);
    expect(screen.getByTestId("files-review-panel")).toBeInTheDocument();

    const items = screen.getAllByTestId("files-review-queue-item");
    expect(items.length).toBeGreaterThan(0);

    const detail = screen.getByTestId("files-review-detail");
    // a-003（机密 + PII，队列首位）默认展开。
    const pii = within(detail).getByTestId("files-review-pii");
    expect(pii.textContent).not.toMatch(/1[3-9]\d{9}/); // 脱敏：不出现完整手机号
    expect(pii.textContent).toContain("脱敏展示");
  });

  it("处置理由少于 4 字时拒绝处置，并提示必须写理由（写入审计的前置校验）", () => {
    render(<ReviewPanel />);
    const detail = screen.getByTestId("files-review-detail");
    fireEvent.click(within(detail).getByTestId("files-review-accept"));

    expect(within(detail).getByTestId("files-review-note-required")).toBeInTheDocument();
    expect(screen.queryByTestId("files-review-resolved")).not.toBeInTheDocument();
  });

  it("填写足够长度的理由后可拒绝：状态可见，且不得二次处置", () => {
    render(<ReviewPanel />);
    const items = screen.getAllByTestId("files-review-queue-item");
    // 切到第二条（a-070，low-quality，非本测试要处置的机密材料），避免与其它 it() 产生
    // 跨用例的模块级共享状态干扰（`useReviewState` 是模块单例，见该文件自己的注释）。
    fireEvent.click(items[1]!);

    const detail = screen.getByTestId("files-review-detail");
    fireEvent.change(within(detail).getByTestId("files-review-note"), {
      target: { value: "解析质量过低，退回重新生成。" },
    });
    fireEvent.click(within(detail).getByTestId("files-review-reject"));

    const resolved = within(detail).getByTestId("files-review-resolved");
    expect(resolved.textContent).toContain("已拒绝");

    // 处置后按钮消失（不能二次处置同一条）。
    expect(within(detail).queryByTestId("files-review-accept")).not.toBeInTheDocument();
    expect(within(detail).queryByTestId("files-review-reject")).not.toBeInTheDocument();
  });
});

describe("D-U11：复核屏与摄取抽屉共享同一处置状态", () => {
  it("在复核屏接受 a-003 后，摄取抽屉里同一 artifactId（run-4）立刻显示已接受，无需重新处置", () => {
    const target = FILES.find((f) => f.id === "a-003");
    expect(target, "fixture a-003 missing").toBeTruthy();
    const run = INGESTION_RUNS.find((r) => r.artifactId === "a-003");
    expect(run, "fixture run pointing at a-003 missing").toBeTruthy();

    // ① 复核屏：定位到 a-003（队列首位），填理由后接受。
    render(<ReviewPanel />);
    const detailBefore = screen.getByTestId("files-review-detail");
    fireEvent.change(within(detailBefore).getByTestId("files-review-note"), {
      target: { value: "机密材料已确认由客户授权入库。" },
    });
    fireEvent.click(within(detailBefore).getByTestId("files-review-accept"));
    expect(within(detailBefore).getByTestId("files-review-resolved").textContent).toContain("已接受");

    // ② 摄取抽屉：同一 artifactId 的运行行不再显示接受/拒绝按钮，而是已同步的状态——
    // 这是 D-U11 的核心断言：两个挂载点读同一份 `useReviewState`，不是各自的本地状态。
    render(<IngestionDrawer onClose={() => undefined} />);
    const runCards = screen.getAllByTestId("files-ingestion-run");
    const card = runCards.find((c) => within(c).queryByText(run!.fileName));
    expect(card, "run-4 card not found").toBeTruthy();

    const status = within(card!).getByTestId("files-ingestion-review-status");
    expect(status.textContent).toContain("已接受并转 READY，进入检索召回");
    expect(within(card!).queryByTestId("files-ingestion-accept")).not.toBeInTheDocument();
    expect(within(card!).queryByTestId("files-ingestion-reject")).not.toBeInTheDocument();
  });
});
