/**
 * 显式布局（拖拽版模板）几何的纯函数单测——R1（#2058 后续）。
 *
 * 两条独立几何各自成立：px（喂给 fabric 渲染）与 mm（`Design.pdf` §5 公式）。
 * 反证重点：不重叠、落在画幅内、mm 公式与 PDF 表格逐字对上、贴纸尺寸判定档位
 * 边界正确（这条卡过真实事故——判定档位的开闭区间写反会让「刚好 70mm」两头不靠）。
 */
import { describe, expect, it } from "vitest";
import {
  computeExplicitLayout,
  buildExplicitTemplateSpec,
  allSectionsPlaced,
  sectionGeometryMm,
  classifyNoteSize,
  MAX_NOTE_MM,
  MIN_SHRINK_NOTE_MM,
  titleReserveMm,
  blockHorizontalChromeMm,
  GRID_GAP_MM,
  TONE_COLORS,
  A1_CONTENT_MM,
  A1_PAPER_MM,
  PAPER_SIZE_MM,
  contentMmFor,
  type ExplicitLayoutSectionInput,
  type SectionGeometryMmInput,
} from "@/lib/canvas/explicit-template-layout";
import { A0_FRAME, ENGINE_STICKY, GRID_TOP, renderStickyCapacity } from "@/lib/canvas/auto-template-layout";

function section(
  key: string, col: number, row: number, w: number, h: number,
  over: Partial<ExplicitLayoutSectionInput["layout"]> = {},
): ExplicitLayoutSectionInput {
  return {
    sectionId: key,
    name: `分区-${key}`,
    layout: { col, row, w, h, cols: 5, max: 6, tone: 0, overflow: "缩小字号", ...over },
  };
}

describe("computeExplicitLayout —— px 几何", () => {
  it("单个占满整个 12 列网格的区块，中心落在画幅正中，宽度等于整个可用区域", () => {
    const l = computeExplicitLayout([section("a", 1, 1, 12, 8)], 12);
    const cell = l.cells[0]!;
    const areaW = A0_FRAME.right - A0_FRAME.left;
    const areaH = A0_FRAME.bottom - GRID_TOP;
    expect(cell.w).toBeCloseTo(areaW, 5);
    expect(cell.h).toBeCloseTo(areaH, 5);
    expect(cell.x).toBeCloseTo(A0_FRAME.left + areaW / 2, 5);
    expect(cell.y).toBeCloseTo(GRID_TOP + areaH / 2, 5);
  });

  it("左右并排两个 6 列宽的区块，互不重叠，且共同宽度 + 一道 gutter = 整个可用宽度", () => {
    const l = computeExplicitLayout(
      [section("left", 1, 1, 6, 8), section("right", 7, 1, 6, 8)],
      12,
    );
    const [left, right] = l.cells;
    expect(left!.x).toBeLessThan(right!.x);
    // 左区块右沿 < 右区块左沿——真的没有重叠，不是"看起来在左边"。
    expect(left!.x + left!.w / 2).toBeLessThanOrEqual(right!.x - right!.w / 2 + 1e-6);
    const areaW = A0_FRAME.right - A0_FRAME.left;
    // 两个区块宽度相同（对称网格），加一道 gutter 应等于整个可用宽度。
    expect(left!.w + right!.w + (right!.x - right!.w / 2 - (left!.x + left!.w / 2))).toBeCloseTo(areaW, 5);
  });

  it("6 列网格与 12 列网格：同样跨 3 列，6 列网格算出的区块更宽（列更少，单列更宽）", () => {
    const l12 = computeExplicitLayout([section("a", 1, 1, 3, 2)], 12);
    const l6 = computeExplicitLayout([section("a", 1, 1, 3, 2)], 6);
    expect(l6.cells[0]!.w).toBeGreaterThan(l12.cells[0]!.w);
  });

  it("不预留右侧便签暂存区——bounds 右沿就是 A0_FRAME 右沿，不像 auto-layout 那样内缩", () => {
    const l = computeExplicitLayout([section("a", 1, 1, 4, 3)], 12);
    expect(l.bounds.right).toBe(A0_FRAME.right);
    expect(l.bounds.left).toBe(A0_FRAME.left);
  });

  it("buildExplicitTemplateSpec 产出的 TemplateSection 与 layout.cells 逐一对应，且不带自动布局那套装饰", () => {
    const { spec, layout } = buildExplicitTemplateSpec({
      key: "t1", displayName: "测试模板",
      sections: [section("a", 1, 1, 6, 4), section("b", 7, 1, 6, 4)],
      gridCols: 12,
    });
    expect(spec.sections).toHaveLength(2);
    expect(spec.sections.map((s) => s.name)).toEqual(layout.cells.map((c) => c.name));
    // 没有必填强调框/便签暂存区——那是 auto-template-layout 专属的视觉补偿。
    expect(spec.decorations).toEqual([]);
  });

  /**
   * issue #2372：此前 `buildExplicitTemplateSpec` 只产出 name/x/y/w/h/fill，`layout.cols`
   * （列数）与 `layout.tone`（贴纸颜色）从没进过 `TemplateSpec`——不是本函数没算，是从
   * 没写出来过。这两条断言钉住"现在确实写出来了"，对应 vendor 侧新增的
   * `TemplateSection.sticky`/`stickyColor`（`packages/fabric-markdown` 2026-08-30 回流）。
   */
  it("每个分区各自的 cols → sticky.perRow，逐分区不同，不是全模板共用一个数", () => {
    const { spec } = buildExplicitTemplateSpec({
      key: "t1", displayName: "测试模板",
      sections: [
        section("a", 1, 1, 6, 4, { cols: 2 }),
        section("b", 7, 1, 6, 4, { cols: 6 }),
      ],
      gridCols: 12,
    });
    expect(spec.sections[0]!.sticky).toEqual({ perRow: 2 });
    expect(spec.sections[1]!.sticky).toEqual({ perRow: 6 });
  });

  it("每个分区各自的 tone → stickyColor，取的是 TONE_COLORS 里对应索引的真实 hex", () => {
    const { spec } = buildExplicitTemplateSpec({
      key: "t1", displayName: "测试模板",
      sections: [
        section("a", 1, 1, 6, 4, { tone: 0 }),
        section("b", 7, 1, 6, 4, { tone: 1 }),
        section("c", 1, 5, 6, 4, { tone: 2 }),
        section("d", 7, 5, 6, 4, { tone: 3 }),
      ],
      gridCols: 12,
    });
    expect(spec.sections.map((s) => s.stickyColor)).toEqual(TONE_COLORS);
  });

  it("tone 越界（防御性）时退回 TONE_COLORS[0]，不产出 undefined 颜色", () => {
    const { spec } = buildExplicitTemplateSpec({
      key: "t1", displayName: "测试模板",
      sections: [section("a", 1, 1, 6, 4, { tone: 99 })],
      gridCols: 12,
    });
    expect(spec.sections[0]!.stickyColor).toBe(TONE_COLORS[0]);
  });

  /**
   * issue #2585 根因回归钉子：「汉堡沟通模型」的「开场引入」「行动闭环」两个分区
   * 被 `deriveTemplateLayouts` 摊到 8 行网格后各只分到 `h:1`（约 83.5px）——扣掉
   * 标题条与内边距后可用高度（约 25.5px）远小于默认贴纸高度（`ENGINE_STICKY.h`,
   * 92px），`renderStickyCapacity` 按默认尺寸算出容量 0，`capFenceBulletsToCapacity`
   * 就把这两个分区下的全部要点整段丢弃——分区因此完全无内容、无颜色（`stickyColor`
   * 画在便签上，没有便签就看不见色）。
   *
   * 修法：格子放不下默认尺寸的贴纸、但还有正的可用高度时，把 `sticky.h` 压到这个
   * 格子物理放得下一行的尺寸；`sectionRenderCapacities` 读的就是这个收缩后的值，
   * 算出的容量必须 > 0。
   */
  it("h=1 的窄格子（汉堡首尾两带同款几何）：sticky.h 收缩到放得下，渲染容量 > 0", () => {
    const { spec } = buildExplicitTemplateSpec({
      key: "t1", displayName: "测试模板",
      sections: [section("opening", 1, 1, 12, 1, { cols: 4 })],
      gridCols: 12,
    });
    const sticky = spec.sections[0]!.sticky!;
    expect(sticky.perRow).toBe(4);
    expect(sticky.h).toBeDefined();
    expect(sticky.h!).toBeLessThan(ENGINE_STICKY.h);
    expect(sticky.h!).toBeGreaterThan(0);
    const capacity = renderStickyCapacity(
      spec.sections[0]!.w, spec.sections[0]!.h, sticky.perRow!, spec.titleBars !== false, sticky.w ?? ENGINE_STICKY.w, sticky.h,
    );
    expect(capacity).toBeGreaterThan(0);
  });

  it("格子够高（中间三带同款几何）时不覆盖贴纸高度——保持与既有断言字节级兼容", () => {
    const { spec } = buildExplicitTemplateSpec({
      key: "t1", displayName: "测试模板",
      sections: [section("core", 1, 1, 12, 2, { cols: 4 })],
      gridCols: 12,
    });
    expect(spec.sections[0]!.sticky).toEqual({ perRow: 4 });
  });

  /**
   * 2026-08-30 人类反馈根因回归钉子：用户画像在 chat 模拟里测不出表头字段
   * （姓名/性别/年龄……），因为 `type === "短文本"` 的分区此前被当成普通贴纸 box——
   * 见 `buildExplicitTemplateSpec` 文件头「2026-08-30 追加」的注释。
   */
  describe("表头字段（`type: \"短文本\"`）", () => {
    it("短文本分区不进入 spec.sections（不当贴纸 box），而是合并成 fields/headerRect", () => {
      const { spec } = buildExplicitTemplateSpec({
        key: "persona-like", displayName: "用户画像",
        sections: [
          { ...section("name", 1, 1, 3, 1), name: "姓名", type: "短文本" },
          { ...section("gender", 4, 1, 3, 1), name: "性别", type: "短文本" },
          { ...section("desc", 1, 2, 6, 4), name: "用户描述", type: "便利贴列表" },
        ],
        gridCols: 12,
      });
      expect(spec.sections.map((s) => s.name)).toEqual(["用户描述"]);
      expect(spec.fields).toEqual(["姓名", "性别"]);
      expect(spec.headerRect).toBeDefined();
      expect(spec.fieldsPerRow).toBe(2);
    });

    it("headerRect 是所有表头格子的外接矩形，覆盖它们各自的 x/y/w/h", () => {
      const nameCell = section("name", 1, 1, 3, 1);
      const genderCell = section("gender", 4, 1, 3, 1);
      const layout = computeExplicitLayout(
        [nameCell, genderCell],
        12,
      );
      const { spec } = buildExplicitTemplateSpec({
        key: "persona-like", displayName: "用户画像",
        sections: [
          { ...nameCell, name: "姓名", type: "短文本" },
          { ...genderCell, name: "性别", type: "短文本" },
        ],
        gridCols: 12,
      });
      const left = Math.min(...layout.cells.map((c) => c.x - c.w / 2));
      const right = Math.max(...layout.cells.map((c) => c.x + c.w / 2));
      expect(spec.headerRect!.w).toBeCloseTo(right - left, 5);
    });

    it("没有短文本分区时（绝大多数组织自建模板），不产出 fields/headerRect——与改动前逐字一致", () => {
      const { spec } = buildExplicitTemplateSpec({
        key: "t1", displayName: "测试模板",
        sections: [section("a", 1, 1, 6, 4), section("b", 7, 1, 6, 4)],
        gridCols: 12,
      });
      expect(spec.fields).toBeUndefined();
      expect(spec.headerRect).toBeUndefined();
    });

    /**
     * 2026-08-31 人类实测截图回归钉子：用户画像 9 个表头字段被 `autoFillLayout` 铺进
     * 同一个网格行（`row=1`），此前 `fieldsPerRow` 直接取"这一行放了几个格子"=9——
     * 引擎每个字段固定要 96+6+150=252px，`headerRect` 那点宽度根本放不下 9 个，画出来
     * 是姓名/性别/年龄……的文字互相压在一起，读不出任何一个值（不是空白，是糊成一团）。
     * 这条钉住修复后的正确行为：按实际像素宽度换算这一行最多放几个，放不下的自动换行，
     * `headerRect.h` 跟着行数长高，且从不产出会让相邻字段互相压住的 `fieldsPerRow`。
     */
    it("表头字段数超过一行像素宽度放得下的个数时自动换行，不产出会导致文字互相压住的 fieldsPerRow", () => {
      const PERSONA_FIELDS = ["姓名", "性别", "年龄", "区域", "教育水平", "职位", "行业", "家庭情况", "收入水平"];
      // 9 个字段铺满 12 列网格的同一行——`autoFillLayout` 对表头字段的真实铺法。
      const widths = [2, 1, 1, 1, 1, 1, 1, 2, 2]; // 和为 12
      let col = 1;
      const sections = PERSONA_FIELDS.map((name, i) => {
        const w = widths[i]!;
        const cell = { ...section(`f${i}`, col, 1, w, 1), name, type: "短文本" as const };
        col += w;
        return cell;
      });
      const { spec } = buildExplicitTemplateSpec({
        key: "persona-like", displayName: "用户画像", sections, gridCols: 12,
      });
      const HEADER_FIELD_MIN_W = 96 + 6 + 150;
      // 核心断言：换算出的 fieldsPerRow 必须能在 headerRect 的实际宽度里放得下，
      // 不能再像修复前那样直接等于"这一行有几个格子"。
      expect(spec.fieldsPerRow! * HEADER_FIELD_MIN_W).toBeLessThanOrEqual(spec.headerRect!.w + 1e-6);
      expect(spec.fieldsPerRow!).toBeLessThan(PERSONA_FIELDS.length);
      // 换行后 headerRect 必须跟着长高，容纳 ceil(9/fieldsPerRow) 行，不能停留在单行原高度。
      const rows = Math.ceil(PERSONA_FIELDS.length / spec.fieldsPerRow!);
      expect(rows).toBeGreaterThan(1);
      expect(spec.headerRect!.h).toBeGreaterThan(0);
    });

    /**
     * 2026-09-02 人类实测截图回归钉子（chat 里的用户画像「画框和上方框重叠」）：
     * 上一条让 `headerRect` 长高（9 字段 → 2 行 → 120px），但表头格子只占 1 个网格行
     * （≈83.5px），长出来的 36.5px 直接压在正文第一行三个分区框的标题条上。
     * 这条钉住修复后的行为：表头带比格子高出多少，位于其下方的正文分区就整体下移多少，
     * 正文分区之间的相对版式不变，`layout.bounds.bottom` 同步下移。
     */
    it("表头带长高时，正文分区整体下移让位——任何正文框都不与表头带重叠（用户画像真实几何）", () => {
      const PERSONA_FIELDS = ["姓名", "性别", "年龄", "区域", "教育水平", "职位", "行业", "家庭情况", "收入水平"];
      const widths = [2, 1, 1, 1, 1, 1, 1, 2, 2];
      let col = 1;
      const header = PERSONA_FIELDS.map((name, i) => {
        const w = widths[i]!;
        const cell = { ...section(`f${i}`, col, 1, w, 1), name, type: "短文本" as const };
        col += w;
        return cell;
      });
      // 正文 6 个分区：3 列 × 2 行，紧贴表头行之下（第 2-4 行、第 5-8 行）——
      // `builtin-template-config.ts` 对 persona 的真实推演版式。
      const bodyNames = ["用户描述", "目标和需求", "行为与偏好", "痛点和挑战", "动机", "影响因素"];
      const body = bodyNames.map((name, i) => ({
        ...section(`s${i}`, 1 + (i % 3) * 4, i < 3 ? 2 : 5, 4, i < 3 ? 3 : 4),
        name,
        type: "便利贴列表" as const,
      }));
      const { spec, layout } = buildExplicitTemplateSpec({
        key: "persona-shift", displayName: "用户画像", sections: [...header, ...body], gridCols: 12,
      });
      const raw = computeExplicitLayout([...header, ...body], 12);

      const hr = spec.headerRect!;
      const headerBottom = hr.y + hr.h / 2;
      const rawHeaderBottom = Math.max(...raw.cells.slice(0, header.length).map((c) => c.y + c.h / 2));
      // 前提成立：表头带确实比它的网格格子高（否则这条测试测不到东西）。
      expect(headerBottom).toBeGreaterThan(rawHeaderBottom);
      const delta = headerBottom - rawHeaderBottom;

      // 核心断言：每个正文框的顶边都不高于表头带底边。
      expect(spec.sections).toHaveLength(6);
      for (const s of spec.sections) {
        expect(s.y - s.h / 2).toBeGreaterThanOrEqual(headerBottom - 1e-6);
      }
      // 正文整体平移同一个 delta：相对版式一字不改。
      const rawBody = raw.cells.slice(header.length);
      spec.sections.forEach((s, i) => {
        expect(s.x).toBeCloseTo(rawBody[i]!.x, 6);
        expect(s.y - rawBody[i]!.y).toBeCloseTo(delta, 6);
        expect(s.w).toBeCloseTo(rawBody[i]!.w, 6);
        expect(s.h).toBeCloseTo(rawBody[i]!.h, 6);
      });
      // 外接框底边跟着下移，`fitToContent` 才不会把最下面一行裁掉。
      expect(layout.bounds.bottom).toBeCloseTo(raw.bounds.bottom + delta, 6);
      // 表头格子本身不动（它们的 x/y 只是 headerRect 的取材，不参与平移）。
      layout.cells.slice(0, header.length).forEach((c, i) => {
        expect(c.y).toBeCloseTo(raw.cells[i]!.y, 6);
      });
    });

    it("表头字段少到一行放得下时（表头带不长高）正文分区一字不动——与改动前逐字一致", () => {
      const header = [
        { ...section("name", 1, 1, 6, 1), name: "姓名", type: "短文本" as const },
        { ...section("age", 7, 1, 6, 1), name: "年龄", type: "短文本" as const },
      ];
      const body = [
        { ...section("a", 1, 2, 6, 7), name: "A", type: "便利贴列表" as const },
        { ...section("b", 7, 2, 6, 7), name: "B", type: "便利贴列表" as const },
      ];
      const { spec, layout } = buildExplicitTemplateSpec({
        key: "no-shift", displayName: "x", sections: [...header, ...body], gridCols: 12,
      });
      const raw = computeExplicitLayout([...header, ...body], 12);
      // 2 个字段 → 1 行 → minH 80 < 格子高 83.5：表头带不长高，正文不平移。
      expect(spec.headerRect!.h).toBeCloseTo(raw.cells[0]!.h, 6);
      spec.sections.forEach((s, i) => {
        expect(s.y).toBeCloseTo(raw.cells[header.length + i]!.y, 6);
      });
      expect(layout.bounds.bottom).toBe(raw.bounds.bottom);
    });
  });
});

describe("allSectionsPlaced（issue #2372：chat 模拟/真实 chat 要不要走显式布局）", () => {
  it("空列表：不算「都放置了」——没有分区就没有显式布局可言", () => {
    expect(allSectionsPlaced([])).toBe(false);
  });

  it("全部有 layout：true", () => {
    expect(allSectionsPlaced([{ layout: {} }, { layout: {} }])).toBe(true);
  });

  it("有一个 layout 是 null：false——不做部分合并，整体退回自动布局", () => {
    expect(allSectionsPlaced([{ layout: {} }, { layout: null }])).toBe(false);
  });

  it("有一个 layout 是 undefined（契约 .optional() 的旧数据）：false", () => {
    expect(allSectionsPlaced([{ layout: {} }, {}])).toBe(false);
  });
});

describe("buildExplicitTemplateSpec —— 页脚署名进 spec（issue #2527）", () => {
  const section: ExplicitLayoutSectionInput = {
    sectionId: "s1", name: "目标", type: "便利贴列表",
    layout: { col: 1, row: 1, w: 6, h: 3, cols: 3, max: 9, tone: 0, overflow: "缩小字号" },
  };
  it("传了 footer：spec.footer 原样带过去，引擎才画得出页脚带", () => {
    const { spec } = buildExplicitTemplateSpec({ key: "k", displayName: "T", footer: "本工具基于 XXX", gridCols: 12, sections: [section] });
    expect(spec.footer).toBe("本工具基于 XXX");
  });
  it("footer 空串/缺省：spec 上没有 footer 字段（与 #2527 之前逐字一致）", () => {
    const a = buildExplicitTemplateSpec({ key: "k", displayName: "T", footer: "", gridCols: 12, sections: [section] });
    const b = buildExplicitTemplateSpec({ key: "k", displayName: "T", gridCols: 12, sections: [section] });
    expect("footer" in a.spec).toBe(false);
    expect(a.spec).toEqual(b.spec);
  });
});

describe("sectionGeometryMm —— Design.pdf §5 公式", () => {
  it("12 列网格，跨满 12 列 8 行：wMm/hMm 应逼近纸面内容区（一整块地方几乎占满内容区，只差一道 gap）", () => {
    const g = sectionGeometryMm({ w: 12, h: 8, cols: 5, gridCols: 12 });
    // wMm = (12/12)*821 - 6 = 815；hMm = (8/8)*574 - 6 = 568——逐字套公式验证。
    expect(g.wMm).toBe(A1_CONTENT_MM.w - 6);
    expect(g.hMm).toBe(A1_CONTENT_MM.h - 6);
  });

  it("贴纸实尺 = (贴纸网格可用宽度 - 6×(cols-1)) / cols，固定 1:1 方形——2026-09-01 推翻 2026-08-30「固定不变」的约定，重新随区块宽度/列数缩放", () => {
    // 5 列 × 2 行 = 10 条的经典配置（PDF 示例原话「5 列 × 2 行 = 放得下 10 条」）。
    const g = sectionGeometryMm({ w: 6, h: 3, cols: 5, gridCols: 12 });
    const expectedWMm = (6 / 12) * A1_CONTENT_MM.w - 6;
    // ⚠ 2026-09-01（同日后续）：贴纸网格是区块的子元素，可用宽度要先扣掉区块自己
    // 的左右内边距/边框（`blockHorizontalChromeMm`），不是直接拿区块外沿宽度去除——
    // 理由见该函数文档（人类实测反馈"便利贴被遮住一半，不分列数"）。
    const expectedNoteGridWidthMm = expectedWMm - blockHorizontalChromeMm("A1");
    const expectedNoteMm = Math.round((expectedNoteGridWidthMm - 6 * 4) / 5);
    expect(g.noteMm).toBe(expectedNoteMm);
  });

  it("容量 = cols × rows，rows 由 floor((hMm-titleReserveMm(size))/(noteMm+6)) 算出——不是拍脑袋乘一个数", () => {
    const g = sectionGeometryMm({ w: 6, h: 3, cols: 5, gridCols: 12 });
    const expectedHMm = (3 / 8) * A1_CONTENT_MM.h - 6;
    const expectedRows = Math.floor((expectedHMm - titleReserveMm("A1")) / (g.noteMm + 6));
    expect(g.rows).toBe(expectedRows);
    expect(g.fits).toBe(5 * expectedRows);
  });

  it("titleReserveMm 按纸张宽度换算——A3/A4 比 A1 小得多，不是三档共用同一个固定 mm 数", () => {
    const a1 = titleReserveMm("A1");
    const a3 = titleReserveMm("A3");
    const a4 = titleReserveMm("A4");
    // A1 纸宽是 841mm（`PAPER_SIZE_MM.A1.w`，cqw 的换算基准是整张纸，不是扣掉页边距
    // 的内容区）——5.15% × 841 ≈ 43.3mm（内边距/边框都是上下两条边都要算，见
    // `BLOCK_HEADER_RESERVE_CQW` 的推导注释）。
    expect(a1).toBeCloseTo(43.3, 1);
    expect(a3).toBeLessThan(a1);
    expect(a4).toBeLessThan(a3);
    // 与纸宽严格成正比——同一个 cqw 比例换算到不同纸宽。
    expect(a3 / a1).toBeCloseTo(PAPER_SIZE_MM.A3.w / PAPER_SIZE_MM.A1.w, 5);
    expect(a4 / a1).toBeCloseTo(PAPER_SIZE_MM.A4.w / PAPER_SIZE_MM.A1.w, 5);
  });

  it("sectionGeometryMm 在 A4 上用 A4 自己的 titleReserveMm，不是错误地沿用 A1 的固定值", () => {
    // h=8（满高）：h=3 时 A1/A4 两种预留值凑巧落进同一个 floor 区间，测不出差异；
    // 拉高区块让两种预留值换算出的行数真的分道扬镳。
    const onA4 = sectionGeometryMm({ w: 6, h: 8, cols: 5, gridCols: 12, size: "A4" });
    const expectedRowsWithA4Reserve = Math.floor(
      (onA4.hMm - titleReserveMm("A4")) / (onA4.noteMm + GRID_GAP_MM),
    );
    const expectedRowsIfWronglyUsedA1Reserve = Math.floor(
      (onA4.hMm - titleReserveMm("A1")) / (onA4.noteMm + GRID_GAP_MM),
    );
    expect(onA4.rows).toBe(expectedRowsWithA4Reserve);
    // 如果实现退化成"不管选哪张纸都用 A1 的固定预留"，这条会先假绿——用两种预留值
    // 算出的期望 rows 本身就该不同，才能钉住"真的按纸张切换了"，不是巧合对上。
    expect(expectedRowsWithA4Reserve).not.toBe(expectedRowsIfWronglyUsedA1Reserve);
  });

  it("区块窄到贴纸实尺 < 0（w/h 太小）时不产出负数容量——rows 夹到 0，不是负数或 NaN", () => {
    const g = sectionGeometryMm({ w: 1, h: 1, cols: 8, gridCols: 12 });
    expect(g.rows).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(g.rows)).toBe(true);
    expect(g.fits).toBeGreaterThanOrEqual(0);
  });

  it("issue #2368 · 贴纸实尺封顶在 MAX_NOTE_MM——1 列时不再吃满整个区块宽度，不再把自己撑到 0 行", () => {
    // 真实复现：w=4,h=4（A1，12 列网格）选 1 列——未封顶前 wMm≈268，noteMm=268/1=268，
    // rows=floor((281-22)/(268+6))=0，整块区域画不出任何内容。这条钉子在 2026-08-30
    // 被「固定不变」的约定绕开过一次（干脆不看 wMm/cols 了），2026-09-01 推翻那条约定、
    // 重新按宽度/列数反推 noteMm 之后，必须重新钉住不能回归到这个空白区块的老 bug。
    const g = sectionGeometryMm({ w: 4, h: 4, cols: 1, gridCols: 12 });
    expect(g.wMm).toBe(268);
    expect(g.noteMm).toBe(MAX_NOTE_MM);
    expect(g.noteMm).toBeLessThan(g.wMm);
    expect(g.rows).toBeGreaterThan(0);
    expect(g.fits).toBeGreaterThan(0);
  });

  it("noteMm 未触顶时维持原公式——封顶只在超过 MAX_NOTE_MM 时才生效，不改变正常档位的数值", () => {
    const g = sectionGeometryMm({ w: 6, h: 3, cols: 5, gridCols: 12 });
    expect(g.noteMm).toBeLessThan(MAX_NOTE_MM);
    const expectedWMm = (6 / 12) * A1_CONTENT_MM.w - 6;
    const expectedNoteGridWidthMm = expectedWMm - blockHorizontalChromeMm("A1");
    expect(g.noteMm).toBe(Math.round((expectedNoteGridWidthMm - 6 * 4) / 5));
  });

  /**
   * 2026-09-01（第五轮，独立审查驳回"跳过测试"那版之后）：A4 纸配上较小区块选
   * 2 列时，按*宽度*倒推的贴纸边长比这块地方的可用高度还高，`rows` floor 成 0，
   * `visibleNoteCount` 又会强制展示至少 1 条——那 1 条天生比可用高度还高，
   * 必然被裁。真正的修法：`rows` 按宽度版尺寸算出 0、但可用高度仍是正数时，
   * 把贴纸边长夹到"能放下一行"的高度版尺寸。这组钉子直接复现人类实测撞到的
   * 那组参数（A4、cols=2、默认区块高 h=3），不是编一组凑巧触发的输入。
   */
  describe("rows 按宽度算出 0、但可用高度仍是正数时，贴纸边长夹到高度能放下一行的尺寸", () => {
    it("A4 纸 + 2 列 + h=3（真实复现的那组参数）：rows/fits 不再是 0，noteMm 比宽度版更小", () => {
      const g = sectionGeometryMm({ w: 6, h: 3, cols: 2, gridCols: 12, size: "A4" });
      // 按宽度算出的原始值（不夹高度）应该确实超过这块地方的可用高度——
      // 这条钉子首先确认"会触发这条分支"，不是巧合绕过了它。
      const wMm = (6 / 12) * contentMmFor("A4").w - 6;
      const rawWidthNoteMm = Math.round(
        Math.min(MAX_NOTE_MM, (wMm - blockHorizontalChromeMm("A4") - 6) / 2),
      );
      const hMm = (3 / 8) * contentMmFor("A4").h - 6;
      const availableHeightMm = hMm - titleReserveMm("A4");
      expect(rawWidthNoteMm + GRID_GAP_MM).toBeGreaterThan(availableHeightMm);

      // 夹完之后：真的放得下——贴纸边长 + 一道间距不超过可用高度，不是继续
      // 硬报"放得下"却量出来还是超的。
      expect(g.rows).toBeGreaterThanOrEqual(1);
      expect(g.fits).toBeGreaterThanOrEqual(1);
      expect(g.noteMm).toBeLessThan(rawWidthNoteMm);
      expect(g.noteMm + GRID_GAP_MM).toBeLessThanOrEqual(availableHeightMm);
    });

    it("可用高度本身就 ≤ 0（区块太矮，标题预留都不够）时，不产出负数/零尺寸也算「放得下」——rows 仍如实是 0", () => {
      const g = sectionGeometryMm({ w: 6, h: 1, cols: 2, gridCols: 12, size: "A4" });
      expect(g.rows).toBe(0);
      expect(g.fits).toBe(0);
    });

    it("正常情况（可用高度本来就够）不受这条新逻辑影响——noteMm 仍是宽度版原值，不会被误夹小", () => {
      const g = sectionGeometryMm({ w: 6, h: 8, cols: 2, gridCols: 12, size: "A4" });
      const wMm = (6 / 12) * contentMmFor("A4").w - 6;
      const expectedNoteMm = Math.round(
        Math.min(MAX_NOTE_MM, (wMm - blockHorizontalChromeMm("A4") - 6) / 2),
      );
      expect(g.noteMm).toBe(expectedNoteMm);
      expect(g.rows).toBeGreaterThan(1);
    });
  });

  /**
   * issue #2527（2026-09-02 用户反馈「用户画像/模版编辑/显示方式/列数」）：
   * 「目标和需求」设最多 9 条、选 3 列，按道理 3 列 × 每列 3 条，实际 3 列 × 每列 1 条。
   * 根因：贴纸边长只由宽度倒推（封顶 82mm），「最多条数」从没参与过尺寸决定。
   */
  describe("issue #2527：传入 max 时，贴纸按 ceil(max/cols) 行往下收，让 3 列 × 9 条真能摆成 3×3", () => {
    it("A1 + 3 列 + 最多 9 条：不传 max 时只有 1 行（复现 bug），传了 max 后 rows=3、fits≥9", () => {
      const base = { w: 6, h: 3, cols: 3, gridCols: 12 } as const;
      const before = sectionGeometryMm(base);
      // 先确认这组参数确实复现了反馈：宽度版贴纸吃到上限，高度只够 1 行 ⇒ 3×1。
      expect(before.noteMm).toBe(MAX_NOTE_MM);
      expect(before.rows).toBe(1);
      expect(before.fits).toBe(3);

      const after = sectionGeometryMm({ ...base, max: 9 });
      expect(after.rows).toBe(3);
      expect(after.fits).toBe(9);
      expect(after.noteMm).toBeLessThan(before.noteMm);
      // 收小后的 3 行 + 2 道间距真的塞得进可用高度，不是报了 3 行却还被裁掉。
      const hMm = (3 / 8) * A1_CONTENT_MM.h - 6;
      const availableHeightMm = hMm - titleReserveMm("A1");
      expect(3 * after.noteMm + 2 * GRID_GAP_MM).toBeLessThanOrEqual(availableHeightMm);
    });

    it("宽度版容量本来就够 max 时不动：noteMm/rows 与不传 max 完全一致", () => {
      const without = sectionGeometryMm({ w: 6, h: 3, cols: 3, gridCols: 12 });
      const withMax = sectionGeometryMm({ w: 6, h: 3, cols: 3, gridCols: 12, max: 3 });
      expect(withMax).toEqual(without);
    });

    it("max 大到按行反推会低于 MIN_SHRINK_NOTE_MM 时，退而求其次摆尽可能多的行，贴纸不低于下限", () => {
      const g = sectionGeometryMm({ w: 6, h: 3, cols: 3, gridCols: 12, max: 99 });
      expect(g.noteMm).toBeGreaterThanOrEqual(MIN_SHRINK_NOTE_MM);
      expect(g.rows).toBeGreaterThanOrEqual(1);
      expect(g.fits).toBeLessThan(99);
      // 再多一行就会跌破下限——证明"尽可能多"不是随便停在某一行。
      const hMm = (3 / 8) * A1_CONTENT_MM.h - 6;
      const availableHeightMm = hMm - titleReserveMm("A1");
      const oneMoreRow = Math.floor((availableHeightMm - GRID_GAP_MM * g.rows) / (g.rows + 1));
      expect(oneMoreRow).toBeLessThan(MIN_SHRINK_NOTE_MM);
    });

    it("区块矮到连 1 行都放不下（可用高度 ≤ 0）时，传 max 也不会凭空造出容量", () => {
      const g = sectionGeometryMm({ w: 6, h: 1, cols: 2, gridCols: 12, size: "A4", max: 9 });
      expect(g.rows).toBe(0);
      expect(g.fits).toBe(0);
    });
  });

  it("贴纸网格可用宽度真的扣了区块自己的内边距/边框——同一区块宽度下，算出的 noteMm 比"
    + "不扣内边距的旧公式更小（人类实测回归钉子：便利贴右侧被区块外壳遮住一半）", () => {
    const g = sectionGeometryMm({ w: 6, h: 3, cols: 5, gridCols: 12 });
    const wMm = (6 / 12) * A1_CONTENT_MM.w - 6;
    const noteMmIfIgnoringChrome = Math.min(MAX_NOTE_MM, Math.round((wMm - 6 * 4) / 5));
    expect(g.noteMm).toBeLessThan(noteMmIfIgnoringChrome);
    // 贴纸网格真实需要的总宽度（cols 张贴纸 + 列间距）必须落在区块扣完内边距/
    // 边框之后的可用宽度以内，不能反过来比可用宽度还宽——这才是"不会被遮住"的
    // 直接判据，不是间接猜 noteMm 变小了就行。`g.noteMm` 是四舍五入过的展示值
    // （`SectionGeometryMm.noteMm` 本身就约定按 mm 取整），5 张贴纸最多累积
    // 5×0.5mm 的取整误差，这条断言只钉"没有结构性超宽"，留够取整的容差。
    const noteGridRequiredWidthMm = 5 * g.noteMm + 6 * 4;
    expect(noteGridRequiredWidthMm).toBeLessThanOrEqual(wMm - blockHorizontalChromeMm("A1") + 5 * 0.5);
  });

  it("区块横向内边距/边框太厚、扣完已经不剩空间时，noteMm 夹到 0 且容量如实归零——不产出「宽度为 0 却报得出正数容量」的假阳性", () => {
    // 2026-09-01 独立审查抓到的问题：noteMm 夹到 0 只挡住了负数，没挡住
    // rows=floor((hMm-reserve)/(0+6)) 分母只剩间距、照样能除出正数行数，
    // fits=cols×rows 跟着报出"这里放得下 N 张宽度为 0 的贴纸"这种假容量。
    const g = sectionGeometryMm({ w: 1, h: 1, cols: 12, gridCols: 12 });
    expect(g.noteMm).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(g.noteMm)).toBe(true);
    expect(g.noteMm).toBe(0);
    // 贴纸边长到 0 ⇒ 这块地方真放不下任何一张，容量必须如实归零。
    expect(g.rows).toBe(0);
    expect(g.fits).toBe(0);
  });

  /**
   * 2026-09-01（第四轮，真实浏览器 e2e 抓到的回归）：`rows` 此前用*未取整*的
   * noteMm 去算，但实际渲染（`notePct`/字号）读的是取整后的 `geom.noteMm`——
   * 取整最多把贴纸边长往上调 0.5mm，多行累加后，容量算出的行数可能比实际
   * 渲染能放下的多一行，最后一行贴纸被裁。A4 纸、2 列、900px 视口下的真实
   * 复现：`noteEdge=688.47 > gridEdge=686`，差 2.47px——这条钉住"容量的 rows
   * 必须用跟展示同一个取整后的 noteMm 算"，不能各算各的。
   */
  it("rows 必须用取整后的 noteMm 算，不能用未取整的内部值——否则容量与实际渲染的贴纸尺寸对不上", () => {
    const cases: SectionGeometryMmInput[] = [
      { w: 6, h: 3, cols: 2, gridCols: 12, size: "A4" }, // 真实复现的那一组
      { w: 6, h: 3, cols: 3, gridCols: 12, size: "A4" },
      { w: 4, h: 5, cols: 5, gridCols: 12, size: "A3" },
      { w: 6, h: 3, cols: 5, gridCols: 12 }, // 默认 A1
    ];
    for (const c of cases) {
      const g = sectionGeometryMm(c);
      const expectedRows = g.noteMm <= 0
        ? 0
        : Math.max(0, Math.floor((g.hMm - titleReserveMm(c.size ?? "A1")) / (g.noteMm + GRID_GAP_MM)));
      expect(g.rows, JSON.stringify(c)).toBe(expectedRows);
    }
  });

  it("列数越多，同一区块下贴纸越小——noteMm 真的随 cols 反推，不是常量", () => {
    const fewCols = sectionGeometryMm({ w: 6, h: 3, cols: 2, gridCols: 12 });
    const manyCols = sectionGeometryMm({ w: 6, h: 3, cols: 8, gridCols: 12 });
    expect(manyCols.noteMm).toBeLessThan(fewCols.noteMm);
  });

  it("同一列数下，区块越窄贴纸越小——noteMm 真的随区块宽度反推，不是常量", () => {
    const wide = sectionGeometryMm({ w: 6, h: 3, cols: 5, gridCols: 12 });
    const narrow = sectionGeometryMm({ w: 1, h: 3, cols: 5, gridCols: 12 });
    expect(narrow.noteMm).toBeLessThan(wide.noteMm);
  });
});

describe("PAPER_SIZE_MM / contentMmFor —— 纸张尺寸预设（2026-08-27）", () => {
  it("A1 恰好等于既有的 A1_PAPER_MM 常量——不是碰巧一致，是同一份数字", () => {
    expect(PAPER_SIZE_MM.A1).toEqual(A1_PAPER_MM);
  });

  it("A3/A4 是 ISO 216 横版标准值，宽 > 高", () => {
    expect(PAPER_SIZE_MM.A3).toEqual({ w: 420, h: 297 });
    expect(PAPER_SIZE_MM.A4).toEqual({ w: 297, h: 210 });
  });

  it("三档共用同一个固定 10mm 页边距，不按纸张比例缩放——A4 的内容区 = 297-20, 210-20", () => {
    expect(contentMmFor("A4")).toEqual({ w: 277, h: 190 });
    expect(contentMmFor("A1")).toEqual(A1_CONTENT_MM);
  });

  it("A1/A3/A4 共享同一个宽高比（ISO 系列的定义性质）——不是巧合，是这三个数字的数学性质", () => {
    const ratio = (s: { w: number; h: number }) => s.w / s.h;
    expect(ratio(PAPER_SIZE_MM.A1)).toBeCloseTo(ratio(PAPER_SIZE_MM.A3), 2);
    expect(ratio(PAPER_SIZE_MM.A1)).toBeCloseTo(ratio(PAPER_SIZE_MM.A4), 2);
  });
});

describe("sectionGeometryMm —— size 参数按纸张切换内容区 mm 数（缺省仍是 A1，不破坏既有调用方）", () => {
  it("省略 size 与显式传 'A1' 结果逐字相同", () => {
    const withoutSize = sectionGeometryMm({ w: 6, h: 3, cols: 5, gridCols: 12 });
    const withA1 = sectionGeometryMm({ w: 6, h: 3, cols: 5, gridCols: 12, size: "A1" });
    expect(withA1).toEqual(withoutSize);
  });

  it("同一份网格坐标，A4 纸算出的 mm 数比 A1 小得多——不是同一个数字换了个标签", () => {
    const onA1 = sectionGeometryMm({ w: 6, h: 3, cols: 5, gridCols: 12, size: "A1" });
    const onA4 = sectionGeometryMm({ w: 6, h: 3, cols: 5, gridCols: 12, size: "A4" });
    expect(onA4.wMm).toBeLessThan(onA1.wMm);
    expect(onA4.hMm).toBeLessThan(onA1.hMm);
  });
});

describe("classifyNoteSize —— Design.pdf §5「尺寸判定」四档，边界值精确落位", () => {
  it.each([
    [45, "too-small"], [46, "compact"], [69, "compact"],
    [70, "standard"], [82, "standard"], [83, "oversized"],
  ] as const)("%dmm → %s", (mm, expected) => {
    expect(classifyNoteSize(mm)).toBe(expected);
  });
});
