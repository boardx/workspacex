/**
 * 设计工作台 × Claude Design 对标评测集 —— 10 个「普通人会提的需求」与各自的**金标准产出**。
 *
 * ## 这份文件是什么
 *
 * 每个用例 = 一句需求（`brief`）+ 一份「一个 Claude Design 水平的设计工具应该给出的原型」
 * （`frames` / `prototype` / `frameLinks` / `tokens`）。评测 spec（`design-parity.eval.ts`）把金标准
 * 喂给**真的**设计详情页（`page.route` 夹具，同 `design-loop-fixtures.mjs` 的范式），然后在真浏览器里
 * 检查：这份产出我们**画不画得出来、能不能改、能不能交出去**。
 *
 * ## 为什么金标准里有契约还没有的原语（table / chart / select / radio / overlay / section / footer）
 *
 * 这是刻意的。评测量的是**差距**，金标准写的是「目标长什么样」，不是「我们现在能表达什么」。
 * 如果按现有契约去写金标准，评测永远满分，那就什么都没量。基线时这些用例会渲染失败——
 * 那就是差距本身。形状在本文件里第一次被定义，之后实现时以它为准（改形状要在 README 里记一笔）。
 *
 * ## 冻结规则
 *
 * 用例与金标准在 R0（2026-09-23）冻结。之后的迭代**只能**修评测本身的 bug（并在报告里写明理由），
 * 不能为了让分数上去而改金标准或放宽检查——否则分数就不再是同一把尺子量出来的。
 *
 * ## 它不量什么
 *
 * **生成质量**（真实模型画得好不好）。本容器没有真实模型的凭据；金标准是人写的「理想产出」，
 * 所以这里量的是**产品能力**（表达力、编辑、协作、交付），不是模型的审美。生成质量要靠
 * 真实模型车道（`.harness/instructions/real-model-e2e.md`）+ 人工盲评，见 README。
 */

const NOW = "2026-09-23T02:00:00.000Z";

/** 没写 id 的节点按「用例 + 遍历序」补一个；被跳转/检查引用的节点都显式写了 id，不受插入平移影响。 */
function withIds(caseId, roots) {
  let k = 0;
  const fill = (n) => ({ ...n, id: n.id ?? `${caseId.toLowerCase()}-n${(k += 1)}`, ...(Array.isArray(n.children) ? { children: n.children.map(fill) } : {}) });
  return roots.map(fill);
}

/** 与 `DESIGN_PROJECTS` 同形的项目外壳：契约里必给/有默认值的字段一次补齐。 */
function project(c) {
  return {
    id: `eval-${c.id}`,
    name: c.name,
    template: c.template ?? "mobile",
    problem: c.brief,
    criteria: ["明确问题与目标范围", "给出交互方案与边界情况处理", "列出验收标准供工程对齐"],
    frames: c.frames,
    prototype: withIds(c.id, c.prototype),
    frameNotes: c.frameNotes ?? c.frames.map(() => ""),
    ...(c.frameLinks !== undefined ? { frameLinks: c.frameLinks } : {}),
    ...(c.tokens !== undefined ? { tokens: c.tokens } : {}),
    pushed: false, pushedAt: null, linkedFeedbackId: null,
    chat: [
      { role: "user", text: c.brief, at: NOW },
      { role: "ai", text: `画好了 ${c.frames.length} 页：${c.frames.join("、")}。要改哪里直接说。`, at: NOW, source: "model" },
    ],
    theme: c.theme ?? "light", accent: c.accent ?? "neutral", tags: [], refImages: [], share: null,
    githubIssueUrl: null, githubIssueNumber: null,
    ownerId: "u-pm-1", ownerName: "评测 · PM",
    createdAt: NOW, updatedAt: NOW,
  };
}

const t = (content, variant, extra = {}) => ({ type: "text", props: { content, ...(variant ? { variant } : {}), ...extra } });
const btn = (id, label, variant = "primary", extra = {}) => ({ id, type: "button", props: { label, variant, ...extra } });
const col = (children, props = {}) => ({ type: "stack", props: { direction: "column", gap: "md", padding: "md", ...props }, children });
const row = (children, props = {}) => ({ type: "stack", props: { direction: "row", gap: "sm", ...props }, children });

export const EVAL_CASES = [
  /* E01 —— 最常见的那一句：移动端聊天 App（三页 + 页间跳转）。只用现有原语。 */
  {
    id: "E01", name: "对话助手 App", device: "iphone", theme: "dark",
    brief: "给我设计一个 chat 的 UI，模拟 chatgpt：会话列表、消息流、输入区、发送/停止。",
    frames: ["聊天", "历史会话", "设置"],
    prototype: [
      col([
        { id: "e01-nav", type: "navbar", props: { title: "对话助手", left: "☰", right: "新对话" } },
        { type: "stack", props: { fill: true, gap: "sm", padding: "sm" }, children: [
          t("退款政策改写", "title"),
          t("今天 14:02", "caption", { muted: true }),
          { type: "card", children: [t("帮我把这段退款政策改成客户能看懂的话。")] },
          { id: "e01-reply", type: "card", children: [t("好的。简版：7 天内未使用可全额退款。")] },
        ] },
        row([{ type: "input", props: { placeholder: "发送消息" } }, btn("e01-send", "发送")], { padding: "sm" }),
        { id: "e01-tabs", type: "bottomnav", props: { items: ["聊天", "历史", "设置"], active: 0, icons: ["message", "clock", "settings"] } },
      ]),
      col([
        { type: "navbar", props: { title: "历史会话" } },
        { type: "input", props: { placeholder: "搜索会话" } },
        { type: "tabs", props: { items: ["全部", "已收藏"], active: 0 } },
        { type: "list", props: { items: ["退款政策改写", "周报润色", "SQL 解释"], detail: ["7 天内未使用…", "本周完成了…", "这条查询…"], trailing: ["14:02", "昨天", "周一"] } },
        { type: "bottomnav", props: { items: ["聊天", "历史", "设置"], active: 1, icons: ["message", "clock", "settings"] } },
      ]),
      col([
        { type: "navbar", props: { title: "设置" } },
        { type: "stack", props: { direction: "row", gap: "sm", align: "center" }, children: [{ type: "avatar", props: { name: "苏木" } }, t("苏木 · 客服组", "subtitle")] },
        { type: "switch", props: { label: "深色模式", on: true } },
        { type: "switch", props: { label: "发送前确认", on: false } },
        { type: "bottomnav", props: { items: ["聊天", "历史", "设置"], active: 2, icons: ["message", "clock", "settings"] } },
      ]),
    ],
    frameLinks: [[{ from: "e01-tabs", item: 1, to: 1 }, { from: "e01-tabs", item: 2, to: 2 }], [], []],
  },

  /* E02 —— 电商下单：预览里控件要能真的点（tabs 切换、开关、勾选、输入）。只用现有原语。 */
  {
    id: "E02", name: "会员下单", device: "iphone", theme: "light",
    brief: "做一个会员下单流程：商品详情选规格、确认订单、支付成功。",
    frames: ["商品详情", "确认订单"],
    prototype: [
      col([
        { type: "navbar", props: { title: "商品详情", left: "‹" } },
        { type: "image", props: { alt: "商品主图", ratio: "square", kind: "photo" } },
        t("年度会员 · 专业版", "title"),
        t("¥ 298 / 年", "subtitle"),
        { id: "e02-tabs", type: "tabs", props: { items: ["详情", "规格", "评价"], active: 0 } },
        { id: "e02-auto", type: "switch", props: { label: "到期自动续费", on: false } },
        { id: "e02-agree", type: "checkbox", props: { label: "我已阅读并同意会员协议", checked: false } },
        btn("e02-buy", "立即购买", "primary", { full: true }),
      ]),
      col([
        { type: "navbar", props: { title: "确认订单", left: "‹" } },
        { id: "e02-coupon", type: "input", props: { label: "优惠码", placeholder: "输入优惠码" } },
        { type: "list", props: { items: ["年度会员 · 专业版", "优惠"], trailing: ["¥298", "-¥30"] } },
        btn("e02-pay", "提交订单 ¥268", "primary", { full: true }),
      ]),
    ],
    frameLinks: [[{ from: "e02-buy", to: 1 }], []],
  },

  /* E03 —— 桌面端 SaaS 数据看板：侧栏 + 指标 + 表格 + 图表。table / chart 是目标原语。 */
  {
    id: "E03", name: "销售数据看板", device: "desktop", template: "ui", theme: "light",
    brief: "做一个销售团队用的数据看板（电脑上用）：左侧导航、顶部四个指标、中间一张趋势图、下面一张订单表。",
    frames: ["看板"],
    prototype: [
      row([
        { id: "e03-side", type: "stack", props: { direction: "column", gap: "sm", padding: "md" }, children: [
          t("Acme 销售", "subtitle"),
          { type: "list", props: { items: ["总览", "订单", "客户", "报表"], leading: "icon", icons: ["home", "cart", "users", "chart"] } },
        ] },
        { type: "stack", props: { direction: "column", gap: "md", padding: "md", fill: true }, children: [
          t("总览", "title"),
          { type: "grid", props: { columns: 3, gap: "md" }, children: [
            { type: "stat", props: { label: "本月销售额", value: "¥1,284,000", delta: "+12%", tone: "success" } },
            { type: "stat", props: { label: "订单数", value: "3,412", delta: "+4%", tone: "success" } },
            { type: "stat", props: { label: "退款率", value: "1.8%", delta: "-0.3%", tone: "success" } },
          ] },
          { id: "e03-chart", type: "chart", props: { kind: "line", title: "近 6 个月销售额（万元）", labels: ["4月", "5月", "6月", "7月", "8月", "9月"], values: [82, 91, 88, 104, 117, 128] } },
          { id: "e03-table", type: "table", props: { columns: ["订单号", "客户", "金额", "状态"], rows: [
            ["#10231", "星海科技", "¥12,800", "已付款"],
            ["#10230", "北辰贸易", "¥4,560", "待发货"],
            ["#10229", "云杉餐饮", "¥980", "已退款"],
            ["#10228", "青禾教育", "¥23,400", "已付款"],
          ] } },
        ] },
      ], { gap: "none" }),
    ],
  },

  /* E04 —— 官网落地页：分区（section）+ 功能网格 + 价格 + 页脚（footer）。section / footer 是目标原语。 */
  {
    id: "E04", name: "SaaS 官网", device: "desktop", template: "ui", theme: "light",
    brief: "给我们的记账 SaaS 做一个官网首页：大标题、三个卖点、价格方案、页脚。",
    frames: ["首页"],
    prototype: [
      col([
        { type: "navbar", props: { title: "轻账", right: "免费试用" } },
        { id: "e04-hero", type: "section", props: { tone: "primary" }, children: [
          { type: "hero", props: { title: "五分钟搞定一个月的账", subtitle: "自动对账、发票识别、报表一键导出。", cta: "免费试用 14 天" } },
        ] },
        { id: "e04-features", type: "section", props: { tone: "default" }, children: [
          t("为什么选轻账", "title", { align: "center" }),
          { type: "grid", props: { columns: 3, gap: "md" }, children: [
            { type: "card", props: { title: "自动对账" }, children: [t("连上银行卡，流水自动归类。", "body")] },
            { type: "card", props: { title: "发票识别" }, children: [t("拍照即录入，识别准确率 99%。", "body")] },
            { type: "card", props: { title: "一键报表" }, children: [t("资产负债表、利润表随时导出。", "body")] },
          ] },
        ] },
        { id: "e04-pricing", type: "section", props: { tone: "muted" }, children: [
          t("价格", "title", { align: "center" }),
          { type: "grid", props: { columns: 3, gap: "md" }, children: [
            { type: "card", props: { title: "个人版" }, children: [t("¥0 / 月", "subtitle"), btn("e04-p1", "开始使用", "secondary", { full: true })] },
            { type: "card", props: { title: "团队版" }, children: [t("¥99 / 月", "subtitle"), btn("e04-p2", "免费试用", "primary", { full: true })] },
            { type: "card", props: { title: "企业版" }, children: [t("联系销售", "subtitle"), btn("e04-p3", "预约演示", "secondary", { full: true })] },
          ] },
        ] },
        { id: "e04-footer", type: "footer", props: { brand: "轻账", links: ["产品", "价格", "帮助中心", "隐私政策"], note: "© 2026 轻账科技" } },
      ], { padding: "none", gap: "none" }),
    ],
  },

  /* E05 —— 注册表单：下拉选择 + 单选组。select / radio 是目标原语。 */
  {
    id: "E05", name: "注册资料", device: "iphone", theme: "light",
    brief: "做一个注册后完善资料的页面：昵称、所在城市（下拉选）、性别（单选）、提交。",
    frames: ["完善资料"],
    prototype: [
      col([
        { type: "navbar", props: { title: "完善资料", left: "‹" } },
        { type: "input", props: { label: "昵称", placeholder: "给自己起个名字" } },
        { id: "e05-city", type: "select", props: { label: "所在城市", options: ["北京", "上海", "广州", "深圳"], value: "上海" } },
        { id: "e05-gender", type: "radio", props: { label: "性别", options: ["男", "女", "不透露"], selected: 2 } },
        btn("e05-submit", "完成", "primary", { full: true }),
      ]),
    ],
  },

  /* E06 —— 设置页 + 删除确认弹窗：叠层（overlay）是目标原语。 */
  {
    id: "E06", name: "账号设置", device: "iphone", theme: "light",
    brief: "做一个账号设置页，最下面有「注销账号」，点了弹出二次确认。",
    frames: ["设置", "注销确认"],
    prototype: [
      col([
        { type: "navbar", props: { title: "账号设置", left: "‹" } },
        { type: "list", props: { items: ["个人资料", "账号安全", "通知"], leading: "icon", icons: ["user", "lock", "bell"] } },
        btn("e06-delete", "注销账号", "danger", { full: true }),
      ]),
      col([
        { type: "navbar", props: { title: "账号设置", left: "‹" } },
        { type: "list", props: { items: ["个人资料", "账号安全", "通知"] } },
        { id: "e06-modal", type: "overlay", props: { kind: "modal", title: "确定注销账号？" }, children: [
          t("注销后 30 天内可恢复，之后所有数据将被永久删除。", "body"),
          row([btn("e06-cancel", "再想想", "secondary"), btn("e06-confirm", "确认注销", "danger")]),
        ] },
      ]),
    ],
    frameLinks: [[{ from: "e06-delete", to: 1 }], [{ from: "e06-cancel", to: 0 }]],
  },

  /* E07 —— 路演幻灯片：16:9 画布（slide 设备）。 */
  {
    id: "E07", name: "融资路演", device: "slide", template: "ui", theme: "light",
    brief: "帮我做三页融资路演幻灯片：封面、市场规模、团队。",
    frames: ["封面", "市场规模", "团队"],
    prototype: [
      col([{ type: "hero", props: { title: "轻账：小微企业的自动财务", subtitle: "A 轮融资 · 2026" } }], { align: "center" }),
      col([t("市场规模", "title"), { type: "grid", props: { columns: 3 }, children: [
        { type: "stat", props: { label: "TAM", value: "¥3,200 亿" } },
        { type: "stat", props: { label: "SAM", value: "¥480 亿" } },
        { type: "stat", props: { label: "SOM", value: "¥36 亿" } },
      ] }]),
      col([t("团队", "title"), { type: "grid", props: { columns: 3 }, children: [
        { type: "card", props: { title: "CEO 林舟" }, children: [t("前某支付公司产品 VP", "caption")] },
        { type: "card", props: { title: "CTO 许言" }, children: [t("十年财税系统架构", "caption")] },
        { type: "card", props: { title: "COO 周禾" }, children: [t("服务过 2 万家小微企业", "caption")] },
      ] }]),
    ],
  },

  /* E08 —— 品牌化：自定义品牌色 + 衬线字体 + 圆角/密度（设计系统 tokens）。 */
  {
    id: "E08", name: "山野餐厅订座", device: "iphone", theme: "light",
    tokens: { brand: "#FF5A1F", font: "serif", radius: "round", density: "comfortable" },
    brief: "给我的餐厅做订座小程序，品牌色是橙色 #FF5A1F，字体要有质感（衬线），整体圆润一点。",
    frames: ["首页", "订座"],
    prototype: [
      col([
        { type: "navbar", props: { title: "山野餐厅" } },
        { type: "image", props: { alt: "餐厅环境", ratio: "wide", kind: "photo" } },
        t("今晚还有 6 个座位", "title"),
        t("营业至 22:00 · 人均 ¥168", "caption", { muted: true }),
        { type: "card", props: { title: "招牌菜" }, children: [t("柴火焖鸡、松茸汤、手打荞麦面", "body")] },
        btn("e08-book", "立即订座", "primary", { full: true }),
      ]),
      col([
        { type: "navbar", props: { title: "订座", left: "‹" } },
        { type: "tabs", props: { items: ["今天", "明天", "周六"], active: 0 } },
        { type: "grid", props: { columns: 3, gap: "sm" }, children: [
          { type: "chip", props: { label: "18:00", selected: true } }, { type: "chip", props: { label: "19:00" } }, { type: "chip", props: { label: "20:30" } },
        ] },
        btn("e08-confirm", "确认订座", "primary", { full: true }),
      ]),
    ],
    frameLinks: [[{ from: "e08-book", to: 1 }], []],
  },

  /* E09 —— 深色音乐播放器：主题与强调色要落到每一页。只用现有原语。 */
  {
    id: "E09", name: "音乐播放器", device: "iphone", theme: "dark", accent: "violet",
    brief: "做一个深色风格的音乐播放器：正在播放、歌单。",
    frames: ["正在播放", "歌单"],
    prototype: [
      col([
        { type: "navbar", props: { title: "正在播放", left: "‹" } },
        { type: "image", props: { alt: "专辑封面", ratio: "square", kind: "illustration" } },
        t("夜航星", "title", { align: "center" }),
        t("不才", "caption", { align: "center", muted: true }),
        { type: "progress", props: { value: 42, label: "1:48 / 4:15" } },
        row([btn("e09-prev", "上一首", "ghost"), btn("e09-play", "暂停", "primary", { icon: "pause" }), btn("e09-next", "下一首", "ghost")], { align: "between" }),
      ]),
      col([
        { type: "navbar", props: { title: "我的歌单" } },
        { type: "list", props: { items: ["夜航星", "起风了", "平凡之路"], detail: ["不才", "买辣椒也用券", "朴树"], trailing: ["4:15", "5:25", "5:01"] } },
        btn("e09-shuffle", "随机播放", "primary", { full: true, icon: "play" }),
      ]),
    ],
  },

  /* E10 —— 健身打卡：带数据的柱状图（chart）是目标原语。 */
  {
    id: "E10", name: "健身打卡", device: "iphone", theme: "light",
    brief: "做一个健身打卡 App 的周报页：本周每天运动分钟数的柱状图，和连续打卡天数。",
    frames: ["周报"],
    prototype: [
      col([
        { type: "navbar", props: { title: "本周运动" } },
        { type: "stat", props: { label: "连续打卡", value: "12 天", delta: "+1", tone: "success" } },
        { id: "e10-chart", type: "chart", props: { kind: "bar", title: "每日运动（分钟）", labels: ["一", "二", "三", "四", "五", "六", "日"], values: [30, 45, 0, 60, 25, 90, 40] } },
        btn("e10-share", "分享周报", "primary", { full: true, icon: "share" }),
      ]),
    ],
  },
];

export const EVAL_PROJECTS = EVAL_CASES.map(project);
