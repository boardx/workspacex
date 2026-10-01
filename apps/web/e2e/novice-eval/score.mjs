/**
 * 设计工作台「普通用户可用性」评分——**权重、预算、术语表的唯一事实源**。
 *
 * 普通用户 = 不懂设计、也不懂工程的业务人员（PM / 运营）。衡量的是：不看说明能不能把事做完、
 * 要动几下、第一眼要面对多少东西、看不看得懂上面的字。
 *
 * ## 两个分数分开记（同 `.harness/rubrics/prototype-screenshot-audit.md` 的纪律）
 *
 * · **机器分**（本文件）：每条检查都是浏览器里量出来的确定事实，0–10。
 * · **模型软分**：视觉模型看同一批截图打「普通用户会不会觉得好用」，另记，**不合成**。
 * 目标：两个都 ≥ 9。机器分不许被软分抵消。
 *
 * ## 为什么用夹具而不是真模型
 *
 * 这套量的是**界面**对普通用户的复杂度，不是模型画得好不好（那是 `evals/design-generation` 的事）。
 * 生成结果用 `recorded/` 里**真实模型原样录下的输出**：内容是真的，每次跑都一样——稳定。
 */

/** 维度与权重（和为 1）。每个维度的分 = 该维度下通过的检查占比。 */
export const DIMENSIONS = {
  task: { weight: 0.35, label: "能把事做完（新建 / 修改 / 撤销 / 预览 / 分享 / 找回旧版）" },
  steps: { weight: 0.15, label: "动几下就能做完（每个任务的操作次数 ≤ 预算）" },
  clutter: { weight: 0.15, label: "第一眼不被淹没（首屏可操作控件数 ≤ 预算）" },
  jargon: { weight: 0.15, label: "看得懂上面的字（首屏不出现设计师 / 工程术语）" },
  states: { weight: 0.1, label: "等待和出错时知道发生了什么、下一步做什么" },
  access: { weight: 0.1, label: "看得清、手机上也能用（对比度 AA、窄屏无横向滚动）" },
};

/** 每个任务允许的操作次数（点击 / 输入各算一次）。按「一个普通用户最少要动几下」定。 */
export const STEP_BUDGET = {
  create: 3,   // 点新建 → 写一句话 → 点生成
  modify: 2,   // 写一句要改什么 → 发送
  undo: 1,
  preview: 2,  // 进预览 → 点原型里的按钮
  share: 2,    // 点分享 → 拿到链接（可能多一次确认）
  restore: 3,  // 打开历史 → 选一版 → 恢复
};

/** 首屏（不滚动）可操作控件数上限——不含原型画面本身里的控件。 */
export const CLUTTER_BUDGET = {
  workbench: 8,
  newDialog: 6,
  detail: 15,
};

/**
 * 普通用户看不懂、或者会误解的词。出现在首屏（原型画面之外）就扣分。
 * 判据是「一个业务人员第一次看到会不会卡住」，不是「这个词对不对」。
 */
export const JARGON = [
  "图层", "页面结构", "纵向布局", "横向布局", "组件", "节点", "代码", "批注", "方案",
  "推送到收件箱", "线框图", "token", "Token", "radius", "density", "JSON", "frame",
];

/** 把一次运行的检查结果算成分数。`checks`: { id, dim, pass, detail }[] */
export function score(checks) {
  const byDim = {};
  for (const [dim] of Object.entries(DIMENSIONS)) byDim[dim] = { pass: 0, total: 0, failed: [] };
  for (const c of checks) {
    const d = byDim[c.dim];
    if (d === undefined) throw new Error(`未知维度 ${c.dim}（检查 ${c.id}）`);
    d.total += 1;
    if (c.pass) d.pass += 1; else d.failed.push(c);
  }
  let total = 0;
  const rows = [];
  for (const [dim, meta] of Object.entries(DIMENSIONS)) {
    const d = byDim[dim];
    // 空集防线：一个维度一条检查都没跑到 ⇒ 判 0，不因为「没发现问题」给满分。
    const ratio = d.total === 0 ? 0 : d.pass / d.total;
    total += ratio * meta.weight;
    rows.push({ dim, label: meta.label, pass: d.pass, total: d.total, ratio, failed: d.failed });
  }
  return { score: Math.round(total * 100) / 10, rows };
}

/** Markdown 报告：分数 + 每个维度没过的检查（backlog 就从这里来）。 */
export function report(result) {
  const lines = [`# 设计工作台 · 普通用户可用性（机器分）：${result.score.toFixed(1)} / 10`, ""];
  lines.push("| 维度 | 通过 | 分 |", "|---|---|---|");
  for (const r of result.rows) lines.push(`| ${r.label} | ${r.pass}/${r.total} | ${(r.ratio * 10).toFixed(1)} |`);
  lines.push("", "## 没过的检查");
  for (const r of result.rows) for (const f of r.failed) lines.push(`- **${f.id}**（${r.dim}）：${f.detail}`);
  return lines.join("\n");
}
