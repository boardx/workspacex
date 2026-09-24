/**
 * feature-transition 的反证套件（#400）。
 *
 * 纪律同 lint-third-artifact.test.ts：每一条断言对应一种**真实可行**的破坏方式，
 * 先确认它会红，才有资格相信它绿的时候说明了什么。最后一组是反向反证——
 * 一道永远红的门等于没有门，所以合法迁移必须确确实实是绿的。
 *
 * 这里造的是纯数据快照；真 git 仓库上的端到端反证在
 * `.harness/scripts/lint-feature-transition.test.ts`。
 */
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  judgeFeatureTransitions,
  type CommitOracle,
  type FeatureSnapshot,
  type TransitionRule,
} from "./feature-transition";

const SHA = "a".repeat(40);
const OTHER_SHA = "b".repeat(40);

/** 默认预言机：两个 sha 都存在，只有 SHA 在 head 血统里。 */
const oracle: CommitOracle = {
  exists: (s) => s === SHA || s === OTHER_SHA,
  isAncestorOfHead: (s) => s === SHA,
};

/** 造一份**真的**能通过 checkFingerprint 的日志——尾行格式与 evidence-fingerprint.ts 一致。 */
function attested(body: string, commit = SHA): string {
  const sha256 = createHash("sha256").update(body, "utf8").digest("hex");
  return `${body}\n[harness-verify v1 sha256=${sha256} commit=${commit} at=2026-09-21T00:00:00.000Z]`;
}

const LOG = attested("$ pnpm test\n[exit 0]\nok");

function f(over: Partial<FeatureSnapshot> = {}): FeatureSnapshot {
  return {
    id: "F01",
    status: "in_progress",
    owner: "worker-a",
    evidence: "",
    sprint: "01",
    evidenceLog: null,
    logPath: null,
    evidenceBlob: null,
    ...over,
  };
}

/** 一条走完 verify 的 passing 快照。 */
function passing(over: Partial<FeatureSnapshot> = {}): FeatureSnapshot {
  return f({
    status: "passing",
    evidence: "evidence/F01.verify.log @ 2026-09-21T00:00:00.000Z",
    evidenceLog: LOG,
    logPath: "phases/phase-99-demo/sprints/sprint-01/evidence/F01.verify.log",
    evidenceBlob: "blob-f01",
    ...over,
  });
}

/** 默认的 blob 表：只有 F01 自己那一份，没有孪生兄弟。 */
const SOLO_BLOBS = new Map<string, readonly string[]>([
  ["blob-f01", ["phases/phase-99-demo/sprints/sprint-01/evidence/F01.verify.log"]],
]);

function judge(
  base: FeatureSnapshot[],
  head: FeatureSnapshot[],
  o: CommitOracle = oracle,
  headEvidenceBlobs: ReadonlyMap<string, readonly string[]> = SOLO_BLOBS
) {
  return judgeFeatureTransitions({ phases: [{ phaseDir: "phase-99-demo", base, head }], headEvidenceBlobs }, o);
}

function rules(base: FeatureSnapshot[], head: FeatureSnapshot[], o?: CommitOracle): TransitionRule[] {
  return judge(base, head, o).findings.map((x) => x.rule);
}

function rulesWith(
  base: FeatureSnapshot[],
  head: FeatureSnapshot[],
  headEvidenceBlobs: ReadonlyMap<string, readonly string[]>
): TransitionRule[] {
  return judge(base, head, oracle, headEvidenceBlobs).findings.map((x) => x.rule);
}

describe("合法迁移必须是绿的（反向反证：永远红的门等于没有门）", () => {
  it("in_progress → passing，证据是真 verify 产物 ⇒ 无 finding", () => {
    const v = judge([f()], [passing()]);
    expect(v.findings).toEqual([]);
    expect(v.examined).toBe(1); // 确实判过，不是空转
  });

  it("not_started → in_progress 认领 ⇒ 无 finding", () => {
    expect(rules([f({ status: "not_started", owner: null })], [f()])).toEqual([]);
  });

  it("in_progress → blocked 再回 in_progress ⇒ 无 finding", () => {
    expect(rules([f()], [f({ status: "blocked" })])).toEqual([]);
    expect(rules([f({ status: "blocked" })], [f()])).toEqual([]);
  });

  it("owner 从 null 变成认领人 ⇒ 不算抢占", () => {
    expect(rules([f({ status: "in_progress", owner: null })], [f()])).toEqual([]);
  });

  it("两侧完全一致的 feature 整条跳过（只判迁移，不审全树）", () => {
    const v = judge([passing()], [passing()]);
    expect(v.findings).toEqual([]);
    expect(v.examined).toBe(0);
  });

  it("verify --backfill-evidence：日志重新落盘 + evidence 时间戳同步刷新 ⇒ 放行", () => {
    const fresh = attested("$ pnpm test\n[exit 0]\nok（重跑）");
    const head = passing({ evidence: "evidence/F01.verify.log @ 2026-09-22T00:00:00.000Z", evidenceLog: fresh });
    expect(rules([passing()], [head])).toEqual([]);
  });
});

describe("破坏方式 ①：手改 passing", () => {
  it("status 直接翻 passing、evidence 写人话 ⇒ direct_passing_edit", () => {
    const head = f({ status: "passing", evidence: "跑过了，能用" });
    expect(rules([f()], [head])).toEqual(["direct_passing_edit"]);
  });

  it("status 翻 passing、evidence 留空 ⇒ direct_passing_edit", () => {
    expect(rules([f()], [f({ status: "passing" })])).toEqual(["direct_passing_edit"]);
  });

  it("借用别的 feature 的合法日志 ⇒ direct_passing_edit", () => {
    const head = f({
      status: "passing",
      evidence: "evidence/F02.verify.log @ 2026-09-21T00:00:00.000Z",
      evidenceLog: LOG,
    });
    expect(rules([f()], [head])).toEqual(["direct_passing_edit"]);
  });

  it("指针是标准路径但日志文件不存在 ⇒ evidence_log_missing", () => {
    expect(rules([f()], [passing({ evidenceLog: null })])).toEqual(["evidence_log_missing"]);
  });

  it("日志是手写的（没有 verify 尾行）⇒ evidence_unattested", () => {
    const head = passing({ evidenceLog: "$ pnpm test\n[exit 0]\n看起来挺好" });
    expect(rules([f()], [head])).toEqual(["evidence_unattested"]);
  });

  it("凭空新增一条已经是 passing 的 feature（base 上不存在）也要查出处", () => {
    expect(rules([], [f({ status: "passing", evidence: "手填" })])).toEqual(["direct_passing_edit"]);
  });
});

describe("破坏方式 ②：改写日志 + 重算指纹", () => {
  it("正文改了但尾行没重算 ⇒ evidence_tampered", () => {
    const head = passing({
      evidence: "evidence/F01.verify.log @ 2026-09-22T00:00:00.000Z",
      evidenceLog: LOG.replace("[exit 0]", "[exit 1]"),
    });
    expect(rules([passing()], [head])).toEqual(["evidence_tampered"]);
  });

  it("正文改了、尾行也重算过（最终树完全自洽）⇒ 仍然 evidence_rewritten", () => {
    // 这一条是本门存在的全部理由：checkFingerprint 对它返回 ok，
    // doctor / ratchet / fingerprint 三道门在最终树上都看不出任何问题。
    const forged = attested("$ pnpm test\n[exit 0]\n（把 exit 1 改成了 exit 0）");
    const head = passing({ evidenceLog: forged });
    expect(rules([passing()], [head])).toEqual(["evidence_rewritten"]);
  });

  it("尾行 commit 是 unknown ⇒ attestation_unverifiable", () => {
    const head = passing({ evidenceLog: attested("body", "unknown") });
    expect(rules([f()], [head])).toEqual(["attestation_unverifiable"]);
  });

  it("尾行 commit 存在但不在 head 血统里 ⇒ attestation_unverifiable", () => {
    const head = passing({ evidenceLog: attested("body", OTHER_SHA) });
    expect(rules([f()], [head])).toEqual(["attestation_unverifiable"]);
  });

  it("尾行 commit 取不到对象（浅克隆 / squash）⇒ 只提示，不判红", () => {
    const absent: CommitOracle = { exists: () => false, isAncestorOfHead: () => false };
    const head = passing({ evidenceLog: attested("body", OTHER_SHA) });
    const v = judge([f()], [head], absent);
    expect(v.findings).toEqual([]);
    expect(v.notes).toHaveLength(1);
  });
});

describe("破坏方式 ③：复制一份别人的合法日志", () => {
  // 2026-09-21 真仓库实测：`cp F02.verify.log F23.verify.log` + 手改 F23 为 passing，
  // `pnpm harness doctor --phase 00` 报 0 FAIL 并打印"✓ 审计链完整"。
  // 指纹只算正文、不含路径，所以复制品的指纹天然合法——前面每一道门都会放行。
  const TWINS = new Map<string, readonly string[]>([
    [
      "blob-f01",
      [
        "phases/phase-99-demo/sprints/sprint-01/evidence/F01.verify.log",
        "phases/phase-99-demo/sprints/sprint-02/evidence/F07.verify.log",
      ],
    ],
  ]);

  it("日志与另一条 feature 的日志逐字节相同 ⇒ evidence_duplicated", () => {
    expect(rulesWith([f()], [passing()], TWINS)).toEqual(["evidence_duplicated"]);
  });

  it("指纹、状态机、指针全都合法也拦得住（这是它唯一的破绽）", () => {
    const v = judge([f()], [passing()], oracle, TWINS);
    expect(v.findings).toHaveLength(1);
    expect(v.findings[0]!.message).toContain("F07.verify.log");
  });

  it("只有自己那一份 ⇒ 放行（不是永远红）", () => {
    expect(rulesWith([f()], [passing()], SOLO_BLOBS)).toEqual([]);
  });
});

describe("状态机与 owner", () => {
  it("passing 退回 in_progress ⇒ status_irreversible", () => {
    expect(rules([passing()], [f()])).toEqual(["status_irreversible"]);
  });

  it("passing 记录整条消失 ⇒ passing_record_removed", () => {
    expect(rules([passing()], [])).toEqual(["passing_record_removed"]);
  });

  it("in_progress 被别人顶掉 owner ⇒ owner_preempted", () => {
    expect(rules([f()], [f({ owner: "worker-b" })])).toEqual(["owner_preempted"]);
  });

  it("已 passing 的记录被改 owner ⇒ passing_owner_changed", () => {
    expect(rules([passing()], [passing({ owner: "worker-b" })])).toEqual(["passing_owner_changed"]);
  });

  it("status 写成不存在的值 ⇒ status_unknown", () => {
    expect(rules([f()], [f({ status: "done" })])).toEqual(["status_unknown"]);
  });
});

describe("多 phase 目录", () => {
  it("findings 带上 phase 目录名（仓库里存在同 id 不同 slug 的目录）", () => {
    const v = judgeFeatureTransitions(
      {
        phases: [
          { phaseDir: "phase-16-ic-material-review-agent", base: [f()], head: [f({ status: "passing" })] },
          { phaseDir: "phase-99-example-agent", base: [f()], head: [f()] },
        ],
        headEvidenceBlobs: SOLO_BLOBS,
      },
      oracle
    );
    expect(v.findings.map((x) => x.phaseDir)).toEqual(["phase-16-ic-material-review-agent"]);
  });
});
