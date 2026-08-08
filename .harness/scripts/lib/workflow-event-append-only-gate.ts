/**
 * workflow-event-append-only-gate.ts —— PROP-HARNESS-AGENT-001 H3A-034
 * （Epic E3，依赖 H3A-033 的 TPL-EVT-001 schema，见 workflow-event-model.ts）。
 *
 * 完成契约原文："Event stable ID 与 append-only gate | 033 | 重复 ID、
 * 历史覆写会红"。
 *
 * 两条判定：
 *   1. 重复 ID —— `.harness/events/*.yaml` 里所有实例的 `instance_id` 必须
 *      唯一。纯函数、只需要已扫描的实例列表，不需要 git IO。
 *   2. append-only —— 一个已经被 git 提交过的 event 文件，其内容不应该在
 *      后续 commit 里被修改。这一条**需要真实 git IO**（`git log --follow`
 *      看某个文件有没有超过 1 次真实内容变更的 commit），本文件只提供
 *      "拿到 commit 数之后怎么判"这一步的纯函数（`checkAppendOnly`），
 *      真正跑 `git log` 子进程的部分放在 workflow-event-doctor.ts（IO
 *      层）——同 role-authorization-doctor.ts 的分层先例：判定逻辑纯函数 +
 *      IO 在 doctor，不在 lib 里混进子进程调用。
 *
 * 范围边界（同 workflow-event-model.ts 头部注释的先例，避免越界做别人的事）：
 *   - 不管单份 envelope 的字段是否合法——那是 H3A-033 的事
 *     （validateWorkflowEvent），这里假设传入的都是已经通过 H3A-033 schema
 *     校验的合法实例。
 *   - 不管"改动是不是修复了 typo、是不是善意的"——append-only 语义上就是
 *     "写入后不可变"，任何第二次真实内容变更都判 FAIL，不做语义豁免。
 *     这是 Workflow Event 作为审计事件流的硬约束，不是软性建议。
 *
 * 校验风格延续 workflow-event-model.ts/task-assignment-root-domain-gate.ts
 * 的先例：手写纯函数，累积上报全部问题，不 fail-fast。
 */
import type { WorkflowEvent } from "./workflow-event-model";
import type { Finding } from "./role-authorization";

/**
 * 判①：重复 instance_id。
 *
 * 输入是已扫描、已通过 H3A-033 schema 校验的实例列表（调用方负责先过滤
 * 掉 schema 不合法的，这里不重复做 schema 校验）。
 */
export function checkDuplicateInstanceIds(instances: readonly WorkflowEvent[]): Finding[] {
  const findings: Finding[] = [];
  const byId = new Map<string, WorkflowEvent[]>();

  for (const inst of instances) {
    const list = byId.get(inst.instance_id);
    if (list) {
      list.push(inst);
    } else {
      byId.set(inst.instance_id, [inst]);
    }
  }

  for (const [instanceId, group] of byId) {
    if (group.length <= 1) continue;
    // 群体里每一份都报一条 FAIL，指名跟它撞车的其它文件——同一事实（重复
    // ID）在多个文件里各自可见，方便直接从任一文件的 finding 定位到冲突方，
    // 不用回头再查一遍 Map。
    const sourceFiles = group.map((g) => g.sourceFile).sort();
    for (const inst of group) {
      const others = sourceFiles.filter((f) => f !== inst.sourceFile);
      findings.push({
        code: "H3A034-DUPLICATE-INSTANCE-ID",
        severity: "FAIL",
        sourceFile: inst.sourceFile,
        message:
          `instance_id "${instanceId}" 与其它 ${others.length} 个文件重复（${others.join("、")}）——` +
          `Workflow Event 的 instance_id 必须在 .harness/events/ 全目录范围内唯一`,
      });
    }
  }

  return findings;
}

/**
 * 一个 event 文件在 git 历史里的"真实内容变更"提交数——由调用方（doctor
 * IO 层）通过 `git log --follow` 之类的子进程调用算出来，本函数只负责
 * "拿到这个数之后怎么判"，不关心它是怎么算出来的（同 domain-orchestrator-
 * binding.ts 一类 "context 对象里已经算好的数据，纯函数只做判定" 的先例）。
 */
export interface GitHistoryFact {
  /** 相对仓库根的路径，用于 Finding.sourceFile。 */
  relPath: string;
  /**
   * 该文件在 git 历史里被"真实内容变更"的 commit 数（不含首次新增那一次）。
   * 0 = 只有首次新增、从未被改过（合规）；≥1 = append-only 被违反。
   * 由 doctor IO 层通过 `git log --follow --format=%H -- <file>` 拿到全部
   * touch 过这个文件的 commit，再逐个 diff 判断是不是"真实内容变更"
   * （区别于 rename-only/mode-only 之类不改内容的 touch）。
   */
  contentChangeCommitsAfterFirst: number;
}

/**
 * 判②：append-only —— 一个已被提交过的 event 文件，其内容不应该在后续
 * commit 里被修改。
 */
export function checkAppendOnly(facts: readonly GitHistoryFact[]): Finding[] {
  const findings: Finding[] = [];
  for (const fact of facts) {
    if (fact.contentChangeCommitsAfterFirst <= 0) continue;
    findings.push({
      code: "H3A034-EVENT-HISTORY-REWRITTEN",
      severity: "FAIL",
      sourceFile: fact.relPath,
      message:
        `此 Workflow Event 文件在首次提交之后，还有 ${fact.contentChangeCommitsAfterFirst} 次` +
        `真实内容变更的 commit——Workflow Event 是 append-only 的审计事件流，写入后不可再改写` +
        `（同一 instance_id 需要新事实时应追加一个新的 instance_id 文件，不是回头改旧文件）`,
    });
  }
  return findings;
}
