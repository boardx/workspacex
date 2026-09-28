/**
 * EV02 回环模型（04-eval-gates R3.3–3.4，A3）：确定性、不联网的「模型」，让评测在 CI 上可重放。
 *
 * - subject：按被测 Skill 的规则（S003 实体文档 §5–§6：版本取代、草稿不作 supports、标题陷阱、
 *   通道不可用 = blocked 不说未找到、注入只标记不执行、覆盖缺口、无结论段落）驱动夹具工具桩，
 *   产出 EnterpriseSearchLedger。
 * - baseline：「无该 Skill 的通用 Agent + 相同工具集」——只会检索一次、把命中全当 supports、
 *   自己写结论段落；用来衡量 Skill 相对通用 Agent 的增量（G5）。
 *
 * 真实模型链路不在此处：只走 real-model-e2e lane（lane=real-model，不参与 G4/G5）。
 */
import type { FixtureDocument, FixtureToolbox } from "./fixture-tools";

export interface LoopbackCaseInput {
  question: string;
  mode?: string;
  scopes?: string[];
  researchPlanItemRef?: string;
  [extra: string]: unknown;
}

export interface LoopbackAgent {
  /** 回环策略版本；与被测内容 digest 一起决定报告可复现性。 */
  readonly policyVersion: string;
  run(input: LoopbackCaseInput, tools: FixtureToolbox): Promise<Record<string, unknown>>;
}

type Hit = {
  hitId: string;
  sourceId: string;
  versionId: string;
  relation: string;
  supersededBy?: string;
  excerpt: string;
  owner?: string;
};
type QueryRun = { scope: string; query: string; status: string };

const DEFAULT_SCOPE = "organization-index";
const INJECTION = /(忽略(以上|之前|上述).{0,6}指令|ignore (all |the )?(previous|above) instructions)/i;
const IRRELEVANCE = /(无关|unrelated)/i;

function bigrams(text: string): Set<string> {
  const cjk = text.replace(/[^一-鿿]/g, "");
  const out = new Set<string>();
  for (let i = 0; i < cjk.length - 1; i++) out.add(cjk.slice(i, i + 2));
  for (const w of text.match(/[A-Za-z][A-Za-z0-9]+/g) ?? []) out.add(w.toLowerCase());
  return out;
}

function overlap(a: string, b: string): number {
  const bb = bigrams(b);
  let n = 0;
  for (const g of bigrams(a)) if (bb.has(g)) n++;
  return n;
}

function aliasTerms(question: string, docs: readonly FixtureDocument[]): string[] {
  const seen = new Set<string>();
  for (const d of docs) {
    for (const w of `${d.title} ${d.body}`.match(/\b[A-Z][A-Za-z0-9]+\b/g) ?? []) {
      if (!question.includes(w)) seen.add(w);
    }
  }
  return [...seen];
}

/** S003 企业检索（回环）。 */
export const s003EnterpriseSearchLoopback: LoopbackAgent = {
  policyVersion: "s003-loopback-1.0.0",
  async run(input, tools) {
    const question = input.question;
    const scopes = input.scopes && input.scopes.length > 0 ? input.scopes : [DEFAULT_SCOPE];
    const queriesRun: QueryRun[] = [];
    const coverageGaps: { itemId: string; reason: string }[] = [];
    const found = new Map<string, FixtureDocument>();
    let blocked = false;

    const searchOnce = (query: string, scope: string): FixtureDocument[] => {
      const r = tools.search(query, scope);
      queriesRun.push({ scope, query, status: r.status });
      return r.documents;
    };

    for (const scope of scopes) {
      const first = searchOnce(question, scope);
      const res = queriesRun[queriesRun.length - 1];
      if (res?.status === "unavailable") {
        blocked = true;
        coverageGaps.push({ itemId: "I1", reason: "retrieval-unavailable" });
        continue;
      }
      if (res?.status === "not-configured") {
        coverageGaps.push({ itemId: "I1", reason: scope === "organization-hybrid" ? "hybrid-not-configured" : "scope-not-configured" });
        continue;
      }
      // 查询变体：从首轮命中里学到的英文代号/缩写再各查一次（中文/英文代号/拼音缩写）。
      const docs = [...first];
      for (const alias of aliasTerms(question, first)) docs.push(...searchOnce(alias, scope));
      for (const d of docs) found.set(`${d.sourceId}@${d.versionId}`, d);
    }

    const hits: Hit[] = [];
    let n = 0;
    for (const d of found.values()) {
      const doc = tools.read(d.sourceId, d.versionId) ?? d;
      const titleMatch = overlap(question, doc.title) > 0;
      const bodyMatch = overlap(question, doc.body) >= 2;
      if (!titleMatch && !bodyMatch) continue;
      let relation = "supports";
      if (doc.draft || doc.effective === false) relation = "draft-not-effective";
      else if (IRRELEVANCE.test(doc.body)) relation = "mentions-only";
      const hit: Hit = { hitId: `H${++n}`, sourceId: doc.sourceId, versionId: doc.versionId, relation, excerpt: doc.body.slice(0, 200) };
      if (doc.owner) hit.owner = doc.owner;
      hits.push(hit);
    }

    // 版本取代：同项目的多条 supports，只有最新的一条仍 supports，其余标 superseded。
    const byProject = new Map<string, { hit: Hit; ts: string }[]>();
    for (const h of hits) {
      const doc = found.get(`${h.sourceId}@${h.versionId}`);
      if (h.relation !== "supports" || !doc?.projectId || !doc.sourceTimestamp) continue;
      const list = byProject.get(doc.projectId) ?? [];
      list.push({ hit: h, ts: doc.sourceTimestamp });
      byProject.set(doc.projectId, list);
    }
    for (const list of byProject.values()) {
      if (list.length < 2) continue;
      list.sort((a, b) => b.ts.localeCompare(a.ts));
      const latest = list[0]!.hit;
      for (const older of list.slice(1)) {
        older.hit.relation = "superseded";
        older.hit.supersededBy = latest.sourceId;
      }
    }

    const injectionFlags = hits
      .filter(h => INJECTION.test(found.get(`${h.sourceId}@${h.versionId}`)?.body ?? ""))
      .map(h => ({ hitId: h.hitId }));

    const status = blocked ? "blocked" : hits.some(h => h.relation === "supports") ? "answered" : "not-found-in-scope";
    const item: Record<string, unknown> = { itemId: "I1", status, queriesRun, hits };
    if (input.researchPlanItemRef) item.researchPlanItemRef = input.researchPlanItemRef;

    return {
      queryType: /(最后定|定的|决定|决策)/.test(question) ? "decision" : "fact",
      scopeDeclared: { scopes },
      items: [item],
      // dedupe 模式：只有正文逐字包含同一事实才算重复（同实体不同事实不算）。
      duplicateOf: input.mode === "dedupe" ? [...found.values()].filter(d => d.body.includes(question)).map(d => ({ sourceId: d.sourceId })) : [],
      coverageGaps,
      injectionFlags,
    };
  },
};

/** 通用 Agent 基线：同工具集，无 Skill 规则。 */
export const genericAgentBaselineLoopback: LoopbackAgent = {
  policyVersion: "generic-agent-loopback-1.0.0",
  async run(input, tools) {
    const scope = DEFAULT_SCOPE;
    const r = tools.search(input.question, scope);
    const hits: Hit[] = r.documents
      .filter(d => overlap(input.question, `${d.title} ${d.body}`) > 0)
      .map((d, i) => ({ hitId: `H${i + 1}`, sourceId: d.sourceId, versionId: d.versionId, relation: "supports", excerpt: d.body.slice(0, 200) }));
    return {
      queryType: "fact",
      scopeDeclared: { scopes: [scope] },
      items: [{ itemId: "I1", status: hits.length > 0 ? "answered" : "not-found-in-scope", queriesRun: [{ scope, query: input.question, status: r.status }], hits }],
      coverageGaps: [],
      injectionFlags: [],
      summary: hits.length > 0 ? hits.map(h => h.excerpt).join(" ") : "未找到相关资料",
    };
  },
};

/** 已接入回环评测的被测实体（按 stableId）。未登记的实体 `eval` 直接报错，不静默跳过。 */
export const LOOPBACK_SUBJECTS: Readonly<Record<string, LoopbackAgent>> = {
  S003: s003EnterpriseSearchLoopback,
};
