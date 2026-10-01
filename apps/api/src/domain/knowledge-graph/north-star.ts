/**
 * issue #4360（S5）北极星指标：**新会话里重复交代已知背景的比例**（越低越好）。纯函数部分，
 * 采集脚本是 `apps/api/scripts/north-star-restate-rate.ts`（读库，loopback / devapp 都能跑）。
 *
 * 口径：
 *   - 一个「新会话」= 本人的一个个人对话，只看它的**第一条**本人消息；
 *   - 「已知背景」= 这个对话开始之前，本人长期记忆里、以及本人别的个人对话里已经记下、当时还活着的、属于「关于我」
 *     四组的条目（分组规则同契约 `kgProfileSection`：目标 / 偏好 / 约束与身份 / 在做的事）；
 *   - 「重复交代」= 第一条消息把某条已知背景又说了一遍：那条背景的词元（同召回字面路的 `lexicalTokens`：拉丁词 + 汉字二字组）
 *     有 ≥ `RESTATE_MIN_COVERAGE` 出现在消息里。只看有已知背景的会话（没有背景就谈不上重复）。
 * 这是一个保守的字面口径（换了说法的复述数不到），适合看趋势，不是精确的语义判断。
 */
import { knowledgeGraph as KG } from "@repo/contracts";
import { lexicalTokens } from "./recall";

export const RESTATE_MIN_COVERAGE = 0.6;
/** 太短的背景（词元 < 3）不参与判定：「我是老师」这种一句话里顺带提到很正常，不算重复交代。 */
const MIN_BACKGROUND_TOKENS = 3;

export interface BackgroundClaim {
  readonly id: string;
  readonly kind: KG.KgClaimKind;
  readonly statement: string;
}

/** 这条消息重复交代了哪些已知背景（id）。 */
export function restatedBackground(message: string, background: readonly BackgroundClaim[]): string[] {
  const msg = lexicalTokens(message);
  return background
    .filter((c) => KG.kgProfileSection(c.kind, c.statement) !== null)
    .filter((c) => {
      const t = lexicalTokens(c.statement);
      if (t.size < MIN_BACKGROUND_TOKENS) return false;
      let hit = 0;
      for (const x of t) if (msg.has(x)) hit += 1;
      return hit / t.size >= RESTATE_MIN_COVERAGE;
    })
    .map((c) => c.id);
}

export interface SessionSample {
  readonly threadId: string;
  readonly userId: string;
  readonly firstMessage: string;
  readonly background: readonly BackgroundClaim[];
}

export interface NorthStarReport {
  /** 有已知背景的新会话数（分母） */
  readonly sessions: number;
  /** 其中第一条消息重复交代了已知背景的会话数 */
  readonly restated: number;
  /** restated / sessions；没有分母为 null */
  readonly rate: number | null;
  readonly perSession: readonly { readonly threadId: string; readonly userId: string; readonly restatedClaimIds: readonly string[] }[];
}

export function northStar(samples: readonly SessionSample[]): NorthStarReport {
  const withBackground = samples.filter((s) => s.background.some((c) => KG.kgProfileSection(c.kind, c.statement) !== null));
  const perSession = withBackground.map((s) => ({ threadId: s.threadId, userId: s.userId, restatedClaimIds: restatedBackground(s.firstMessage, s.background) }));
  const restated = perSession.filter((p) => p.restatedClaimIds.length > 0).length;
  return { sessions: perSession.length, restated, rate: perSession.length === 0 ? null : restated / perSession.length, perSession };
}
