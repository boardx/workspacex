// sync-github.ts — 单向投影。文件是事实来源，GitHub 只读。
// phase→Milestone, sprint→label, feature→Issue；只对当前/近期 sprint 开 Issue。
// 默认只打印计划（dry-run），加 --apply 才通过 gh CLI 执行（需先 gh auth login）。
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { parse } from "yaml";
import { HARNESS_DIR, findPhaseDir } from "./lib/paths";
import { loadRoadmap } from "./lib/roadmap";
import { loadFeatureList, featuresForSprint } from "./lib/features";
import { resolveSpecRef } from "./lib/spec-ref";
import { sh } from "./lib/sh";
import { describeNotIntegrated, evidenceIntegration, type IntegrationFacts } from "./lib/evidence-integration";
import { describeIssueListFailure, listAllIssues } from "./lib/github-issues";
import { req } from "./lib/args";
import { log } from "./lib/log";
import type { Args } from "./lib/args";
import type { Feature, FeatureList } from "./lib/types";

interface StatusActions {
  close_issue?: boolean;
  add_label?: string;
}

interface SyncCfg {
  repo: string;
  issue_policy: { open_for: string; near_term_window: number };
  labels: { blocked: string; passing: string; area_prefix: string };
  status_actions: Record<string, StatusActions>;
  /** harness owner(agent 身份) → GitHub 登录名。没映射的 owner 不投影为 assignee */
  owner_github_map?: Record<string, string>;
}

export interface ProjectedIssue {
  number: number;
  title: string;
  body: string;
  state: string;
  labels?: { name: string }[];
}

const PROJECTION_MARKER_PREFIX = "harness-feature:";

function loadCfg(): SyncCfg {
  const raw = parse(readFileSync(join(HARNESS_DIR, "config", "github-sync.yaml"), "utf8")) as SyncCfg;
  return raw;
}

export function projectionMarker(phaseId: string, featureId: string): string {
  return `<!-- ${PROJECTION_MARKER_PREFIX} ${phaseId}/${featureId} -->`;
}

/** issue body 是否带本 feature 的投影 marker——sync 只允许动带 marker 的 issue（#713）。 */
export function isProjectedBody(body: string, phaseId: string, featureId: string): boolean {
  return body.includes(projectionMarker(phaseId, featureId));
}

/** 把同标题的 issue 分成「真投影」与「标题碰撞的非 sync issue」。
 *  marker 判定用 **GitHub 上的现存 body**（不是我们即将写入的 body）——
 *  #713 的根因就是 edit 后用新 body（必带 marker）回填判定，把守卫击穿。
 *  无 marker 的 issue 一律归入 collisions，sync 对它们不 edit / 不 close / 不加 label（fail-safe）。 */
export function partitionTitleMatches(
  matches: ProjectedIssue[],
  phaseId: string,
  featureId: string,
): { projection: ProjectedIssue | null; collisions: ProjectedIssue[] } {
  const projection = matches.find((i) => isProjectedBody(i.body, phaseId, featureId)) ?? null;
  const collisions = matches.filter((i) => !isProjectedBody(i.body, phaseId, featureId));
  return { projection, collisions };
}

/** label reconcile 的纯 diff（可单测）：#526 只 reconcile 了 status label，sprint/area label
 *  从不参与 add/remove——issue 靠 marker 撞号到别的 feature 时（sprint 编号漂移/孤儿 sprint），
 *  旧 sprint/area label 永久卡在创建时刻（#1676）。现在对 sprint、area_prefix、任一 status label
 *  命名空间做完整 diff：落在这些命名空间但不在 desired 里的一律移除；desired 里有但当前没有的一律添加。 */
export function diffLabels(
  currentLabels: string[],
  desiredLabels: string[],
  areaPrefix: string,
  allStatusLabels: string[],
): { toAdd: string[]; toRemove: string[] } {
  const managedNamespace = (l: string) =>
    l.startsWith("sprint:") || l.startsWith(areaPrefix) || allStatusLabels.includes(l);
  return {
    toAdd: desiredLabels.filter((l) => !currentLabels.includes(l)),
    toRemove: currentLabels.filter((l) => managedNamespace(l) && !desiredLabels.includes(l)),
  };
}

export type CloseDecision = "skip-not-on-main" | "skip-missing" | "skip-closed" | "close";

/** close 分支的纯决策（可单测）：
 *  - **实现不在 main 上不关**（#1557，完成定义第 6 条）——`passing` 是本地状态，
 *    「在 main 上」是远端事实，中间隔着 push + PR + 合并三步；旧版只看前者，
 *    两次把没有任何 PR 的 issue 关掉，且 #526 的「不重开」让误关永不自纠。
 *    这条判定放在最前：dry-run 没有 issue 对象也要能给出同样的结论。
 *  - 无投影不关、已关不重关、绝不 reopen（#526/#713）。 */
export function decideClose(issue: ProjectedIssue | null, integration: IntegrationFacts): CloseDecision {
  if (integration.kind !== "on-main") return "skip-not-on-main";
  if (issue === null) return "skip-missing";
  if (issue.state.toLowerCase() === "closed") return "skip-closed";
  return "close";
}

/** 把同阶段 "F0x" / 跨阶段 "pN:F0x" 依赖渲染为带当前状态的可读行。
 *  跨阶段依赖需要读对方 feature_list；读不到时降级为纯文本。 */
function renderDependsOn(f: Feature, phaseId: string, fl: FeatureList): string[] {
  if (!f.depends_on || f.depends_on.length === 0) return ["- 无"];
  return f.depends_on.map((dep) => {
    let depPhase = phaseId;
    let depId = dep;
    if (dep.includes(":")) [depPhase, depId] = dep.split(":") as [string, string];
    let status = "unknown";
    try {
      const depFl = depPhase === phaseId ? fl : loadFeatureList(depPhase);
      status = depFl.features.find((x) => x.id === depId)?.status ?? "unknown";
    } catch {
      /* 对方阶段不存在/读失败：保持 unknown */
    }
    const blockedHint = status === "passing" ? "已就绪" : `⚠ 未就绪（${status}），就绪前不要开工`;
    return `- \`${dep}\` — ${blockedHint}`;
  });
}

/** 生成 issue body：让「只拿到这个 issue、对仓库零先验」的 agent 具备开工条件。
 *  原则：GitHub 是只读投影，仓库才是权威——body 提供完整契约 + 指回权威文件的链接，
 *  不试图复制仓库里所有规则（规则以 AGENTS.md 为准）。
 *  模版规格见 .harness/templates/github-issue-body.template.md（改这里请同步改模版文档）。 */
export function buildIssueBody(
  f: Feature,
  phaseId: string,
  sprintId: string,
  repo: string,
  fl: FeatureList,
  trackingIssue?: number,
): string {
  const phaseDir = basename(findPhaseDir(phaseId));
  const blob = (p: string) => `https://github.com/${repo}/blob/main/${p}`;
  const evidencePath = `phases/${phaseDir}/sprints/sprint-${sprintId}/evidence/${f.id}.verify.log`;

  // Story：把闭环延伸到 GitHub（人类拍板 2026-07-19）。GitHub 渲染的 markdown 标题
  // 锚点是有损派生的（strip 标点/转小写/CJK 处理不稳），不可靠指哪打哪，所以链接到
  // 文件本身、章节 ID 用文字标出，而不是拼一个 #anchor 赌它命中。
  const storyLine = (() => {
    const r = resolveSpecRef(phaseId, f.spec_ref);
    if (!r.ok) return `⚠ 缺少可追溯的 story（${r.reason}）——历史存量，新 feature 已被 claim/verify 强制要求`;
    // 契约束锚点（`contracts/<bundle>#confirmed`，2026-08-26 方案 3）指向的不是
    // requirements/ 下的文件，链接要对着 contracts/<bundle>/design-signoff.md，
    // 否则会拼出一个 requirements/contracts/... 的死链。
    const contractMatch = /^contracts\/([^/#]+)#confirmed$/.exec(f.spec_ref!.trim());
    if (contractMatch) {
      const bundle = contractMatch[1];
      const path = `phases/${phaseDir}/contracts/${bundle}/design-signoff.md`;
      return `[contracts/${bundle}/design-signoff.md](${blob(path)}) — 契约束签核（status: confirmed）`;
    }
    const [file, section] = f.spec_ref!.split("#");
    return `[requirements/${file}](${blob(`phases/${phaseDir}/requirements/${file}`)}) — 章节 \`${section}\``;
  })();
  const parentSection = trackingIssue == null
    ? []
    : [
        `## Parent Tracking Issue`,
        ``,
        `Parent: #${trackingIssue}`,
        ``,
        `https://github.com/${repo}/issues/${trackingIssue}`,
        ``,
      ];

  return [
    projectionMarker(phaseId, f.id),
    ``,
    ...parentSection,
    `## 交付契约（user_visible_behavior）`,
    ``,
    f.user_visible_behavior,
    ``,
    `## Story`,
    ``,
    storyLine,
    ``,
    `## 验证（完成的唯一标准：每条命令退出码 0）`,
    ``,
    ...f.verification.map((v) => `- [ ] \`${v}\``),
    ``,
    `证据落盘：\`${evidencePath}\``,
    ``,
    `## 实现指引（notes）`,
    ``,
    f.notes || "（无）",
    ``,
    `## 设计参照`,
    ``,
    f.design_ref ?? "（无 UI 或沿用现有界面）",
    ``,
    `## 前置依赖`,
    ``,
    ...renderDependsOn(f, phaseId, fl),
    ``,
    `## 元数据`,
    ``,
    `| phase | sprint | 能力平面 | 优先级 | wave | area |`,
    `|---|---|---|---|---|---|`,
    `| ${phaseId} | ${sprintId} | ${f.capability ?? "-"} | P${f.priority} | ${f.wave ?? "-"} | ${f.area} |`,
    ``,
    `## 开工流程（agent 必读）`,
    ``,
    `> 本 issue 是仓库的**只读投影**；权威是 [\`phases/${phaseDir}/feature_list.json\`](${blob(
      `phases/${phaseDir}/feature_list.json`
    )})。若两者不一致，以仓库为准。`,
    ``,
    `1. 环境：\`./init.sh\`（验证失败先修基础状态，别在坏地基上开工）。`,
    `2. 认领：\`pnpm harness claim --phase ${phaseId} --feature ${f.id} --owner <你的-agent-id>\`（同一 owner 同时最多一个 in_progress）。`,
    `3. 读上下文：[\`requirements/\`](${blob(`phases/${phaseDir}/requirements`)})（原始需求）、[\`contracts/\`](${blob(
      `phases/${phaseDir}/contracts`
    )})（本 feature 所属契约束：\`ui.md\` 给组件落点与 data-testid，\`usecases.md\` 给失败模式，\`design-signoff.md\` 给签核状态）、[\`sprints/sprint-${sprintId}/session-handoff.md\`](${blob(
      `phases/${phaseDir}/sprints/sprint-${sprintId}/session-handoff.md`
    )})（上一轮交接）。`,
    `4. 实现：只做本 feature 的最小实现，不顺手重构无关区域；不碰 \`active-features.json\`（脚本派生只读）。`,
    `5. 验证：逐条跑上方 verification，输出留到 \`${evidencePath}\`；然后 \`pnpm harness verify --sprint ${phaseId}/${sprintId} --feature ${f.id}\` 门控转 passing——**不允许手改 status**。`,
    `6. 提交：分支 \`worker/<owner>-${phaseId}-${f.id.toLowerCase()}-<slug>\`，PR 关联本 issue（\`Closes #<本 issue 号>\`），收尾更新 progress.md 与 session-handoff.md。`,
    ``,
    `完整硬约束见 [\`AGENTS.md\`](${blob("AGENTS.md")})；多 agent 协作规则见 [\`.harness/instructions/multi-agent-coordination.md\`](${blob(
      ".harness/instructions/multi-agent-coordination.md"
    )})。`,
  ].join("\n");
}

/** 通过 title 搜索**全部**精确同名 issue（apply 模式下执行；dry-run 返回空）。
 *  返回完整投影字段（number/title/body/state）：body 供 marker 校验（避免误动非 sync issue），
 *  state 供 close 幂等判断（已 CLOSED 不重复关，也绝不重开——#526）。
 *  返回数组而非首个匹配：标题碰撞时首个匹配可能是人工 issue，marker 判定必须在全量上做（#713）。 */
/**
 * 全量 issue 缓存，按**投影 marker** 匹配，而不是按标题搜索。
 *
 * ⚠ 2026-07-29：`gh issue list --search "<标题>"` 对**中文长标题匹配不上**——
 *   F07/F08 因此被重复创建成 #30/#31（原本是 #15/#16）。
 *   marker 是我们自己写进 body 的确定性字符串，本地比对不受搜索索引影响，
 *   也不受索引延迟影响（`#526` 记的那个「创建即 passing 搜不到」正是同一根源）。
 */
let ALL_ISSUES: ProjectedIssue[] | null = null;
function allIssues(repo: string, apply: boolean): ProjectedIssue[] {
  if (!apply) return [];
  if (ALL_ISSUES) return ALL_ISSUES;
  // #2483：此前是 `--limit 500`。gh 按编号从新到旧返回，仓库过 #2400 后 phase-00/01 的投影
  // issue 全在窗口外；marker 找不到 → 退回标题搜索 → 中文长标题搜不到 → **再建一个**。
  // 清单拿不全时唯一安全的动作是整个 sync 停下：本函数的每一个消费方（建/改/关）都是
  // 「没找到 ⇒ 动手」的否定性判断，残缺清单上做这些判断就是在制造双胞胎。
  const r = listAllIssues({ repo });
  if (r.kind !== "ok") {
    throw new Error(
      `sync --apply 中止：${describeIssueListFailure(r)}。清单不完整时「没找到投影 issue」不可信，` +
        `继续会重复创建/漏关 issue。修好 gh 登录或提高 ISSUE_PAGE_LIMIT 后重跑。`,
    );
  }
  ALL_ISSUES = r.issues;
  return ALL_ISSUES;
}

function findIssuesByTitle(repo: string, title: string, apply: boolean): ProjectedIssue[] {
  if (!apply) return []; // dry-run 不实际查询
  // --state all：含已关闭 issue，否则幂等检查会漏掉 closed issue 而重复创建
  const r = sh(
    `gh issue list --repo ${JSON.stringify(repo)} --state all --search ${JSON.stringify(title)} --json number,title,body,state,labels --limit 10`
  );
  if (r.code !== 0) return [];
  try {
    const items = JSON.parse(r.stdout) as ProjectedIssue[];
    return items.filter((i) => i.title === title);
  } catch {
    return [];
  }
}

/** 通过 title + body marker 搜索投影 issue（close 前使用，避免误关非 sync issue）。 */
function findProjectedIssue(repo: string, title: string, phaseId: string, featureId: string, apply: boolean): ProjectedIssue | null {
  // marker 优先：确定性、不受搜索索引与中文分词影响。搜标题只作兜底。
  const marker = projectionMarker(phaseId, featureId);
  const byMarker = allIssues(repo, apply).find((i) => i.body?.includes(marker));
  if (byMarker) return byMarker;
  return partitionTitleMatches(findIssuesByTitle(repo, title, apply), phaseId, featureId).projection;
}

export function syncGithub(args: Args): void {
  const phaseId = req(args, "phase");
  const apply = !!args.flags["apply"];
  const cfg = loadCfg();
  const rm = loadRoadmap();
  const phase = rm.phases.find((p) => p.id === phaseId);
  if (!phase) throw new Error(`roadmap 中找不到 Phase ${phaseId}`);
  const fl = loadFeatureList(phaseId);

  const plan: string[] = [];
  // #2483：apply 模式先把全量 issue 清单拉齐再动任何东西——拉不齐就在这里停，
  // 不要等到 milestone/label 已经建了一半才发现清单是残缺的。
  if (apply) allIssues(cfg.repo, true);
  // issue body 临时文件目录（--body-file 用，见下方注释）
  const bodyDir = mkdtempSync(join(tmpdir(), "harness-issue-body-"));
  const run = (cmd: string, description?: string) => {
    plan.push(description ? `# ${description}\n${cmd}` : cmd);
    if (apply) {
      const r = sh(cmd);
      if (r.code !== 0) log.err(`gh 命令失败(${r.code}): ${cmd}\n${r.stderr}`);
      else log.ok(cmd);
    }
  };

  // 1) phase → milestone
  const milestone = `Phase ${phase.id}: ${phase.name}`;
  run(
    `gh api repos/${cfg.repo}/milestones -X POST -f title=${JSON.stringify(milestone)} ` +
      `-f state=open -f description=${JSON.stringify(phase.goal)} || true`,
    `创建 Milestone: ${milestone}`
  );

  // 2) 计算"当前/近期" sprint 集合
  const sprintIds = [
    ...new Set(fl.features.map((f) => f.sprint).filter((s): s is string => !!s)),
  ].sort();
  const nearTerm =
    cfg.issue_policy.open_for === "all"
      ? sprintIds
      : sprintIds.slice(0, Math.max(1, cfg.issue_policy.near_term_window));

  // 2.5) 先确保用到的 label 都存在——GitHub 不允许给 issue 加不存在的 label。
  //      收集近期 sprint 会用到的全部 label，逐个 gh label create --force（幂等）。
  const neededLabels = new Set<string>();
  for (const sid of nearTerm) {
    neededLabels.add(`sprint:${phaseId}-${sid}`);
    for (const f of featuresForSprint(fl, sid)) {
      neededLabels.add(`${cfg.labels.area_prefix}${f.area}`);
      const sa = cfg.status_actions?.[f.status];
      if (sa?.add_label) neededLabels.add(sa.add_label);
    }
  }
  for (const label of neededLabels) {
    run(
      `gh label create ${JSON.stringify(label)} --repo ${cfg.repo} --force`,
      `确保 label 存在: ${label}`
    );
  }

  // 3) 对近期 sprint 的 feature 开/更新 Issue
  for (const sid of nearTerm) {
    for (const f of featuresForSprint(fl, sid)) {
      const labels = [`sprint:${phaseId}-${sid}`, `${cfg.labels.area_prefix}${f.area}`];

      // 完整实现 status_actions（之前只处理了 blocked/passing）
      const statusAction: StatusActions = cfg.status_actions?.[f.status] ?? {};
      if (statusAction.add_label) labels.push(statusAction.add_label);

      const title = `[${f.id}] ${f.title}`;
      const body = buildIssueBody(
        f,
        phaseId,
        sid,
        cfg.repo,
        fl,
        phase.tracking_issue,
      );

      // body 走 --body-file 而不是 --body "<内联字符串>"：
      // 内联时 bash 双引号里的反引号会做命令替换（body 含 `pnpm test`/`./init.sh` 这类
      // 代码片段 → 在本机被真实执行并把输出写进 issue，兼有注入风险），\n 也会变字面量。
      // 临时文件彻底绕开 shell 转义面。dry-run 也写文件（幂等无害），方便人工检查。
      const bodyFile = join(bodyDir, `${phaseId}-${f.id}.md`);
      writeFileSync(bodyFile, body);

      // owner → GitHub assignee（单向投影；owner 为 null 则不设 assignee）
      //
      // ⚠ harness 的 owner 是 **agent 身份**（main-agent / coord-architecture …），
      //   基本不是 GitHub 登录名。直接当 assignee 传过去必然 422，而 422 的代价不只是
      //   「没设上负责人」——见下方创建处：issue 已经建出来了命令才失败。
      //   故只有在 `owner_github_map` 里显式映射过的 owner 才投影为 assignee；
      //   没映射的照旧只写进 issue body（归因信息不会丢）。
      const ghLogin = cfg.owner_github_map?.[f.owner ?? ""];
      const assigneeArg = ghLogin ? ` --assignee ${JSON.stringify(ghLogin)}` : "";

      // 幂等 + 收敛：不存在则创建；已存在则更新 body（文件是权威，投影必须跟着文件走——
      // 否则改了模版/notes/verification，存量 issue 永远停在旧信息上）。
      // #713：所有会 edit/close 的路径统一先验 marker（用 GitHub 上的现存 body 判定），
      // 无 marker 的同名 issue 是标题碰撞的人工 issue——一律不动，也不创建同名新 issue（fail-safe）。
      // marker 优先（见 findProjectedIssue 的注释）：标题搜索对中文长标题匹配不上，
      // 已因此重复创建过 #30/#31。
      const marker = projectionMarker(phaseId, f.id);
      const byMarker = allIssues(cfg.repo, apply).find((i) => i.body?.includes(marker));
      const matches = byMarker ? [byMarker] : findIssuesByTitle(cfg.repo, title, apply);
      const { projection: existing, collisions } = partitionTitleMatches(matches, phaseId, f.id);
      for (const c of collisions) {
        log.warn(
          `Issue #${c.number} 与投影标题精确碰撞但 body 无 marker ${projectionMarker(phaseId, f.id)}` +
            `——按非 sync issue 处理，不 edit / 不 close。若它是 legacy 投影 issue，请人工在 body 补 marker 后重跑 sync。`
        );
      }
      let issueForClose: ProjectedIssue | null = null;
      if (apply && existing !== null) {
        // #1676：existing 可能是靠 marker 匹配到的、但标题已经不属于本 feature 的旧 issue
        // （sprint 编号漂移/孤儿 sprint 撞号场景）——body 会被下面这条 edit 覆盖成对的，
        // 标题不带 --title 一起改，就会永久停在别的 feature 的旧标题上。
        run(
          `gh issue edit --repo ${cfg.repo} ${existing.number} --title ${JSON.stringify(title)} --body-file ${JSON.stringify(bodyFile)}`,
          `更新 Issue #${existing.number} title+body: ${title}`
        );
        // existing 在 edit 前就已验过 marker（partitionTitleMatches），
        // 这里只是把最新 body 带上供 close 阶段复用，不改变 marker 判定结论（#713）。
        issueForClose = { ...existing, title, body };
        // #526 + #1676：存量 issue 的 label 也要 reconcile——此前只 reconcile status:* label，
        // sprint:*/area:* 从不参与 add/remove，导致同一现象反复出现：issue 靠 marker 撞号
        // 到别的 feature 时，旧 sprint/area label 永久卡在创建时刻（#1676 就是 sprint:12-03
        // + area:project 卡死在已改判给别 feature 的 issue 上，无人清理）。
        // 现在按「本 feature 应有的 label 全集」与「issue 当前实际 label」做完整 diff：
        // 落在 sprint:*/area_prefix/任一 status label 命名空间、但不在当前应有集合里的，一律移除；
        // 应有但当前没有的，一律添加。（gh 对"移除不存在的 label"静默容忍，天然幂等。）
        const allStatusLabels = [
          ...new Set(
            Object.values(cfg.status_actions ?? {})
              .map((a) => a?.add_label)
              .filter((l): l is string => !!l)
          ),
        ];
        const currentLabels = (existing.labels ?? []).map((l) => l.name);
        const { toAdd, toRemove } = diffLabels(currentLabels, labels, cfg.labels.area_prefix, allStatusLabels);
        const addArg = toAdd.map((l) => ` --add-label ${JSON.stringify(l)}`).join("");
        const rmArg = toRemove.map((l) => ` --remove-label ${JSON.stringify(l)}`).join("");
        if (addArg || rmArg) {
          run(
            `gh issue edit --repo ${cfg.repo} ${existing.number}${addArg}${rmArg}`,
            `label reconcile #${existing.number} → [${labels.join(", ")}]`
          );
        }
      } else if (apply && collisions.length > 0) {
        // 有同名人工 issue 且无真投影：不创建同名新 issue（避免撞名双胞胎让人混淆），
        // 也不动人工 issue。该 feature 本轮不投影，靠上面的 warn 提示人工处置（#713）。
        log.warn(`跳过创建 "${title}"：存在同名非 sync issue（见上方 warn），本轮不投影该 feature。`);
      } else {
        const createCmd =
          `gh issue create --repo ${cfg.repo} --title ${JSON.stringify(title)} ` +
          `--body-file ${JSON.stringify(bodyFile)} --label ${JSON.stringify(labels.join(","))} --milestone ${JSON.stringify(milestone)}${assigneeArg}`;
        if (apply) {
          // #526：创建后从 stdout 的 issue URL 直取 number——不能靠 findIssue 回查，
          // GitHub 搜索索引有延迟，"创建即 passing"的 close 会因搜不到而被跳过
          //（p23 的 #504/#505 事故根因）。
          plan.push(`# 创建 Issue: ${title} [${f.status}]${f.owner ? ` @${f.owner}` : ""}\n${createCmd}`);
          let r = sh(createCmd);
          if (r.code !== 0 && assigneeArg) {
            // owner 是 harness 身份(如 coord-architecture)而非 GitHub 用户时 assignee 会被
            // gh 拒绝——退化为不带 assignee 重试,投影不该因归因字段整条失败(#526)。
            //
            // ⚠ 但**必须先看这次失败有没有已经把 issue 建出来**。
            //   `gh issue create` 是先 POST 建 issue、再设 assignee：assignee 非法时
            //   issue **已经存在**，命令却返回非 0。无条件重试 = 建出第二条。
            //   2026-07-29 实测：F18 因 owner="main-agent" 不是 GitHub 用户，
            //   被建成 #2 与 #3 两条（#3 被正确关闭，#2 成了永远 OPEN 的孤儿）。
            //   重试前先从失败那次的输出里捞 issue URL，捞到就当已建成。
            const already = `${r.stdout}\n${r.stderr}`.match(/\/issues\/(\d+)/);
            if (already) {
              log.warn(`assignee 失败但 issue 已建出(#${already[1]})，不重复创建: ${title}`);
              r = { code: 0, stdout: r.stdout || `/issues/${already[1]}`, stderr: "" };
            } else {
              log.warn(`assignee 失败,退化为无 assignee 重试: ${title}`);
              r = sh(createCmd.replace(assigneeArg, ""));
            }
          }
          if (r.code !== 0) {
            log.err(`gh 命令失败(${r.code}): ${createCmd}\n${r.stderr}`);
          } else {
            log.ok(createCmd);
            const m = r.stdout.match(/\/issues\/(\d+)/);
            if (m) {
              // 新建 issue：body 是我们刚写入的（含 marker），state 为 OPEN。
              issueForClose = { number: Number(m[1]), title, body, state: "OPEN" };
            }
          }
        } else {
          run(createCmd, `创建 Issue: ${title} [${f.status}]${f.owner ? ` @${f.owner}` : ""}`);
        }
      }

      if (statusAction.close_issue) {
        // 只关带 marker 的投影 issue（避免误关非 sync issue，#653）；
        // 幂等 + 不重开（#526）；实现不在 origin/main 上不关（#1557）。
        // 集成事实只读本地 git，dry-run 也算，所以 dry-run 的输出与 --apply 的决策一致。
        const integration = evidenceIntegration(phaseId, f);
        const issue = integration.kind === "on-main"
          ? issueForClose ?? findProjectedIssue(cfg.repo, title, phaseId, f.id, apply)
          : issueForClose; // 不会关，省一次 gh 查询
        const closeAction = decideClose(issue, integration);
        if (closeAction === "skip-not-on-main") {
          log.warn(
            `${phaseId}/${f.id} 已 passing 但实现还没合入 main：${describeNotIntegrated(integration as Exclude<IntegrationFacts, { kind: "on-main" }>)}` +
              ` —— 不关闭 issue（完成定义第 6 条，#1557）。PR 带 \`Closes #N\` 合入后由 GitHub 关闭，或合入后再跑一次 sync --apply。`
          );
        } else if (!apply) {
          // dry-run 时打印意图（无法预知 issue number）
          run(
            `gh issue close --repo ${cfg.repo} <issue-number-for: ${JSON.stringify(title)}>`,
            `关闭已 passing 的 Issue: ${title}`
          );
        } else if (issue === null || closeAction === "skip-missing") {
          log.warn(`找不到带 ${projectionMarker(phaseId, f.id)} 的投影 Issue for "${title}"，跳过关闭`);
        } else if (closeAction === "skip-closed") {
          // 幂等：已关的不重复关；反向（issue 被误关但 feature 未 passing）不自动重开（#526）
          log.info(`Issue #${issue.number} 已关闭，跳过重复关闭: ${title}`);
        } else {
          const closeComment = [
            `由 \`phases/${basename(findPhaseDir(phaseId))}/feature_list.json\` 中 \`${phaseId}/${f.id}\` 已 \`passing\`，` +
              `且证据日志所在 commit \`${integration.kind === "on-main" ? integration.commit.slice(0, 8) : "?"}\` 已在 \`origin/main\` 血统里，自动关闭（完成定义第 5、6 条）。`,
            ``,
            `证据：${f.evidence || "feature verification 已由 harness 门控通过，feature.evidence 当前未填写"}`,
          ].join("\n");
          const commentFile = join(bodyDir, `${phaseId}-${f.id}.close.md`);
          writeFileSync(commentFile, closeComment);
          run(
            `gh issue comment --repo ${cfg.repo} ${issue.number} --body-file ${JSON.stringify(commentFile)}`,
            `评论自动关闭原因 #${issue.number}: ${title}`
          );
          run(
            `gh issue close --repo ${cfg.repo} ${issue.number} --reason completed`,
            `关闭 Issue #${issue.number}: ${title}`
          );
        }
      }
    }
  }

  log.info(`\n— 同步计划（${apply ? "已执行" : "dry-run，加 --apply 执行"}）—`);
  for (const c of plan) log.info(c);
  log.info(`\n共 ${plan.length} 条 gh 操作；近期 sprint: ${nearTerm.join(", ") || "(无)"}`);
}
