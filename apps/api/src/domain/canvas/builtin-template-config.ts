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

  const raw: readonly DerivedLayout[] = sections.map((s, i) => {
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

  return fillGrid(raw, rowOffset);
}

/**
 * 把推演结果**铺满**整张 A1 —— 人类 2026-08-26 截图实测：「对于 A1 的模板，需要 100%
 * 全面覆盖，分配完，目前中间留了一些，不美观」。
 *
 * ## 这推翻了此前「保留原图间隙」的决定
 *
 * 边界吸附会把老 spec 里那些**整行/整列的空带**原样带进来（persona 的第 5 行、bmc 的
 * 第 7 行都是这么空出来的）。当时我判断那是"原图本来就有的间隙，保留它才忠实"——
 * 人类看到真实渲染后否掉了这个判断。这里如实改，并把理由留在原处，不假装从来没那样想过。
 *
 * ## 做法：先压掉空带，再按比例摊回 12×8
 *
 * ⚠ **不**用"让相邻区块朝空处长大"那种贪心：一个 4 格宽的区块要长进只空 1 格的地方就
 *   长不了，于是有些洞永远填不上，而算法本身不会告诉你哪里没填上——它只会安静地留个洞。
 *
 * 压缩-摊开是**闭式**的：
 *   ① 找出真正被占用的行（列同理），空行整行删掉，坐标压成连续的 1..H。
 *   ② 再把 H 行按比例摊回 8 行：第 i 行 → `[round((i-1)*8/H)+1, round(i*8/H)]`。
 *      相邻两行的边界共用同一个 round，所以**不重叠也不留缝**——这是它能保证铺满的原因。
 *
 * 相对版式完全保留：三列还是三列、通栏条还是通栏条，只是把空带的份额还给了实体区块。
 *
 * ⚠ 铺满是"竖直方向上没有空行、水平方向上没有空列"，**不等于**每一格都被占。若某个
 *   模板的某一格确实没人占（老 spec 里就缺一块），这里不会去编一个区块把它填上——
 *   那是发明。`builtin-template-config.test.ts` 逐格断言 19 个模板的真实覆盖率。
 */
function fillGrid(raw: readonly DerivedLayout[], rowOffset: number): readonly DerivedLayout[] {
  if (raw.length === 0) return raw;

  const rowLo = 1 + rowOffset;
  const cols = remap(raw.map((l) => [l.col, l.col + l.w - 1] as const), 1, GRID_COLS);
  const rows = remap(raw.map((l) => [l.row, l.row + l.h - 1] as const), rowLo, GRID_ROWS);

  const spread = raw.map((l, i) => ({
    ...l,
    col: cols[i]![0], row: rows[i]![0],
    w: cols[i]![1] - cols[i]![0] + 1,
    h: rows[i]![1] - rows[i]![0] + 1,
  }));

  return grow(spread, rowLo).map((l) => {
    const A1_CONTENT_W_MM = 821;
    const GAP_MM = 6;
    const widthMm = (l.w / GRID_COLS) * A1_CONTENT_W_MM - GAP_MM;
    // `cols`（贴纸列数）由**最终**宽度重算——铺满后区块变宽了，还用老宽度算出来的
    // 列数会让贴纸比该有的小一号，而那正是 §4.2 那条公式要避免的事。
    return { ...l, cols: clamp(Math.round(widthMm / 82), 3, 8) };
  });
}

/**
 * 收尾：把压缩-摊开填不掉的**零散空格**交给相邻区块长过去。
 *
 * 压缩-摊开只处理**整行/整列**的空带。交错版式（同理心地图的十字、freytag 的阶梯、
 * 三视界的斜切）空出来的是零散格子，整行整列都不空，压不掉——实测这三个模板停在
 * 70.8% / 70.8% / 89.6%。
 *
 * 所以再补一道生长：每个区块轮流朝四个方向各试探一格，**整条边都空着**才长过去
 * （长半条会切进别人身体里）。反复跑到没有任何区块还能长为止。
 *
 * ⚠ 这一道**不保证**能填到 100%：一个 4 格宽的区块要长进只空 1 格的地方就长不了。
 *   所以它不是"填满算法"，是"把band 压缩之后剩下的边角尽量收掉"。真实覆盖率由
 *   `builtin-template-config.test.ts` 逐格数出来断言，不靠这里承诺。
 *
 * ⚠ 顺序固定（按 sections 原序、方向固定为 下→右→上→左），所以同一份 spec 每次长出
 *   完全一样的结果。换成"哪个区块小先长"之类的启发式会让推演不再确定，
 *   而不确定的推演意味着**同一个模板两次回填得到两种版式**。
 */
function grow(
  blocks: readonly DerivedLayout[],
  rowLo: number,
): readonly DerivedLayout[] {
  const out = blocks.map((b) => ({ ...b }));
  const taken = new Set<string>();
  const cellsOf = (b: DerivedLayout): string[] => {
    const cs: string[] = [];
    for (let c = b.col; c < b.col + b.w; c += 1) {
      for (let r = b.row; r < b.row + b.h; r += 1) cs.push(`${c},${r}`);
    }
    return cs;
  };
  for (const b of out) for (const c of cellsOf(b)) taken.add(c);

  const freeSlice = (cs: readonly string[]): boolean => cs.every((c) => !taken.has(c));
  const claim = (cs: readonly string[]): void => { for (const c of cs) taken.add(c); };

  // 上限是格子总数：每一轮至少填掉一格，否则 `moved` 为假直接停。不会转不出来。
  for (let guard = 0; guard < GRID_COLS * GRID_ROWS; guard += 1) {
    let moved = false;
    for (const b of out) {
      // 下
      if (b.row + b.h <= GRID_ROWS) {
        const slice = Array.from({ length: b.w }, (_, i) => `${b.col + i},${b.row + b.h}`);
        if (freeSlice(slice)) { claim(slice); b.h += 1; moved = true; }
      }
      // 右
      if (b.col + b.w <= GRID_COLS) {
        const slice = Array.from({ length: b.h }, (_, i) => `${b.col + b.w},${b.row + i}`);
        if (freeSlice(slice)) { claim(slice); b.w += 1; moved = true; }
      }
      // 上（不越过让给表头的那几行）
      if (b.row - 1 >= rowLo) {
        const slice = Array.from({ length: b.w }, (_, i) => `${b.col + i},${b.row - 1}`);
        if (freeSlice(slice)) { claim(slice); b.row -= 1; b.h += 1; moved = true; }
      }
      // 左
      if (b.col - 1 >= 1) {
        const slice = Array.from({ length: b.h }, (_, i) => `${b.col - 1},${b.row + i}`);
        if (freeSlice(slice)) { claim(slice); b.col -= 1; b.w += 1; moved = true; }
      }
    }
    if (!moved) break;
  }
  return out;
}

/**
 * 一维的「压掉空带 + 按比例摊回」。入参是每个区块的 `[起, 止]` 闭区间（1-based），
 * 出参同型，保证并集恰好覆盖 `[lo, hi]`。
 */
function remap(
  spans: readonly (readonly [number, number])[],
  lo: number,
  hi: number,
): readonly (readonly [number, number])[] {
  const occupied = new Set<number>();
  for (const [a, b] of spans) for (let i = a; i <= b; i += 1) occupied.add(i);

  // 压缩：被占用的刻度按升序编号 1..n；空刻度整格消失。
  const kept = [...occupied].sort((x, y) => x - y);
  const index = new Map(kept.map((v, i) => [v, i + 1]));
  const n = kept.length;
  const total = hi - lo + 1;

  // 摊开：第 i 个压缩刻度 → [lo + round((i-1)*total/n), lo + round(i*total/n) - 1]。
  // 相邻刻度共用同一个 round 边界 ⇒ 首尾相接，既不重叠也不留缝。
  const start = (i: number): number => lo + Math.round(((i - 1) * total) / n);
  return spans.map(([a, b]) => [start(index.get(a)!), start(index.get(b)! + 1) - 1] as const);
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
  // ── 用户旅程（x 轴固定 5 个阶段，见 templates-user.ts 2026-08-29 改版） ──
  "行为 · 阶段1": "actions_phase_1", "行为 · 阶段2": "actions_phase_2",
  "行为 · 阶段3": "actions_phase_3", "行为 · 阶段4": "actions_phase_4",
  "行为 · 阶段5": "actions_phase_5",
  "触点 · 阶段1": "touchpoints_phase_1", "触点 · 阶段2": "touchpoints_phase_2",
  "触点 · 阶段3": "touchpoints_phase_3", "触点 · 阶段4": "touchpoints_phase_4",
  "触点 · 阶段5": "touchpoints_phase_5",
  "痛点 · 阶段1": "pains_phase_1", "痛点 · 阶段2": "pains_phase_2",
  "痛点 · 阶段3": "pains_phase_3", "痛点 · 阶段4": "pains_phase_4",
  "痛点 · 阶段5": "pains_phase_5",
  "机会 · 阶段1": "opportunities_phase_1", "机会 · 阶段2": "opportunities_phase_2",
  "机会 · 阶段3": "opportunities_phase_3", "机会 · 阶段4": "opportunities_phase_4",
  "机会 · 阶段5": "opportunities_phase_5",
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
  // ── 用户旅程（x 轴固定 5 个阶段的表头） ──
  "阶段1": "phase_1_name", "阶段2": "phase_2_name", "阶段3": "phase_3_name",
  "阶段4": "phase_4_name", "阶段5": "phase_5_name",
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

/**
 * 这批分区**在网格上是否 100% 铺满、零重叠**（12×8 = 96 格）。
 *
 * ## 为什么回填的幂等判据需要它，而不是只看「有没有 layout」
 *
 * 2026-08-26 实测事故：回填脚本原先只判「每个分区是否有 layout」。`fillGrid`
 * 铺满算法上线**之前**跑过的那次回填已经给每个分区一个（有空洞的）layout——
 * 于是"有没有"这个判据在算法改进之后判成"已经好了"，铺满算法从此再也不会被
 * 应用到已经回填过的组织。脚本还打印「已带配置，跳过（幂等）」，读起来像一切正常，
 * 实际上界面上（人类截图为证）商业模式画布下方明显留着一整行空白。
 *
 * ## 判据是「铺满」而不是「与最新推演逐字节相等」
 *
 * 后者更严格，但会把「模板配色/列数被人类在编辑器里手动调过」也判成"需要重来"，
 * 而那些改动是人类要保留的，不该被回填覆盖。铺满与否是几何上可独立验证的事实，
 * 不需要引用"最新算法应该长什么样"，因此不会跟人类的手动调整打架。
 */
export function coversFullGrid(
  sections: readonly { readonly layout?: { readonly col: number; readonly row: number; readonly w: number; readonly h: number } | null }[],
): boolean {
  const occupied = new Set<string>();
  for (const s of sections) {
    if (!s.layout) return false;
    const { col, row, w, h } = s.layout;
    for (let c = col; c < col + w; c += 1) {
      for (let r = row; r < row + h; r += 1) occupied.add(`${c},${r}`);
    }
  }
  return occupied.size === GRID_COLS * GRID_ROWS;
}

/**
 * 从真实结构机械生成一份**功能性默认提示词**（编辑器①「角色与任务」）。
 *
 * 人类 2026-08-26 第三轮实测反馈：「现有的历史数据，我看还没有提示词，这个也是问题，
 * 需要修复所有的历史数据」。19 个内置模板没有一份可信的"原始提示词"原文可抄——
 * 与其编一句听起来像原话的文案，不如像推演分区坐标/分区类型那样，**从模板已有的
 * 真实结构**（展示名 + 分区名 + 表头字段名）机械拼出一份能直接用的默认说明。
 *
 * ⚠ 这不是「恢复」，是「生成」。措辞刻意通用（「请基于访谈记录或对话上下文」），
 *   不假装知道每个模板具体的访谈场景——那部分事实本仓确实没有，编了就是虚构。
 */
export function generateDefaultPromptText(
  displayName: string,
  sections: readonly { readonly name: string; readonly type: "便利贴列表" | "短文本" }[],
): string {
  const header = sections.filter((s) => s.type === "短文本").map((s) => s.name);
  const body = sections.filter((s) => s.type !== "短文本").map((s) => s.name);
  const lines = [
    `你是工作坊引导师。请基于访谈记录或对话上下文，为「${displayName}」产出结构化内容。`,
  ];
  if (header.length > 0) lines.push(`先填写表头信息：${header.join("、")}。`);
  lines.push("围绕以下分区逐条产出要点（每条一句简洁的话，紧扣该分区的含义）：");
  for (const name of body) lines.push(`- ${name}`);
  return lines.join("\n");
}

/**
 * 19 个内置模板的**默认推荐关系**（issue #2825）——「画完这个，接着画哪几个」。
 *
 * ## 它服务于哪件事
 *
 * chat 建议行里的画布模板推荐（`application/chat/recommend-canvas-templates.ts`）。
 * 库里 `canvas_templates.recommend_after` 才是权威——组织可以在 template-admin 里
 * 改任意一条。本表只是**内置模板从未被配置过**（该列仍是空数组）时的兜底默认值，
 * 与 `generateDefaultPromptText` 对 `prompt_text` 空值的兜底是同一条既有纪律
 * （见 `pg-canvas-template-repository.ts` 的 `promptText` 兜底注释）：让顾问打开
 * 编辑器、让使用者打开 chat，看到的都是一份**可用的**默认配置，而不是等谁去跑一次
 * 回填脚本。非内置模板（组织自建）不兜底——它们留空是合法状态。
 *
 * ## 这些关系不是编的，也不是唯一正确的
 *
 * 取自设计思维/精益创业里通用的工作坊顺序：先理解人（画像 → 旅程/同理心）、
 * 再定义问题（→ HMW）、再提方案（→ 价值主张 → 商业模式 → MVP 实验）。这是一份
 * **默认值**，不是断言「一定要这么走」——顾问团队的方法论各不相同，所以它可改，
 * 而且改了立刻生效（读路径只在库里为空时才回落到这里）。
 *
 * ⚠ 只写**推荐得出去**的边。没有出边的模板（如 `mvp`、`storyboard`）不在表里，
 *   等于「画完它之后本表不额外推荐什么」——不是漏了。
 * ⚠ 入度为 0 的 key（`persona` / `hmw` / `pestel` / `swot` / `ai-strategy` / `freytag` /
 *   `burger` / `golden-circle` / `three-lenses` / `three-horizons`）是**起点模板**：
 *   线程里还一个画布都没有时推荐它们。那个判定由消费端从本表（或库里的实际配置）
 *   现算入度得出，**不在这里再写第二份"起点清单"**。
 */
export const BUILTIN_RECOMMEND_AFTER: Readonly<Record<string, readonly string[]>> = {
  // 理解人：画像之后自然是旅程与同理心，或者追问"他想完成什么任务"。
  persona: ["journey-map", "empathy", "jtbd"],
  empathy: ["hmw", "jtbd"],
  "journey-map": ["hmw", "storyboard"],
  jtbd: ["value-proposition", "hmw"],
  // 定义问题 → 提方案。
  hmw: ["value-proposition", "storyboard"],
  "value-proposition": ["adlib", "bmc"],
  adlib: ["bmc"],
  // 商业化与验证。
  bmc: ["mvp", "three-horizons"],
  "ai-bmc": ["mvp"],
  "ai-strategy": ["ai-bmc", "three-horizons"],
  // 外部环境 → 内部态势 → 未来布局。
  pestel: ["swot"],
  swot: ["three-horizons", "bmc"],
  "three-horizons": ["mvp"],
  // 叙事线。
  "golden-circle": ["adlib", "storyboard"],
  freytag: ["storyboard"],
  "three-lenses": ["hmw"],
  burger: ["hmw"],
};
