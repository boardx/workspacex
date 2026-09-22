// feature-transition.ts —— feature 状态迁移的**出处**判定（纯函数，不碰 IO）。
//
// ## 它堵的洞（issue #400）
//
// 现有三道门都只看**最终树**：
//   · `doctor` 的 checkPassingEvidence 看"今天 passing 的 feature 有没有非空证据"
//   · `feature-evidence-ratchet` 看"evidence 是不是标准路径"
//   · `evidence-fingerprint` 看"日志正文和尾行哈希对不对得上"
// 三道加起来仍然漏掉一整类破坏方式：**改动本身**是否合法。最终树是自洽的，
// 不代表从 base 走到 head 的那一步是合法的。两个实测可行的绕过：
//
//   1. 直接手改：把一条 feature 的 status 从 not_started 改成 passing，evidence
//      指向一份**早就存在、指纹也对得上**的旧日志（比如另一条 feature 的，或者
//      这条 feature 自己在别的 sprint 留下的）。最终树上：status=passing、
//      evidence 是标准路径、日志指纹 ok —— 三道门全绿。
//   2. 重算指纹：改写一份已 passing 的 `evidence/<Fxx>.verify.log` 正文（把
//      `[exit 1]` 改成 `[exit 0]`），然后照着 evidence-fingerprint.ts 重算
//      sha256 写回尾行。checkFingerprint 返回 ok —— 最终树上完全看不出来。
//      evidence-fingerprint.ts 自己的头注已经写明"读得懂本文件的人就能重算哈希"。
//   3. 复制一份日志：`cp F02.verify.log F23.verify.log`，再把 F23 手改成 passing。
//      指纹是对**正文**算的，路径不在哈希里，所以复制品的指纹天然合法。
//      2026-09-21 在真仓库上实测过这一条：`pnpm harness doctor --phase 00`
//      **0 FAIL**，并照常打印"✓ 审计链完整：所有 passing 都有真实非空证据"。
//
// 三条的破绽都**只在 base→head 的差分里才看得见**：第 1 条是"status 翻了但这一步
// 里没有任何新的验证产物"，第 2 条是"日志正文变了但 status/evidence 指针没动"，
// 第 3 条是"这份日志与另一条 feature 的日志逐字节相同"。所以本模块的输入是一对
// 快照，不是一棵树。
//
// ## 它不做什么（和 evidence-fingerprint.ts 同样的诚实边界）
//
// 信任锚仍然在仓库内部。一个真的想造假的人可以：跑一次真 verify 产出合法尾行，
// 再把日志正文和尾行**一起**替换成另一份自洽的内容。本模块拦不住。它做的是把
// "顺手手改一行 JSON"的成本，抬到必须伪造一次完整的、时间线自洽的迁移——对
// "被交付压力驱使的 agent 走捷径"这个真实威胁模型够用，对蓄意造假者不够。
// **别把本模块当成防伪。**
import { checkFingerprint } from "./evidence-fingerprint";
import { standardEvidenceFeatureId } from "./feature-evidence-ratchet";
import { FEATURE_STATES } from "./types";

/** 一条 feature 在某一侧（base 或 head）的快照。CLI 从 `git show <ref>:<path>` 里装配。 */
export interface FeatureSnapshot {
  readonly id: string;
  readonly status: string;
  readonly owner: string | null;
  readonly evidence: string | null;
  readonly sprint: string | null;
  /**
   * `evidence` 指针指向的日志**正文全文**（含尾行）。
   * null 有两种含义，判定上等价（都表示"这一侧拿不到可信日志"）：指针不是标准路径，
   * 或该 ref 下文件不存在。CLI 在"两侧字段完全一致且日志文件没进 diff"时也传 null——
   * 那种情况下本模块会在比对字段时就提前跳过，取不到日志不影响结论。
   */
  readonly evidenceLog: string | null;
  /** 日志在仓库里的路径（用于报错时指名道姓）；指针非标准时为 null。 */
  readonly logPath: string | null;
  /**
   * 日志在该 ref 下的 git blob OID。逐字节相同的两份日志 blob 相同——
   * "复制一份别人的合法日志"因此是一次 `git ls-tree` 就能判定的事，不需要读内容。
   */
  readonly evidenceBlob: string | null;
}

/** 一个 phase 目录在 base / head 两侧的 feature 集合（live + archive 已合并）。 */
export interface PhaseDiff {
  /** phase 目录名（不是 phase id）——仓库里存在同 id 不同 slug 的目录，目录名才唯一。 */
  readonly phaseDir: string;
  readonly base: readonly FeatureSnapshot[];
  readonly head: readonly FeatureSnapshot[];
}

/** 对仓库历史的提问面，注入进来以便单测用假的。 */
export interface CommitOracle {
  /** 该 sha 在本仓是否存在为 commit 对象。浅克隆 / squash 合并后会是 false。 */
  readonly exists: (sha: string) => boolean;
  /** 该 sha 是否是 head 的祖先。仅在 exists 为 true 时被调用。 */
  readonly isAncestorOfHead: (sha: string) => boolean;
}

export type TransitionRule =
  /** passing 不可逆（AGENTS.md 完成定义）：passing → 任何其他状态 */
  | "status_irreversible"
  /** status 字段不是 FEATURE_STATES 里的值 */
  | "status_unknown"
  /** base 上 passing 的记录在 head 消失了（live 与 archive 都没有） */
  | "passing_record_removed"
  /** 翻成 passing 但 evidence 指针不是 verify 的标准产物 —— 典型的手改 */
  | "direct_passing_edit"
  /** 翻成 passing 但指针指向的日志在 head 上不存在 */
  | "evidence_log_missing"
  /** 日志没有 verify 尾行 —— 手写的日志 */
  | "evidence_unattested"
  /** 尾行哈希与正文对不上 —— 落盘之后被改过 */
  | "evidence_tampered"
  /** 尾行 commit 不指向本分支血统里的真实 commit */
  | "attestation_unverifiable"
  /** 已 passing 的日志正文被改写，而 status/evidence 指针一动没动 —— 重算指纹的签名 */
  | "evidence_rewritten"
  /** in_progress 的 owner 被他人顶掉（claim.ts 保护 1 在差分层的同一条判据） */
  | "owner_preempted"
  /** 已 passing 的记录的 owner 被改 —— 冻结记录不可编辑 */
  | "passing_owner_changed"
  /** 证据日志与另一条 feature 的日志逐字节相同 —— 复制来的，不是自己跑出来的 */
  | "evidence_duplicated";

export interface Finding {
  readonly phaseDir: string;
  readonly featureId: string;
  readonly rule: TransitionRule;
  readonly message: string;
}

/**
 * 尾行 commit 取不到对象时的提示（不判红）。
 * 缺席是**歧义**而不是造假证据：浅克隆取不到、PR squash 合并后原 commit 也不再存在。
 * 把歧义判红会让正常 PR 大面积误伤，所以这里只提示；真正的牙齿是上面那几条硬判。
 */
export interface Note {
  readonly phaseDir: string;
  readonly featureId: string;
  readonly message: string;
}

export interface TransitionVerdict {
  readonly findings: readonly Finding[];
  readonly notes: readonly Note[];
  /** 实际被判定过的 feature 数（两侧有差异的那些）——用来识别"门空转" */
  readonly examined: number;
}

export interface TransitionInput {
  readonly phases: readonly PhaseDiff[];
  /**
   * head 树上全部 `*.verify.log` 的 blob OID → 路径列表。
   * 由 CLI 一次 `git ls-tree -r <head> -- phases` 装配；只用来判"这份日志是复制品吗"。
   */
  readonly headEvidenceBlobs: ReadonlyMap<string, readonly string[]>;
}

const SHA_RE = /^[0-9a-f]{40}$/;

function byId(features: readonly FeatureSnapshot[]): Map<string, FeatureSnapshot> {
  return new Map(features.map((f) => [f.id, f]));
}

/** 两侧是否有任何本模块关心的差异。没有差异的 feature 整条跳过——这是"只判迁移、不审全树"的落点。 */
function changed(b: FeatureSnapshot, h: FeatureSnapshot): boolean {
  return (
    b.status !== h.status ||
    b.owner !== h.owner ||
    b.evidence !== h.evidence ||
    b.evidenceLog !== h.evidenceLog ||
    b.evidenceBlob !== h.evidenceBlob
  );
}

/**
 * 一条正在被推向 passing（或重新落盘证据）的 feature，它的证据出处是否站得住。
 * 顺序刻意从"最外层的指针"查到"最里层的见证"，报错时停在第一层不成立的地方。
 */
function checkProvenance(
  phaseDir: string,
  h: FeatureSnapshot,
  oracle: CommitOracle,
  headEvidenceBlobs: ReadonlyMap<string, readonly string[]>
): { finding: Finding | null; note: Note | null } {
  const mk = (rule: TransitionRule, message: string) => ({
    finding: { phaseDir, featureId: h.id, rule, message },
    note: null,
  });

  const pointerId = standardEvidenceFeatureId(h.evidence);
  if (pointerId === null) {
    return mk(
      "direct_passing_edit",
      `status=passing 但 evidence 不是 verify 的标准产物（当前值 ${JSON.stringify(h.evidence)}）。` +
        `只有 \`pnpm harness verify --sprint\` 能产出 \`evidence/<Fxx>.verify.log @ <ISO>\`。`
    );
  }
  if (pointerId !== h.id) {
    return mk(
      "direct_passing_edit",
      `evidence 指针指向 ${pointerId} 的日志，与本 feature（${h.id}）不符——证据不能借用。`
    );
  }
  if (h.evidenceLog === null) {
    return mk(
      "evidence_log_missing",
      `evidence 指向 \`evidence/${h.id}.verify.log\`，但该文件在 head 上不存在` +
        `（sprint=${JSON.stringify(h.sprint)}）。指针指向空气。`
    );
  }

  const verdict = checkFingerprint(h.evidenceLog);
  if (verdict.kind === "missing") {
    return mk(
      "evidence_unattested",
      `\`evidence/${h.id}.verify.log\` 没有 \`[harness-verify v1 …]\` 尾行——verify 从未产出过它。`
    );
  }
  if (verdict.kind === "tampered") {
    return mk(
      "evidence_tampered",
      `\`evidence/${h.id}.verify.log\` 的尾行哈希与正文对不上（尾行 ${verdict.expected.slice(0, 12)}…，` +
        `实算 ${verdict.actual.slice(0, 12)}…）——日志在 verify 落盘之后被改过。`
    );
  }

  // 复制品判定放在指纹之后：复制来的日志指纹天然合法（哈希只算正文，路径不在里面），
  // 所以前面每一道都会放行，只有"和别人的日志逐字节相同"这一条能认出它。
  const twins = (h.evidenceBlob ? headEvidenceBlobs.get(h.evidenceBlob) : undefined) ?? [];
  const others = twins.filter((p) => p !== h.logPath);
  if (others.length > 0) {
    return mk(
      "evidence_duplicated",
      `\`evidence/${h.id}.verify.log\` 与 ${others.join("、")} 逐字节相同——` +
        `这份证据是复制来的，不是 ${h.id} 自己跑出来的。指纹只算正文、不含路径，所以复制品的指纹天然合法。`
    );
  }

  const { commit } = verdict;
  if (commit === "unknown" || !SHA_RE.test(commit)) {
    return mk(
      "attestation_unverifiable",
      `\`evidence/${h.id}.verify.log\` 的尾行 commit 是 ${JSON.stringify(commit)}，不是一个 commit sha——` +
        `verify 当时不在 git 仓库里跑，这份日志没有可追溯的见证。`
    );
  }
  if (oracle.exists(commit) && !oracle.isAncestorOfHead(commit)) {
    return mk(
      "attestation_unverifiable",
      `\`evidence/${h.id}.verify.log\` 的尾行 commit ${commit.slice(0, 12)} 存在，但不在 head 的血统里——` +
        `这份证据见证的是另一条历史，不是本次改动。`
    );
  }
  if (!oracle.exists(commit)) {
    return {
      finding: null,
      note: {
        phaseDir,
        featureId: h.id,
        message:
          `尾行 commit ${commit.slice(0, 12)} 在本仓取不到对象，无法核对血统` +
          `（浅克隆或原 commit 已被 squash）。不判红：缺席是歧义，不是造假证据。`,
      },
    };
  }
  return { finding: null, note: null };
}

/** 主判定：给定每个 phase 目录在 base / head 两侧的快照，这一步迁移里有哪些不合法。 */
export function judgeFeatureTransitions(
  { phases, headEvidenceBlobs }: TransitionInput,
  oracle: CommitOracle
): TransitionVerdict {
  const findings: Finding[] = [];
  const notes: Note[] = [];
  let examined = 0;

  for (const { phaseDir, base, head } of phases) {
    const baseMap = byId(base);
    const headMap = byId(head);

    // ① base 上 passing 的记录不能凭空消失。归档（feature_list.archive.json）不触发
    //    这条——CLI 侧两个文件已经合并成一份视图，搬家在这里是无操作。
    for (const b of base) {
      if (b.status === "passing" && !headMap.has(b.id)) {
        examined++;
        findings.push({
          phaseDir,
          featureId: b.id,
          rule: "passing_record_removed",
          message: `base 上 ${b.id} 是 passing，head 上整条记录不见了。passing 不可逆，记录也不能删。`,
        });
      }
    }

    for (const h of head) {
      const b = baseMap.get(h.id);
      if (b && !changed(b, h)) continue; // 只判迁移，不审全树
      examined++;

      if (!FEATURE_STATES.includes(h.status as never)) {
        findings.push({
          phaseDir,
          featureId: h.id,
          rule: "status_unknown",
          message: `status=${JSON.stringify(h.status)} 不是合法状态（${FEATURE_STATES.join(" / ")}）。`,
        });
        continue;
      }

      // ② passing 不可逆
      if (b?.status === "passing" && h.status !== "passing") {
        findings.push({
          phaseDir,
          featureId: h.id,
          rule: "status_irreversible",
          message: `${h.id} 从 passing 退回 ${h.status}。passing 不可逆（AGENTS.md 完成定义）。`,
        });
        continue;
      }

      // ③ in_progress 的 owner 不可被他人抢占（claim.ts 保护 1 的同一条判据）
      if (
        b?.status === "in_progress" &&
        h.status === "in_progress" &&
        b.owner !== null &&
        h.owner !== null &&
        b.owner !== h.owner
      ) {
        findings.push({
          phaseDir,
          featureId: h.id,
          rule: "owner_preempted",
          message: `${h.id} 的 owner 被从 ${b.owner} 改成 ${h.owner}，而它仍是 in_progress——认领后不可被他人抢占。`,
        });
      }

      if (h.status !== "passing") continue;

      if (b?.status === "passing") {
        // ④ 已经 passing 的记录是冻结的
        if (b.owner !== h.owner) {
          findings.push({
            phaseDir,
            featureId: h.id,
            rule: "passing_owner_changed",
            message: `${h.id} 已 passing，owner 却从 ${JSON.stringify(b.owner)} 改成 ${JSON.stringify(h.owner)}。冻结记录不可编辑。`,
          });
        }
        // ⑤ 重算指纹的签名：日志正文变了，而 status/evidence 指针一动没动。
        //    合法的重新落盘（verify --backfill-evidence）一定会同时刷新 evidence 的时间戳。
        if (b.evidenceLog !== h.evidenceLog) {
          if (b.evidence === h.evidence) {
            findings.push({
              phaseDir,
              featureId: h.id,
              rule: "evidence_rewritten",
              message:
                `\`evidence/${h.id}.verify.log\` 的正文在本次改动里变了，但 status 和 evidence 指针都没动——` +
                `这正是"改写日志 + 重算 sha256 尾行"留下的形状。合法的重新落盘` +
                `（\`verify --backfill-evidence\`）会同时刷新 evidence 的时间戳。`,
            });
          } else {
            const { finding, note } = checkProvenance(phaseDir, h, oracle, headEvidenceBlobs);
            if (finding) findings.push(finding);
            if (note) notes.push(note);
          }
        }
        continue;
      }

      // ⑥ 翻成 passing：必须有本次改动里站得住的证据出处
      const { finding, note } = checkProvenance(phaseDir, h, oracle, headEvidenceBlobs);
      if (finding) findings.push(finding);
      if (note) notes.push(note);
    }
  }

  return { findings, notes, examined };
}
