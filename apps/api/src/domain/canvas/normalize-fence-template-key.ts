/**
 * Deterministic correction of the `模板: <key>` line in ```canvas fences before write-back.
 *
 * 人类决策 2026-09-17（B）：本地 4B 模型在自由文本请求下会把模板 key 自造成
 * `user-portrait` / `user-demographics-and-psychographics` / `<personality>`（应为 `persona`），
 * 网页端按「不猜」纪律遇到未知 key 不渲染。校正只在**确定性**命中时发生：
 *   1. 已是有效 key（大小写不敏感、去掉 `<>` 引号）→ 原样；
 *   2. 等于某模板的显示名 → 那个 key；
 *   3. 归一化（小写、去非字母数字）后等于某 key 或显示名；
 *   4. 归一化后命中一条**只指向一个 key** 的别名（下表）。
 * 多于一个候选、或一个都没有 ⇒ 不动，留给网页端如实报「模板不存在」。每次校正都回给调用方
 * 记入日志，不静默。
 */
export interface CanvasTemplateRef {
  readonly key: string;
  readonly displayName: string;
}

export interface FenceKeyCorrection {
  readonly from: string;
  readonly to: string;
}

/** Common wrong spellings a small model produces, normalized (lowercase, alphanumerics only). */
const ALIASES: Readonly<Record<string, readonly string[]>> = {
  persona: ["userpersona", "userportrait", "portrait", "userprofile", "profile", "userdemographics", "demographics", "userdemographicsandpsychographics", "personality", "用户画像", "画像"],
  bmc: ["businessmodelcanvas", "businessmodel", "商业模式画布"],
  swot: ["swotanalysis", "swot分析"],
  "value-proposition": ["valuepropositioncanvas", "valueproposition", "价值主张画布"],
  "journey-map": ["userjourneymap", "userjourney", "journeymap", "customerjourney", "customerjourneymap", "用户旅程图"],
  jtbd: ["jobstobedone", "jobtobedone", "待完成工作画布"],
  empathy: ["empathymap", "同理心地图"],
  pestel: ["pestelanalysis", "pest", "pestle", "pestel分析"],
  hmw: ["howmightwe", "hmw问题陈述"],
  storyboard: ["storyboardcanvas", "故事板"],
  "golden-circle": ["goldencircle", "黄金圈法则"],
  "three-horizons": ["threehorizons", "3horizons", "三地平线模型"],
  "three-lenses": ["threelenses", "3lenses", "三视角模型"],
  mvp: ["mvpcanvas", "mvpexperiment", "mvp实验画布"],
  freytag: ["freytagspyramid", "freytagpyramid", "戏剧结构金字塔"],
  burger: ["burgermodel", "汉堡沟通模型"],
  maau: ["maaucanvas", "maau画布"],
  adlib: ["adlibvalueproposition", "价值主张宣言"],
  "ai-bmc": ["aibusinessmodelcanvas", "aibmc", "ai商业模型画布"],
  "ai-strategy": ["aistrategycanvas", "aistrategy", "ai战略画布"],
};

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9一-鿿]/g, "");
}

export function resolveFenceTemplateKey(raw: string, templates: readonly CanvasTemplateRef[]): string | null {
  const wanted = raw.trim().replace(/^[<「『"'`]+|[>」』"'`]+$/g, "").trim();
  if (wanted === "") return null;
  const keys = new Set(templates.map((t) => t.key));
  if (keys.has(wanted)) return wanted;
  const lower = wanted.toLowerCase();
  const ci = templates.filter((t) => t.key.toLowerCase() === lower);
  if (ci.length === 1) return ci[0]!.key;
  const byName = templates.filter((t) => t.displayName.trim() === wanted);
  if (byName.length === 1) return byName[0]!.key;
  const n = norm(wanted);
  if (n === "") return null;
  const byNorm = templates.filter((t) => norm(t.key) === n || norm(t.displayName) === n);
  if (byNorm.length === 1) return byNorm[0]!.key;
  const byAlias = templates.filter((t) => (ALIASES[t.key] ?? []).some((a) => norm(a) === n));
  if (byAlias.length === 1) return byAlias[0]!.key;
  return null;
}

const FENCE_HEAD = /(```canvas[^\n]*\n[ \t]*模板[ \t]*[:：][ \t]*)([^\n]*)/g;

/** Rewrite unknown-but-resolvable template keys in every ```canvas fence of `text`. */
export function normalizeCanvasFenceTemplateKeys(text: string, templates: readonly CanvasTemplateRef[]): { text: string; corrections: readonly FenceKeyCorrection[] } {
  if (templates.length === 0 || !text.includes("```canvas")) return { text, corrections: [] };
  const corrections: FenceKeyCorrection[] = [];
  const out = text.replace(FENCE_HEAD, (whole, head: string, rawKey: string) => {
    const from = rawKey.trim();
    if (templates.some((t) => t.key === from)) return whole;
    const to = resolveFenceTemplateKey(from, templates);
    if (to === null || to === from) return whole;
    corrections.push({ from, to });
    return `${head}${to}`;
  });
  return { text: out, corrections };
}
