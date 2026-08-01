/**
 * F146 —— 研究列表三处渲染 + 归档不删除（`uc-24-3` R3.A/B/C / R7.3 / V4，
 * `research` 束 domain.md N-7 / N-8）。
 *
 * `RsListScreen`（`apps/web/components/research-studio/rs-screens.tsx`）与它的
 * mock 数据源（`apps/web/lib/mock/research-studio.ts`）在 F144 之前就已由
 * ui-prototyper 建成。本文件是 F146 的机械判据：
 *   ① 卡片「证据 X / 目标 Y」的分子跟着数据走，目标缺失渲染 `—` 而不是 `0`；
 *   ② Studio 左栏研究三段各自独立渲染；
 *   ③ 归档不是删除——归档项默认不在主列表里，但能通过「已归档」标签筛出来，
 *      且它的 evidenceTarget 缺失同样渲染 `—`（同一条格式化规则，不是两套代码）。
 *
 * ⚠ 断言打在性质上，不是固定数量（纪律第 9 条 / coding-standards E-4）：
 *   全程用 `RS_LIST_ITEMS` 自己的数据反推期望值，不写死行数/文案。
 */
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { RsListScreen } from "@/components/research-studio/rs-screens";
import { RS_LIST_ITEMS, RS_SIDEBAR } from "@/lib/mock/research-studio";

const activeItems = RS_LIST_ITEMS.filter((i) => !i.archived);
const archivedItems = RS_LIST_ITEMS.filter((i) => i.archived);

describe("F146 · 反空转：mock 数据本身具备下面断言需要的形状", () => {
  it("至少有一条未归档研究带真实的 evidenceTarget（不是全部 null，下面的'跟着数据走'才有意义）", () => {
    expect(activeItems.some((i) => i.evidenceTarget !== null)).toBe(true);
  });

  it("至少有一条已归档研究的 evidenceTarget 是 null（N-8 与 N-7 叠在同一条数据上）", () => {
    const withMissingTarget = archivedItems.find((i) => i.evidenceTarget === null);
    expect(withMissingTarget, "没有『已归档 + 目标缺失』的样例——下面归档态的 dash 断言无的放矢").not.toBeUndefined();
  });

  it("至少存在一条已归档研究，否则'归档不删除'的整组断言都是空转", () => {
    expect(archivedItems.length).toBeGreaterThan(0);
  });
});

describe("F146 · ① 卡片「证据 / 目标」：分子跟着数据走，目标缺失渲染 — 不是 0", () => {
  it("每条未归档研究的卡片，进度行都包含它自己的 evidence 数字（分子不是写死的）", () => {
    render(<RsListScreen state="default" view="owner" />);
    for (const it of activeItems) {
      const progress = screen.getByTestId(`rs-card-${it.id}-progress`);
      expect(progress.textContent, `卡片 ${it.id} 的证据数没有出现在进度行里`).toContain(String(it.evidence));
    }
  });

  it("evidenceTarget 非 null 的卡片渲染『目标 N』，且 N 就是该条自己的数据", () => {
    render(<RsListScreen state="default" view="owner" />);
    const withTarget = activeItems.filter((i) => i.evidenceTarget !== null);
    expect(withTarget.length).toBeGreaterThan(0);
    for (const it of withTarget) {
      const progress = screen.getByTestId(`rs-card-${it.id}-progress`);
      expect(progress.textContent).toContain(`目标 ${it.evidenceTarget}`);
      expect(progress.textContent).not.toContain("/ 0");
    }
  });

  it("evidenceTarget 为 null 的卡片渲染 —，绝不渲染 0（N-8 主战场）", () => {
    render(<RsListScreen state="default" view="owner" sub="archived" />);
    const missing = archivedItems.filter((i) => i.evidenceTarget === null);
    expect(missing.length).toBeGreaterThan(0);
    for (const it of missing) {
      const progress = screen.getByTestId(`rs-card-${it.id}-progress`);
      expect(progress.textContent).toContain("—");
      // 反空转：确认真的不是恰好文本里出现了 "0"（比如 questions/insights 里）
      expect(progress.textContent).not.toMatch(/\/\s*0(?!\d)/);
    }
  });
});

describe("F146 · ② Studio 左栏研究三段各自独立渲染", () => {
  it("三段各自的标题与状态文案都独立出现，互不覆盖", () => {
    render(<RsListScreen state="default" view="owner" />);
    RS_SIDEBAR.forEach((s, i) => {
      const row = screen.getByTestId(`rs-sidebar-${i}`);
      expect(row.textContent).toContain(s.title);
      expect(row.textContent).toContain(s.state);
    });
    // 三段确实是三段，不是同一段渲染了三次
    const titles = RS_SIDEBAR.map((s) => s.title);
    expect(new Set(titles).size).toBe(RS_SIDEBAR.length);
  });
});

describe("F146 · ③ 归档不是删除：默认列表不显示已归档项，但可按「已归档」标签筛出", () => {
  it("默认态（不带 sub）：已归档研究不在卡片列表里，未归档研究都在", () => {
    render(<RsListScreen state="default" view="owner" />);
    for (const it of archivedItems) {
      expect(screen.queryByTestId(`rs-card-${it.id}`)).toBeNull();
    }
    for (const it of activeItems) {
      expect(screen.getByTestId(`rs-card-${it.id}`)).toBeInTheDocument();
    }
  });

  it("sub=archived（对应点击「已归档」标签）：已归档研究能被筛出来，未归档研究这次不在", () => {
    render(<RsListScreen state="default" view="owner" sub="archived" />);
    for (const it of archivedItems) {
      expect(screen.getByTestId(`rs-card-${it.id}`), `已归档研究 ${it.id} 没有被『已归档』标签筛出——归档被做成了删除`).toBeInTheDocument();
    }
    for (const it of activeItems) {
      expect(screen.queryByTestId(`rs-card-${it.id}`)).toBeNull();
    }
  });

  it("「已归档」标签在归档态下渲染为选中态（active），证明它是一个真的筛选口而不是纯装饰", () => {
    render(<RsListScreen state="default" view="owner" sub="archived" href={(o) => (o.sub ? `?sub=${o.sub}` : "?")} />);
    const tag = screen.getByTestId("rs-tag-已归档");
    expect(tag.className).toContain("border-primary");
  });

  it("「已归档」标签本身带一个可跳转的链接，指回 archived 视图（不是死按钮）", () => {
    render(<RsListScreen state="default" view="owner" href={(o) => (o.sub ? `?sub=${o.sub}` : "?")} />);
    const tag = screen.getByTestId("rs-tag-已归档");
    expect(tag.getAttribute("href")).toBe("?sub=archived");
  });

  it("归档项在筛出来之后，它的证据/目标格式化规则与未归档项完全一致（同一条渲染逻辑，不是两套代码）", () => {
    render(<RsListScreen state="default" view="owner" sub="archived" />);
    for (const it of archivedItems) {
      const progress = screen.getByTestId(`rs-card-${it.id}-progress`);
      expect(progress.textContent).toContain(String(it.evidence));
      if (it.evidenceTarget === null) {
        expect(progress.textContent).toContain("—");
      } else {
        expect(progress.textContent).toContain(`目标 ${it.evidenceTarget}`);
      }
    }
  });
});

describe("F146 · 项目内深度研究列表沿用同一渲染 —— 同一组件同一份数据，不另起第二套列表", () => {
  it("owner 与 collaborator 视角下，同一批未归档研究的卡片与进度文案完全一致（视角不改变列表内容本身）", () => {
    const { container: ownerContainer } = render(<RsListScreen state="default" view="owner" />);
    const ownerProgress = activeItems.map((it) => within(ownerContainer).getByTestId(`rs-card-${it.id}-progress`).textContent);

    const { container: collabContainer } = render(<RsListScreen state="default" view="collaborator" />);
    const collabProgress = activeItems.map((it) => within(collabContainer).getByTestId(`rs-card-${it.id}-progress`).textContent);

    expect(collabProgress).toEqual(ownerProgress);
  });
});
