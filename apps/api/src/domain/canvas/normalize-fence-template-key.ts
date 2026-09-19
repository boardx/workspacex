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

/**
 * Which published templates a piece of user text names -- by key, display name or one of the
 * ALIASES above (same normalization as the fence-key correction, so "用户画像" and
 * "user profile" both resolve to `persona`). Used to inject only the named templates'
 * guidance instead of the whole library (#3749 B1.2).
 */
export function matchCanvasTemplatesInText(text: string, templates: readonly CanvasTemplateRef[]): readonly string[] {
  const hay = norm(text);
  if (!hay) return [];
  const hits: string[] = [];
  for (const t of templates) {
    const names = [t.key, t.displayName, ...(ALIASES[t.key] ?? [])].map(norm).filter((n) => n.length >= 2);
    if (names.some((n) => hay.includes(n))) hits.push(t.key);
  }
  return hits;
}

/** Does the text ask for a workshop canvas at all (without naming which one)? */
export function mentionsCanvasIntent(text: string): boolean {
  return /画布|工作坊|协作模板|canvas/i.test(text);
}

/** A published template with the names the fence body must use (see `templateSectionNames`). */
export interface CanvasTemplateShape extends CanvasTemplateRef {
  readonly sections?: readonly string[];
  readonly fields?: readonly string[];
}

export interface FenceSectionCorrection {
  readonly template: string;
  readonly kind: "section" | "field";
  readonly from: string;
  readonly to: string;
}

/** Strip what a small model likes to add to a name: brackets, counts, numbering, spacing. */
function bareName(raw: string): string {
  return raw
    .replace(/[（(【\[][^）)】\]]*[）)】\]]/g, "")   // （最多4条） / (6) / 【…】
    .replace(/^\s*\d+\s*[.、)）:：-]\s*/, "")       // "1. " / "1、"
    .replace(/[:：]\s*$/, "")
    .trim();
}

function resolveName(raw: string, names: readonly string[]): string | null {
  if (names.includes(raw)) return raw;
  const bare = bareName(raw);
  if (names.includes(bare)) return bare;
  const n = norm(bare);
  if (n === "") return null;
  const exact = names.filter((x) => norm(x) === n);
  if (exact.length === 1) return exact[0]!;
  // "阶段1行为" vs "行为 · 阶段1": same characters, different order / separators
  const sameChars = names.filter((x) => { const a = [...norm(x)].sort().join(""); return a === [...n].sort().join(""); });
  if (sameChars.length === 1) return sameChars[0]!;
  const contains = names.filter((x) => { const m = norm(x); return m.length >= 2 && (n.includes(m) || m.includes(n)); });
  if (contains.length === 1) return contains[0]!;
  return null;
}

const FENCE_BLOCK = /(```canvas[^\n]*\n)([\s\S]*?)(\n```)/g;
const HEADING = /^(##\s+)(.+?)\s*$/;
const FIELD = /^([^#\-\n][^:：\n]{0,60}?)\s*([:：])(.*)$/;

/**
 * Rewrite `## 分区名` and header `字段名: 值` lines inside every ```canvas fence to the
 * template's real names when the model decorated, reordered or re-spelled them (the three
 * shapes the 2026-09-10 journey-map lost a whole canvas to). Unknown names stay untouched.
 * Runs after `normalizeCanvasFenceTemplateKeys`, so `模板:` already holds a real key.
 */
export function normalizeCanvasFenceSections(text: string, templates: readonly CanvasTemplateShape[]): { text: string; corrections: readonly FenceSectionCorrection[] } {
  if (templates.length === 0 || !text.includes("```canvas")) return { text, corrections: [] };
  const corrections: FenceSectionCorrection[] = [];
  const out = text.replace(FENCE_BLOCK, (whole, head: string, body: string, tail: string) => {
    const lines = body.split("\n");
    const keyLine = lines.find((l) => /^\s*模板\s*[:：]/.test(l));
    const key = keyLine?.replace(/^\s*模板\s*[:：]\s*/, "").trim();
    const t = templates.find((x) => x.key === key);
    if (!t || (!t.sections?.length && !t.fields?.length)) return whole;
    let seenHeading = false;
    const fixed = lines.map((line) => {
      const h = HEADING.exec(line);
      if (h) {
        seenHeading = true;
        const to = t.sections?.length ? resolveName(h[2]!, t.sections) : null;
        if (to !== null && to !== h[2]) { corrections.push({ template: t.key, kind: "section", from: h[2]!, to }); return `${h[1]}${to}`; }
        return line;
      }
      if (!seenHeading && t.fields?.length && !/^\s*模板\s*[:：]/.test(line)) {
        const f = FIELD.exec(line);
        if (f) {
          const to = resolveName(f[1]!.trim(), t.fields);
          if (to !== null && to !== f[1]!.trim()) { corrections.push({ template: t.key, kind: "field", from: f[1]!.trim(), to }); return `${to}${f[2]}${f[3]}`; }
        }
      }
      return line;
    });
    return `${head}${fixed.join("\n")}${tail}`;
  });
  return { text: out, corrections };
}
