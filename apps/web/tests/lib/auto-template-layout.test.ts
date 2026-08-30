/**
 * 工作坊级自动布局生成器的纯函数单测。
 *
 * 这是「生成的画布必须适合便利贴协作」那条要求的机械形态：分档、不重叠、在画幅内、
 * 必填可分辨、容量影响尺寸、暂存区不是分区、只用中性色。
 * 尤其最后一条——**「黑白灰」若只写在注释里就等于没有**，这里直接对生成物断言
 * 不出现 PALETTE / PALETTE_SOFT / PRIMARY 的任何一个色值。
 */
import { describe, expect, it } from "vitest";
import { PALETTE, PALETTE_SOFT, PRIMARY, PRIMARY_SOFT, INK, INK_SOFT, LINE, PAPER, CANVAS_BG } from "@repo/fabric-markdown/theme";
import {
  buildAutoTemplateSpec,
  computeAutoLayout,
  cellSizeForCapacity,
  A0_FRAME,
  DEFAULT_CAPACITY,
  type AutoLayoutSectionInput,
} from "@/lib/canvas/auto-template-layout";

function defs(n: number, over: Partial<AutoLayoutSectionInput> = {}): AutoLayoutSectionInput[] {
  return Array.from({ length: n }, (_, i) => ({
    sectionId: `s${i}`,
    name: `分区${i}`,
    order: i,
    required: false,
    capacity: null,
    ...over,
  }));
}

describe("computeAutoLayout —— 分档", () => {
  const tiers: Array<[number, number, number]> = [
    [4, 2, 2],
    [6, 3, 2],
    [8, 4, 2],
    [9, 3, 3],
    [12, 4, 3],
  ];
  it.each(tiers)("%i 个分区 → %i×%i", (n, cols, rows) => {
    const l = computeAutoLayout(defs(n));
    expect([l.cols, l.rows]).toEqual([cols, rows]);
    expect(l.cells).toHaveLength(n);
  });

  it("档位外的分区数也排得下，且行×列 ≥ 分区数", () => {
    for (const n of [1, 2, 3, 5, 7, 10, 11, 13, 20]) {
      const l = computeAutoLayout(defs(n));
      expect(l.cells).toHaveLength(n);
      expect(l.cols * l.rows).toBeGreaterThanOrEqual(n);
      // 每个分区落在自己的 (row, col) 上，不重号
      const seen = new Set(l.cells.map((c) => `${c.row}/${c.col}`));
      expect(seen.size).toBe(n);
    }
  });

  it("按 order 排布，而不是按数组下标", () => {
    const shuffled: AutoLayoutSectionInput[] = [
      { sectionId: "c", name: "第三", order: 2, required: false, capacity: null },
      { sectionId: "a", name: "第一", order: 0, required: false, capacity: null },
      { sectionId: "b", name: "第二", order: 1, required: false, capacity: null },
    ];
    expect(computeAutoLayout(shuffled).cells.map((c) => c.sectionId)).toEqual(["a", "b", "c"]);
  });
});

describe("computeAutoLayout —— 几何", () => {
  it("分区框两两不重叠（含 gutter）", () => {
    for (const n of [2, 4, 5, 6, 8, 9, 12]) {
      const cells = computeAutoLayout(defs(n)).cells;
      for (let i = 0; i < cells.length; i += 1) {
        for (let j = i + 1; j < cells.length; j += 1) {
          const a = cells[i]!;
          const b = cells[j]!;
          const overlapX = Math.abs(a.x - b.x) < (a.w + b.w) / 2;
          const overlapY = Math.abs(a.y - b.y) < (a.h + b.h) / 2;
          expect(overlapX && overlapY, `${a.name} 与 ${b.name} 重叠`).toBe(false);
        }
      }
    }
  });

  it("所有分区框都在画布边界内，且不侵入右侧暂存区", () => {
    for (const n of [1, 4, 6, 9, 12, 15]) {
      const l = computeAutoLayout(defs(n));
      for (const c of l.cells) {
        expect(c.x - c.w / 2).toBeGreaterThanOrEqual(l.bounds.left);
        expect(c.x + c.w / 2).toBeLessThanOrEqual(l.bounds.right);
        expect(c.y - c.h / 2).toBeGreaterThanOrEqual(l.bounds.top);
        expect(c.y + c.h / 2).toBeLessThanOrEqual(l.bounds.bottom);
        expect(c.x + c.w / 2).toBeLessThanOrEqual(l.parking.x - l.parking.w / 2);
      }
      expect(l.parking.x + l.parking.w / 2).toBeLessThanOrEqual(l.bounds.right);
    }
  });

  it("落在与内置模板同一尺度里：6 分区时不超出 A0 基准画幅", () => {
    // persona / pestel 都是 6 分区，A0 画幅 x∈[60,1580] y∈[10,920]。
    const l = computeAutoLayout(defs(6));
    expect(l.bounds).toEqual({
      left: A0_FRAME.left,
      top: A0_FRAME.top,
      right: A0_FRAME.right,
      bottom: A0_FRAME.bottom,
    });
  });
});

describe("cellSizeForCapacity —— 容量决定分区尺寸", () => {
  it("capacity 越大，框越大（宽或高至少有一维增长）", () => {
    const small = cellSizeForCapacity(2);
    const large = cellSizeForCapacity(12);
    expect(large.w).toBeGreaterThanOrEqual(small.w);
    expect(large.h).toBeGreaterThan(small.h);
  });

  it("capacity 为 null 时用缺省容量（6 张），与显式传 6 一致", () => {
    expect(cellSizeForCapacity(null)).toEqual(cellSizeForCapacity(DEFAULT_CAPACITY));
  });

  it("算出来的框真的排得下 capacity 张便签（按引擎的排布公式复算）", () => {
    for (const cap of [1, 2, 3, 4, 6, 9, 12]) {
      const { w, h } = cellSizeForCapacity(cap);
      // 引擎：perRow = max(1, min(3, floor((w-28)/(136+12))))
      const perRow = Math.max(1, Math.min(3, Math.floor((w - 28) / 148)));
      const rows = Math.ceil(cap / perRow);
      // 最后一张便签的右沿 / 下沿都必须还在框内
      const lastRight = -w / 2 + 14 + (perRow - 1) * 148 + 136;
      expect(lastRight, `capacity=${cap} 横向排不下`).toBeLessThanOrEqual(w / 2);
      const lastBottom = 44 + rows * 92 + (rows - 1) * 14;
      expect(lastBottom, `capacity=${cap} 纵向排不下`).toBeLessThanOrEqual(h);
    }
  });

  it("最终版面里每个分区都真的排得下自己的 capacity（按引擎公式在成品尺寸上复算）", () => {
    for (const n of [1, 4, 6, 8, 9, 12]) {
      const caps = [1, 3, 5, 8, 12];
      const l = computeAutoLayout(
        defs(n).map((d, i) => ({ ...d, capacity: caps[i % caps.length]! })),
      );
      for (const c of l.cells) {
        const perRow = Math.max(1, Math.min(3, Math.floor((c.w - 28) / 148)));
        const rows = Math.ceil((c.capacity ?? 6) / perRow);
        const lastRight = -c.w / 2 + 14 + (perRow - 1) * 148 + 136;
        const lastBottom = 44 + rows * 92 + (rows - 1) * 14;
        expect(lastRight, `${n} 分区 / ${c.name} 横向溢出`).toBeLessThanOrEqual(c.w / 2);
        expect(lastBottom, `${n} 分区 / ${c.name} 纵向溢出`).toBeLessThanOrEqual(c.h);
      }
    }
  });

  it("容量最大的那个分区把所有格子撑大（统一格 = 对齐优先）", () => {
    const base = computeAutoLayout(defs(12));
    const roomy = computeAutoLayout(
      defs(12).map((d, i) => (i === 0 ? { ...d, capacity: 12 } : d)),
    );
    expect(roomy.cells[0]!.h).toBeGreaterThan(base.cells[0]!.h);
    // 统一：所有格子同尺寸
    expect(new Set(roomy.cells.map((c) => `${c.w}x${c.h}`)).size).toBe(1);
  });
});

describe("buildAutoTemplateSpec —— 生成物", () => {
  it("必填分区多一圈强调框，非必填没有", () => {
    const { spec } = buildAutoTemplateSpec({
      key: "k",
      displayName: "测试画布",
      sections: [
        { sectionId: "a", name: "必填区", order: 0, required: true, capacity: null },
        { sectionId: "b", name: "选填区", order: 1, required: false, capacity: null },
      ],
    });
    const ids = (spec.decorations ?? []).map((d) => d.id);
    expect(ids).toContain("auto-required-a");
    expect(ids).not.toContain("auto-required-b");
    const ring = spec.decorations!.find((d) => d.id === "auto-required-a")!;
    const box = spec.sections.find((s) => s.name === "必填区")!;
    // 「加粗」在几何上等效为外扩一圈（引擎不接受按节点设 strokeWidth，包不许改）
    expect(ring.width).toBeGreaterThan(box.w);
    expect(ring.height).toBeGreaterThan(box.h);
  });

  it("便签暂存区是 decoration，不是 section —— 分区数与契约 SectionDef 数严格相等", () => {
    const input = defs(6);
    const { spec } = buildAutoTemplateSpec({ key: "k2", displayName: "六分区", sections: input });
    expect(spec.sections).toHaveLength(6);
    expect(spec.sections.map((s) => s.name)).toEqual(input.map((d) => d.name));
    // 暂存区只以装饰形态存在
    const decoIds = (spec.decorations ?? []).map((d) => d.id);
    expect(decoIds).toContain("auto-parking-bg");
    expect(decoIds).toContain("auto-parking-label");
    expect(decoIds.some((id) => id.startsWith("auto-parking-dash"))).toBe(true);
    expect(spec.sections.some((s) => s.name.includes("暂存"))).toBe(false);
  });

  it("标题带：显示名进 spec.title，下方有一条分隔线装饰", () => {
    const { spec } = buildAutoTemplateSpec({ key: "k3", displayName: "客户旅程工作坊", sections: defs(4) });
    expect(spec.title).toBe("客户旅程工作坊");
    expect((spec.decorations ?? []).some((d) => d.id === "auto-title-rule")).toBe(true);
  });

  it("只用中性色：生成物里不出现 PALETTE / PALETTE_SOFT / PRIMARY 的任何色值", () => {
    const { spec } = buildAutoTemplateSpec({
      key: "k4",
      displayName: "黑白灰",
      sections: defs(9).map((d, i) => ({ ...d, required: i % 2 === 0, capacity: i + 1 })),
    });
    const NEUTRAL = new Set([INK, INK_SOFT, LINE, PAPER, CANVAS_BG, "transparent"]);
    const BANNED = new Set<string>([...PALETTE, ...PALETTE_SOFT, PRIMARY, PRIMARY_SOFT]);
    const used: string[] = [];
    for (const s of spec.sections) if (s.fill) used.push(s.fill);
    for (const d of spec.decorations ?? []) {
      for (const k of ["color", "stroke"] as const) {
        const v = d.data?.[k];
        if (typeof v === "string") used.push(v);
      }
    }
    expect(used.length).toBeGreaterThan(0);
    for (const c of used) {
      expect(BANNED.has(c), `用了禁色 ${c}`).toBe(false);
      expect(NEUTRAL.has(c), `${c} 不在中性令牌里`).toBe(true);
    }
    // sectionColors 是 PALETTE 索引，刻意不产出
    expect(spec.sectionColors).toBeUndefined();
  });

  it("没有 `type: \"短文本\"` 分区时不产出表头字段——与改动前逐字一致", () => {
    const { spec } = buildAutoTemplateSpec({ key: "k5", displayName: "无表头", sections: defs(4) });
    expect(spec.fields).toBeUndefined();
    expect(spec.headerRect).toBeUndefined();
  });

  /**
   * 2026-08-30 人类反馈根因回归钉子：用户画像在 chat 模拟里测不出表头字段
   * （姓名/性别/年龄……）。此前 `buildAutoTemplateSpec` 对 `type === "短文本"`
   * 的分区一无所知（入参类型上就没有 `type` 字段），一律当普通贴纸 box 处理，
   * 模型按 guidance 写出的 `字段名: 字段值` 行没有 `fields`/`headerRect` 可渲染，
   * 静默丢失。见函数文件头「2026-08-30 追加」的注释。
   */
  describe("表头字段（`type: \"短文本\"`）", () => {
    it("短文本分区不进入 spec.sections（不当贴纸 box），而是合并成 fields/headerRect", () => {
      const { spec } = buildAutoTemplateSpec({
        key: "persona-like",
        displayName: "用户画像",
        sections: [
          { sectionId: "name", name: "姓名", order: 0, required: false, capacity: null, type: "短文本" },
          { sectionId: "gender", name: "性别", order: 1, required: false, capacity: null, type: "短文本" },
          { sectionId: "desc", name: "用户描述", order: 2, required: false, capacity: null, type: "便利贴列表" },
        ],
      });
      expect(spec.sections.map((s) => s.name)).toEqual(["用户描述"]);
      expect(spec.fields).toEqual(["姓名", "性别"]);
      expect(spec.headerRect).toBeDefined();
      expect(spec.fieldsPerRow).toBe(2);
    });

    it("正文分区整体下移，给表头带腾出空间——不与表头带重叠", () => {
      const { spec } = buildAutoTemplateSpec({
        key: "persona-like",
        displayName: "用户画像",
        sections: [
          { sectionId: "name", name: "姓名", order: 0, required: false, capacity: null, type: "短文本" },
          ...defs(4).map((d) => ({ ...d, type: "便利贴列表" as const })),
        ],
      });
      const headerBottom = spec.headerRect!.y + spec.headerRect!.h / 2;
      for (const s of spec.sections) {
        expect(s.y - s.h / 2).toBeGreaterThanOrEqual(headerBottom);
      }
    });

    it("全部分区都是短文本（没有正文分区）时安全退化——不产出表头，也不炸", () => {
      const { spec } = buildAutoTemplateSpec({
        key: "all-header",
        displayName: "全表头",
        sections: [
          { sectionId: "name", name: "姓名", order: 0, required: false, capacity: null, type: "短文本" },
        ],
      });
      expect(spec.fields).toBeUndefined();
      expect(spec.sections).toHaveLength(1);
    });
  });
});
