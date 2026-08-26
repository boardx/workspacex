/**
 * 从 `fabric-markdown` 的内置模板 spec **推演**出画布模板的完整配置（R8，2026-08-26）。
 *
 * ## 为什么需要它
 *
 * 人类原话：「你可否推演目前有的模板的配置数据，比如用户画像，你要补充上去，这样我
 * 可以修改，所有的不同阶段的数据都可以查看和修改」。
 *
 * 19 个内置模板此前是由 `scripts/backfill-canvas-builtin-templates.ts` 从 fabric-markdown
 * 的 spec 灌进库的，但**只取了分区名**（`{sectionId, name, order, required:false,
 * capacity:null}`）——没有 `key`、没有 `type`、没有 `layout`。后果是这些模板在 R3 的
 * 拖拽编辑器里打开时：字段没有可用的 `{{token}}`、画布上一个区块都没有、右栏无从设置。
 * 使用者「查看和修改」不了它们。
 *
 * ## 推演，不是编造——每一栏都有真实来源
 *
 * · **layout 的 col/row/w/h** ← spec 里每个 section 的**真实 px 坐标**（`{x,y,w,h}`，
 *   中心点+尺寸，落在 `A0_FRAME` 这个从六个内置模板反推出来的基准画幅里）。
 *   px → 12×8 网格是一次纯算术换算，没有任何自由度。
 * · **type** ← spec 的两类结构：`sections`（分区框，装便签）→ `便利贴列表`；
 *   `fields`（表头字段，如姓名/性别/年龄）→ `短文本`。这是 fabric-markdown 自己的
 *   区分，不是我给它分的类。
 * · **key** ← 下面的 `SECTION_KEYS` 字典（114 个中文分区名 → 英文 key）。
 *
 * ## key 字典为什么是手写的、以及它错了会怎样
 *
 * `key` 是 **AI 返回 JSON 的键名**（契约 `SectionDef.key`，小写英文+下划线），要让
 * 顾问在提示词里写得出 `{{goals}}` 这种一眼认得的占位符。中文名没有机械可靠的转英文
 * 路径——音译（`yong_hu_miao_shu`）合法但没人认得，机器翻译不稳定且同一个词在不同
 * 模板里可能翻出不同结果（那会破坏「同名分区在不同模板里 key 一致」这个人对得上的
 * 预期）。所以这里是一份**审过的字典**。
 *
 * ⚠ 字典没覆盖到的名字**不会被瞎猜**：`deriveKey` 回 `null`，调用方按位置生成
 *   `field_N` 并把这一条报出来，让人回来补。一个看起来像英文、其实对不上语义的 key
 *   比一个明显是占位的 `field_3` 更糟——后者一眼知道要改，前者会被当成已经对了。
 */

const GRID_COLS = 12;
const GRID_ROWS = 8;

export interface FabricSectionSpec {
  readonly name: string;
  /** 中心点 + 尺寸（px），与 `TemplateSection` 同型。 */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface DerivedLayout {
  readonly col: number;
  readonly row: number;
  readonly w: number;
  readonly h: number;
  readonly cols: number;
  readonly max: number;
  readonly tone: number;
  readonly overflow: "缩小字号";
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * 一个模板的全部分区 → 12×8 网格坐标。**纯算术，没有自由度。**
 *
 * ## 为什么按"每个模板自己的外接框"归一化，而不是一个固定基准画幅
 *
 * 起初这里用 `auto-template-layout.ts` 的 `A0_FRAME`（{60,10,1580,920}）当基准。但那个
 * 画幅是**从六个内置模板反推出来的近似值**，不是所有模板都落在里面——`journey-map`
 * 的分区一直画到 y=1240，硬夹到 920 会把「痛点」和「机会」压成同一行（实测：两者
 * 推出完全相同的 (2,8,11,1)）。丢掉的正是"这个模板长什么样"本身。
 *
 * 改成按每个模板自己的外接框归一化：新模型的画布**就是** 12×8 的 A1，而老 spec 的
 * px 画幅逐个不同；把一个模板的自身范围映到 12×8，**相对版式完全保留**——三列就还是
 * 三列、通栏条就还是通栏条，这才是"推演出它现在长什么样"。
 *
 * ## 两条边各自吸附，宽高由边推出
 *
 * ⚠ 不能把「位置」和「尺寸」分别取整：那样分区之间的间隙会被各自的舍入吃掉，相邻块
 *   粘连（实测 bmc 的「关键资源」与「收入来源」、ai-bmc 的三处都这么撞上）。
 *   左/上边吸附成起始格，右/下边吸附成结束格，跨度 = 结束 - 起始 + 1。
 */
export function deriveTemplateLayouts(
  sections: readonly FabricSectionSpec[],
  /** 网格顶部要让出的行数（给表头字段），缺省 0。 */
  rowOffset = 0,
): readonly DerivedLayout[] {
  if (sections.length === 0) return [];
  const usableRows = GRID_ROWS - rowOffset;

  // 该模板自身的外接框。
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const s of sections) {
    left = Math.min(left, s.x - s.w / 2);
    top = Math.min(top, s.y - s.h / 2);
    right = Math.max(right, s.x + s.w / 2);
    bottom = Math.max(bottom, s.y + s.h / 2);
  }
  const frameW = right - left;
  const frameH = bottom - top;
  const cellW = frameW > 0 ? frameW / GRID_COLS : 1;
  const cellH = frameH > 0 ? frameH / usableRows : 1;

  return sections.map((s, i) => {
    const startCol = clamp(Math.round((s.x - s.w / 2 - left) / cellW) + 1, 1, GRID_COLS);
    const endCol = clamp(Math.round((s.x + s.w / 2 - left) / cellW), startCol, GRID_COLS);
    const startRow = clamp(Math.round((s.y - s.h / 2 - top) / cellH) + 1 + rowOffset, 1 + rowOffset, GRID_ROWS);
    const endRow = clamp(Math.round((s.y + s.h / 2 - top) / cellH) + rowOffset, startRow, GRID_ROWS);
    const w = endCol - startCol + 1;
    const h = endRow - startRow + 1;

    // `cols` 由物理宽度推出，与 `defaultLayoutAt` 同一条公式（`Design.pdf` §4.2：
    // round(区块宽mm / 82)，夹在 3-8，使贴纸落在 76mm 标准附近）。
    const A1_CONTENT_W_MM = 821;
    const GAP_MM = 6;
    const widthMm = (w / GRID_COLS) * A1_CONTENT_W_MM - GAP_MM;
    const cols = clamp(Math.round(widthMm / 82), 3, 8);

    return {
      col: startCol, row: startRow, w, h, cols,
      max: 6,
      // 同一个模板里的分区轮流用四色，让画布一眼分得出块——按顺序不是随机，
      // 同一个模板每次推演出来的配色完全一致。
      tone: i % 4,
      overflow: "缩小字号" as const,
    };
  });
}

/**
 * 中文分区名 → AI JSON 键名。见文件头「key 字典为什么是手写的」。
 *
 * 同一个中文名在不同模板里**共用同一个 key**（如「痛点」恒为 `pains`）——顾问换模板
 * 时不必重学一套占位符。
 */
const SECTION_KEYS: Readonly<Record<string, string>> = {
  // ── 用户画像 persona ──
  "用户描述": "description", "目标和需求": "goals", "行为与偏好": "behaviors",
  "痛点和挑战": "pains", "动机": "motivation", "影响因素": "factors",
  // ── PESTEL ──
  "政治因素": "political", "经济因素": "economic", "社会因素": "social",
  "技术因素": "technological", "环境因素": "environmental", "法律因素": "legal",
  // ── SWOT ──
  "优势": "strengths", "劣势": "weaknesses", "机会": "opportunities", "威胁": "threats",
  // ── 商业模式画布 bmc ──
  "关键合作伙伴": "key_partners", "关键业务": "key_activities", "关键资源": "key_resources",
  "价值主张": "value_propositions", "客户关系": "customer_relationships", "渠道": "channels",
  "客户细分": "customer_segments", "收入来源": "revenue_streams", "成本结构": "cost_structure",
  // ── MVP / 实验 ──
  "早期客户": "early_adopters", "未满足需求": "unmet_needs", "愿景与假设": "vision_and_assumptions",
  "核心用户旅程": "core_user_journey", "实验设计": "experiment_design",
  "早期关键指标": "early_metrics", "实验结果与下一步": "results_and_next_steps",
  // ── 三地平线 ──
  "H1 焦点领域": "h1_focus", "H2 焦点领域": "h2_focus", "H3 焦点领域": "h3_focus",
  "第一地平线（1-3年）": "horizon_1", "第二地平线（3-5年）": "horizon_2",
  "第三地平线（5年以上）": "horizon_3", "资源配置": "resource_allocation",
  // ── AI 策略 ──
  "AI角色定位": "ai_role", "风格调性": "tone_of_voice", "背景信息": "background",
  "企业定位": "company_positioning", "产品服务": "products_and_services",
  "目标受众": "target_audience", "规则": "rules", "需求与目标": "needs_and_goals",
  // ── AI 商业模式 ──
  "核心合作伙伴": "key_partners", "输入": "inputs", "输出": "outputs",
  "技术能力": "tech_capabilities", "训练人员": "training_people",
  "用户与客户": "users_and_customers", "资源考量": "resource_considerations",
  "成本": "costs", "利益相关方": "stakeholders",
  // ── 同理心地图 ──
  "想的与感受到的": "thinks_and_feels", "听到的": "hears", "看到的": "sees",
  "说的与做的": "says_and_does", "痛点": "pains", "收益": "gains",
  // ── JTBD ──
  "情境触发": "situation", "核心任务": "core_job", "期望成果": "desired_outcomes",
  "内在驱动": "motivations", "痛点阻力": "frictions", "成功标准": "success_criteria",
  // ── 用户旅程 ──
  "旅程阶段": "journey_stages", "行为": "actions", "触点": "touchpoints",
  // ── 价值主张画布 ──
  "收益创造": "gain_creators", "痛点缓解": "pain_relievers",
  "产品与服务": "products_and_services", "用户任务": "customer_jobs",
  // ── Ad-lib 价值主张 ──
  "我们的": "our_offering", "帮助": "helps", "想要实现": "who_want_to",
  "减少或避免": "by_reducing", "提升或赋能": "by_increasing",
  "竞争对手价值主张": "unlike_competitor",
  // ── 八宫格创意 ──
  "想法1": "idea_1", "想法2": "idea_2", "想法3": "idea_3", "想法4": "idea_4",
  "想法5": "idea_5", "想法6": "idea_6", "想法7": "idea_7", "想法8": "idea_8",
  // ── 故事结构 freytag / storyboard ──
  "高光点": "climax", "情节演进": "rising_action", "结束": "resolution",
  "开场": "exposition", "冲突": "conflict", "收尾": "falling_action",
  "角色设定": "characters", "故事主题": "theme",
  "1 开场": "scene_1_exposition", "2 冲突": "scene_2_conflict",
  "3 情节演进": "scene_3_rising_action", "4 高光点": "scene_4_climax",
  "5 结束": "scene_5_resolution", "6 收尾": "scene_6_falling_action",
  // ── 汉堡沟通 burger ──
  "开场引入": "opening", "核心洞察 WHY": "insight_why", "实现路径 HOW": "path_how",
  "解决方案 WHAT": "solution_what", "行动闭环": "call_to_action",
  // ── 黄金圈 ──
  "WHY": "why", "HOW": "how", "WHAT": "what",
  // ── 三透镜 ──
  "人本期望 Desirability": "desirability", "技术可行 Feasibility": "feasibility",
  "商业可行 Viability": "viability",
};

/** 表头字段（`spec.fields`）的 key 字典——它们是短文本，不是便签分区。 */
const FIELD_KEYS: Readonly<Record<string, string>> = {
  "姓名": "name", "性别": "gender", "年龄": "age", "区域": "region",
  "教育水平": "education", "职位": "job_title", "行业": "industry",
  "家庭情况": "family", "收入水平": "income",
  "标题": "title",
  // ── 干系人 / 决策链 ──
  "执行者": "doer", "决策者": "decider", "付费者": "payer", "关键约束": "constraints",
  // ── HMW / Ad-lib ──
  "我们可以如何": "how_might_we", "为给": "for_whom", "以便": "so_that",
  // ── 故事 ──
  "故事主角": "protagonist", "故事主题": "theme",
};

/**
 * 中文名 → key。**查不到时回 `null`，不瞎猜**（见文件头最后一段）。
 */
export function deriveKey(chineseName: string, kind: "section" | "field"): string | null {
  const dict = kind === "field" ? FIELD_KEYS : SECTION_KEYS;
  return dict[chineseName.trim()] ?? null;
}

/** 字典覆盖率——供 backfill 脚本自检并把没覆盖的名字报出来。 */
export function keyDictionaryCoverage(names: readonly string[], kind: "section" | "field"): {
  readonly covered: readonly string[];
  readonly missing: readonly string[];
} {
  const covered: string[] = [];
  const missing: string[] = [];
  for (const n of names) (deriveKey(n, kind) === null ? missing : covered).push(n);
  return { covered, missing };
}

/**
 * 一个内置模板的 fabric spec → 契约 `SectionDef[]`（带 key / type / layout）。
 *
 * ## 为什么表头字段也变成分区
 *
 * fabric spec 把模板分成两截：`fields`（表头,如 persona 的姓名/性别/年龄——**纯字符串,
 * 没有任何几何信息**）与 `sections`（正文,有 x/y/w/h）。新模型只有「分区」一个概念,
 * 所以表头字段必须落成分区才能被查看和修改——留在模型外就等于**永远改不了**,
 * 而人类的原话正是「所有的不同阶段的数据都可以查看和修改」。
 *
 * 落法：表头字段占**网格第 1 行**、类型 `短文本`（单行,不是便利贴列表）,正文分区整体
 * 下移一行推进剩下的 7 行。⚠ 这一行不是发明出来的位置——fabric 渲染时表头本来就画在
 * 正文网格**上方的标题带**里,第 1 行是它在新模型里最近的等价物。
 *
 * ## 这里不发明 required / capacity
 *
 * 老 spec 里没有这两件事实,推不出来。照 `backfill-canvas-builtin-templates.ts` 现有写法
 * 如实留白（`required: false` / `capacity: null`）——编一个"看起来合理"的值会让后来的人
 * 以为那是原模板的设定。
 */
export function buildBuiltinSections(spec: {
  readonly fields?: readonly string[];
  readonly sections: readonly FabricSectionSpec[];
}): readonly {
  sectionId: string; name: string; order: number; required: boolean; capacity: null;
  key: string | undefined; type: "便利贴列表" | "短文本"; layout: DerivedLayout;
}[] {
  const fields = spec.fields ?? [];
  const hasHeader = fields.length > 0;
  const bodyLayouts = deriveTemplateLayouts(spec.sections, hasHeader ? 1 : 0);

  // 表头字段等分第 1 行的 12 格。用**边界**算而不是各自 floor(12/n)：后者在 n=9 时
  // 每块 1 格、末尾空出 3 格；按边界切则宽度自动分成 1/2 格,整行铺满、无缝。
  const n = fields.length;
  const header = fields.map((name, i) => {
    const col = Math.floor((i * GRID_COLS) / n) + 1;
    const next = Math.floor(((i + 1) * GRID_COLS) / n) + 1;
    return {
      sectionId: `f${i + 1}`,
      name,
      order: i,
      required: false,
      capacity: null,
      key: deriveKey(name, "field") ?? undefined,
      type: "短文本" as const,
      layout: {
        col, row: 1, w: Math.max(1, next - col), h: 1,
        cols: 3, max: 6, tone: i % 4, overflow: "缩小字号" as const,
      },
    };
  });

  const body = spec.sections.map((sec, i) => ({
    sectionId: `s${i + 1}`,
    name: sec.name,
    order: n + i,
    required: false,
    capacity: null,
    key: deriveKey(sec.name, "section") ?? undefined,
    type: "便利贴列表" as const,
    layout: bodyLayouts[i]!,
  }));

  return [...header, ...body];
}
