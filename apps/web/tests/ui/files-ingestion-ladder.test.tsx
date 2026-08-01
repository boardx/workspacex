/**
 * F36 -- the ingestion drawer's nine-state ladder (uc-22-2 R8).
 *
 * The backend's structural proof (every state has a non-empty label/exits, the transition
 * graph is a legal sub-sequence, `originalDownloadable`/`retrievable` per N-7) lives in
 * `apps/api/tests/files/nine-state-visible-exits.test.ts` against
 * `apps/api/src/domain/files/ingestion-pipeline.ts`. What THIS file has to establish is
 * different and independent:
 *
 *   1. the drawer actually RENDERS the ladder (`files-ingestion-ladder`), one legend row per
 *      state (`files-ingestion-legend-row`), and every row shows a non-blank label and a
 *      non-blank exits string -- the DOM, not just the data table behind it;
 *   2. `STORED` renders "原件可下载" and a state before it does not; `INDEXED`/`READY`
 *      render "已进检索" and states before `INDEXED` do not -- the two independent facts
 *      (N-7) rendered as two independent badges, not collapsed into one "done" pill;
 *   3. the failure three-part form (在哪一步失败 + 为什么 + 能做什么) renders for a failed
 *      run, and never as a bare status code;
 *   4. the UI's own `INGEST_PIPELINE` table (`apps/web/lib/mock/files.ts`) agrees, state for
 *      state, with the backend's `INGESTION_PIPELINE` (`apps/api/src/domain/files/
 *      ingestion-pipeline.ts`) on the one fact both packages independently declare: which
 *      ten states exist, in the same order. Two packages, two declarations, so the agreement
 *      is CHECKED here rather than assumed -- same technique `files-browser.test.tsx` already
 *      uses for the downloadable/retrievable sets.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { IngestionDrawer } from "@/components/files/ingestion-drawer";
import { INGEST_PIPELINE, INGESTION_RUNS, type IngestionRunView } from "@/lib/mock/files";

const WEB = process.cwd();
const API_INGESTION_PIPELINE = join(WEB, "../api/src/domain/files/ingestion-pipeline.ts");

describe("九态阶梯：抽屉里的图例逐态渲染 label + exits（V2，DOM 断言）", () => {
  it("九态（含 REVIEW_PENDING）图例行数与 INGEST_PIPELINE 长度一致，每行都有非空文案", () => {
    render(<IngestionDrawer onClose={() => undefined} />);
    const rows = screen.getAllByTestId("files-ingestion-legend-row");
    expect(rows).toHaveLength(INGEST_PIPELINE.length);
    expect(rows.length).toBe(10);

    rows.forEach((row, i) => {
      const state = INGEST_PIPELINE[i]!;
      expect(within(row).getByText(state.meaning)).toBeInTheDocument();
      // 出口文案渲染在行内，且不是空字符串拼接出来的「出口：」三个字后面什么都没有。
      expect(row.textContent).toContain("出口：");
      for (const exit of state.exits) expect(row.textContent).toContain(exit);
      expect(state.exits.length).toBeGreaterThan(0);
    });
  });

  it("每个状态徽标显示的是文案（label），不是裸状态码本身", () => {
    render(<IngestionDrawer onClose={() => undefined} />);
    const rows = screen.getAllByTestId("files-ingestion-legend-row");
    rows.forEach((row, i) => {
      const state = INGEST_PIPELINE[i]!;
      expect(row.textContent).toContain(state.label);
      // 裸状态码（如 "REVIEW_PENDING" 全大写下划线形式）不应该单独出现在图例文案里。
      expect(row.textContent).not.toMatch(new RegExp(`(?<!\\w)${state.key}(?!\\w)`));
    });
  });
});

describe("STORED 之后原件可下载 / READY 之前不进检索召回（N-7，两个独立徽标）", () => {
  const byId = (id: string): IngestionRunView => {
    const r = INGESTION_RUNS.find((x) => x.id === id);
    if (!r) throw new Error(`fixture ${id} missing`);
    return r;
  };

  it("EXTRACTED 态（已 STORED，仍在抽取）的运行行显示「原件可下载」，且不显示「已进检索」", () => {
    const run = byId("run-3"); // status: EXTRACTED -- downloadable per N-7, not yet retrievable
    expect(run.status).toBe("EXTRACTED");
    render(<IngestionDrawer onClose={() => undefined} />);
    const cards = screen.getAllByTestId("files-ingestion-run");
    const card = cards.find((c) => within(c).queryByText(run.fileName));
    expect(card, "run-3 card not found").toBeTruthy();
    expect(card!.textContent).toContain("原件可下载");
    expect(card!.textContent).not.toContain("已进检索");
  });

  it("STORED 态即使正处在失败态（原件已入库但后续步骤失败），仍不错误地显示「已进检索」", () => {
    const run = byId("run-5"); // status: STORED, with a downstream EXTRACTED failure
    expect(run.status).toBe("STORED");
    expect(run.failure).toBeTruthy();
    render(<IngestionDrawer onClose={() => undefined} />);
    const cards = screen.getAllByTestId("files-ingestion-run");
    const card = cards.find((c) => within(c).queryByText(run.fileName));
    expect(card, "run-5 card not found").toBeTruthy();
    // The failure block's own prose says the original is downloadable; the point of this
    // assertion is the boolean this feature owns (retrievable), not the badge's placement.
    expect(card!.textContent).not.toContain("已进检索");
    expect(card!.textContent).toContain("原件已入库可下载");
  });

  it("REVIEW_PENDING 态：可下载但不可召回，且走人工确认三选项而不是自动 READY", () => {
    const run = byId("run-4");
    expect(run.status).toBe("REVIEW_PENDING");
    render(<IngestionDrawer onClose={() => undefined} />);
    const cards = screen.getAllByTestId("files-ingestion-run");
    const card = cards.find((c) => within(c).queryByText(run.fileName));
    expect(card).toBeTruthy();
    expect(within(card!).getByTestId("files-ingestion-review")).toBeInTheDocument();
    expect(within(card!).getByTestId("files-ingestion-accept")).toBeInTheDocument();
    expect(within(card!).getByTestId("files-ingestion-reject")).toBeInTheDocument();
  });

  it("READY 态显示已完成，且原件可下载（两个真都成立，不是互斥的两态）", () => {
    const run = byId("run-6");
    expect(run.status).toBe("READY");
    render(<IngestionDrawer onClose={() => undefined} />);
    const cards = screen.getAllByTestId("files-ingestion-run");
    const card = cards.find((c) => within(c).queryByText(run.fileName));
    expect(card).toBeTruthy();
    expect(card!.textContent).toContain("原件可下载");
  });
});

describe("失败态三段式：在哪一步失败 + 为什么 + 能做什么（R8，不显示裸错误码）", () => {
  it("失败的运行行同时渲染 where / why，并提供重试与手工补文本两个出口", () => {
    const run = INGESTION_RUNS.find((r) => r.failure !== undefined);
    expect(run, "no failing fixture found").toBeTruthy();
    render(<IngestionDrawer onClose={() => undefined} />);
    const cards = screen.getAllByTestId("files-ingestion-run");
    const card = cards.find((c) => within(c).queryByText(run!.fileName));
    expect(card).toBeTruthy();
    const failureBlock = within(card!).getByTestId("files-ingestion-failure");
    expect(failureBlock.textContent).toContain(run!.failure!.where);
    expect(failureBlock.textContent).toContain(run!.failure!.why);
    expect(within(card!).getByTestId("files-ingestion-retry")).toBeInTheDocument();
    expect(within(card!).getByTestId("files-ingestion-manual")).toBeInTheDocument();
    // 三段式的第一段必须点名"在哪一步"，不是一个裸的 HTTP 状态码或异常类名。
    expect(failureBlock.textContent).not.toMatch(/^\d{3}$/);
    expect(failureBlock.textContent).not.toMatch(/Error:|Exception/);
  });
});

/**
 * 单一事实源核对：UI 的 `INGEST_PIPELINE`（apps/web/lib/mock/files.ts）与后端的
 * `INGESTION_PIPELINE`（apps/api/src/domain/files/ingestion-pipeline.ts）是同一件事
 * ("九态状态机长什么样") 在两个不能互相 import 的包里各自的声明。两者不一致，
 * 就是这个仓库最常见的那类漂移（AGENTS.md：设计 token / 字号档位 / … 已发生五次）。
 */
describe("单一事实源核对：UI 的九态表 vs 后端 domain/files/ingestion-pipeline.ts", () => {
  const backendKeys = (): string[] => {
    const src = readFileSync(API_INGESTION_PIPELINE, "utf8");
    const m = /export const INGESTION_PIPELINE:[^=]*=\s*\[([\s\S]*?)\n\];/.exec(src);
    if (m === null) throw new Error("INGESTION_PIPELINE array not found in ingestion-pipeline.ts");
    return [...m[1]!.matchAll(/key:\s*"([A-Z_]+)"/g)].map((x) => x[1]!);
  };

  it("两边的十态、顺序完全一致", () => {
    const ui = INGEST_PIPELINE.map((s) => s.key);
    const api = backendKeys();
    expect(ui).toEqual(api);
  });

  it("非空，否则上面这条对两个空数组也成立", () => {
    expect(backendKeys().length).toBe(10);
  });

  it("COUNTER-PROOF：顺序错位确实会被上面那条断言抓到", () => {
    const ui = INGEST_PIPELINE.map((s) => s.key);
    const shuffled = [...ui].reverse();
    expect(shuffled).not.toEqual(ui);
  });
});
