/**
 * 契约束 `research` — ③ API 契约（**唯一事实源**）
 *
 * ADR-020：这一份生成四样东西，任何一样都不许手写第二份——
 *   ├─→ 后端 DTO + NestJS 全局 ValidationPipe 的运行时校验
 *   ├─→ 前端 client 类型
 *   ├─→ OpenAPI（对外文档 + 契约 diff 门控）
 *   └─→ 前端 mock 数据
 *
 * 覆盖 feature：F144…F150（phase-01 `research` 域，合计 21 点）
 * 依据 UC：`24-research/uc-24-1` … `uc-24-5`（五份，R12 合计 41 条）
 * 领域模型见 `phases/phase-01-run-a-project/contracts/research/domain.md`（N-1…N-12 / X-A…X-J）
 * 用例接口见 同目录 `usecases.md`（一节 7 个写端口 + 二节 5 个读端口）
 * 覆盖矩阵见 同目录 `coverage.md`（V1…V41 逐行）
 *
 * ## 本束的范围由一条已拍板的裁决定死
 *   · **D-20**（`phases/requirements/DECISIONS-FINAL.md:97`，三份档案一致）：
 *     「新建深度研究配置面板（研究场景 / 可判定问题 / 4 类型 / 3 档时间盒 /
 *      来源偏好 / 交付形式 / 挂到组或决策节点）」——**七项配置**在下方 `ResearchConfig` 里逐项对应。
 *   · 七项配置的取值与默认值**全部来自原型 JS 数据区 16.90M**
 *     （`nrKinds` / `nrDepths` / `nrSources` / `nrOuts` / `nrNodeOpts`），
 *     已由 `24-research` 的五份 UC 逐字抽出。**本文件从 UC 读，不重挖原型。**
 *
 * ## ⚠ 本束的 20 条待裁**一条都没裁**（`requirements/24-research/OPEN-QUESTIONS.md`）
 * 因此本文件是**在裁决之前**写的，写法上必须比一般契约更保守：
 *   · **枚举值域未定的字段一律 `z.string()` + 一个 `*_PENDING` 常量**，而不是替人定一套值
 *     （形状照抄 `files.ts` 的 `SOURCE_TYPE_VOCABULARY_DISPUTED`，那是本仓已确立的做法）。
 *   · **随裁决增删的端口不写签名**（`usecases.md` 第三节的 5 个），只登记进 `PENDING_PORTS`。
 *   · 缺口一律进 `KNOWN_CONTRACT_GAPS`，**不发明**。
 *
 * ## 核心不变量（domain.md 第二节有断言方式）
 *   · **N-1 / N-2 / N-5 是三道入库门槛**，全在 `promoteConclusionToInsight` 上；
 *     它们立不住，D-20 的立论「研究 Studio 是 09-kg 证据的主要生产者」就作废
 *   · **N-3 低置信必须保留并标注**，不得在任何层过滤 ⇒ `getResearchDetail` 的段 ③
 *     **没有任何过滤参数**（加一个就是给「丢弃」开了门）
 *   · **N-4 检索来源 ⊆ `sourcePrefs`** ⇒ `SOURCE_PREF_VIOLATION`
 *   · **N-6 三个冲突判定动作不得预选、不得倒计时自动执行** ⇒ `listConflicts` 的返回里
 *     **没有 `suggested` / `defaultAction` 字段**（有它就是系统替人拍板）
 *   · **N-7 只归档不删除** ⇒ `deleteResearch` **不存在**，交付物是
 *     `tests/no-forbidden-routes.test.ts` 里一条断言它不存在的测试
 *   · **N-10 观察者的出口动作集合 = 空集**，且断言打在**行为**上不是 `disabled` 属性上
 *   · **N-11 入库产出的是候选洞察**，不是已采信结论
 *
 * ## ⚠ 本文件刻意**没有**的东西（缺了是结论，不是遗漏）
 *   · `ResearchQuestion` 实体 —— Q-8（一层还是两层）未裁 → `KNOWN_CONTRACT_GAPS.R7`
 *   · `copyResearch` —— `usecases.md` 1.6 逐字「Q-4 未裁前不实现」→ `PENDING_PORTS`
 *   · `ResearchStatus` / `EvidenceDisposition` / `SourceKind` 简称映射三个枚举
 *     —— Q-10 / Q-12 / Q-7 未裁 → 三个 `*_PENDING` 常量
 *   · `VALIDATION_FAILED` —— 见 `KNOWN_CONTRACT_GAPS.R6`
 *   · 硬删除研究 —— N-7 判负，不留码
 *
 * ⚠ **一个不会被任何路径抛出的错误码读起来像覆盖，而它什么都没覆盖**
 *   （`apps/api/migrations/0008-f06-binding-modes.sql:29-31` 逐字）。
 *   本文件的 `ResearchError` 每一个成员都在下方某个操作里出现——
 *   **`DECISION_NODE_GONE` 是唯一在 `out` 而不在 `err` 里的**，理由见它自己的注释。
 */
import { z } from "zod";
import { PermissionReason } from "./identity";
import { ArtifactSource } from "./artifact";
import { SkillError } from "./skills";

/* ─────────────────── 七项配置的枚举（原型常量，逐项照抄）─────────────────── */

/**
 * 研究类型。四值闭集，`[原型 @16,904,768B]`（`nrKinds`），`uc-24-1` R3 字段 3 抽出。
 *
 * ⚠ 键名用原型自己的短码（`desk` / `comp` / `reg` / `cust`），**不是我起的名**。
 * ⚠ 中文标签（桌面研究 / 竞品拆解 / 监管政策 / 客户侧核实）是**派生的展示层**，
 *   不在契约里再声明一份——那正是「同一事实两处声明」的形状。
 */
export const ResearchKind = z.enum(["desk", "comp", "reg", "cust"]);

/**
 * 深度与时间盒。三档闭集，`[原型 @16,905,029B]`（`nrDepths`），`uc-24-1` R3 字段 4。
 *   fast 快速扫读 8 分钟 · 3 路 · std 标准 20 分钟 · 6 路 · deep 深挖 45 分钟 · 12 路并交叉验证
 *
 * ⚠ **每档在原型里有两串文案**（`nrDepths[].note` 与 `DEPTH_L`，措辞不同，
 *   `[原型 @16,905,029B]` vs `@16,904,089B]`）。哪一串是权威 **Q-1 未裁**
 *   ⇒ 本契约**一串都不落**，只落枚举键。文案落在哪由 Q-1 裁完再说，
 *   现在写下去就是第三份副本（本仓已五次因此漂移）。→ `KNOWN_CONTRACT_GAPS.R2`
 */
export const ResearchDepth = z.enum(["fast", "std", "deep"]);

/**
 * 来源偏好。五值闭集，`[原型 @16,905,357B]`（`nrSources`），`uc-24-1` R3 字段 5。
 *
 * ⚠ **用中文全称做取值**是刻意的：原型只给了中文全称，给它们编一套英文键
 *   就是发明。`agent-runtime`（已签核）里 `ModelStatus` / `TaskKind` 等九个枚举
 *   都是这个形状，本束照它。
 * ⚠ Scout 执行步骤与证据表里用的是**简称**（官方 / 行业 / 媒体 / 监管年报 / 判例检索），
 *   与本枚举**对不上**（后两项在简称侧根本没有对应），映射规则 **Q-7 未裁**
 *   ⇒ 见 `SOURCE_KIND_SHORTHAND_PENDING`。**本束不发明映射。**
 * ⚠ `本场转写` 与 `内部洞察库` 是**内部来源**：勾选它们时研究的可见范围
 *   不得宽于来源本身（X-B，`recording` 束是可见性的单一事实源）。
 */
export const SourceKind = z.enum([
  "官方与监管",
  "行业报告",
  "媒体报道",
  "内部洞察库",
  "本场转写",
]);

/** 交付形式。四值闭集，`[原型 @16,905,533B]`（`nrOuts`），`uc-24-1` R3 字段 6。 */
export const Deliverable = z.enum(["研究简报", "证据表", "结论卡", "对比表"]);

/**
 * 冲突判定的三个动作。`[原型 @15,499,518B]`，`uc-24-5` R3.6 逐字。
 *
 * ⚠ **`以样本为准` 不得由系统预选，也不得倒计时自动执行**（N-6）。
 *   这条不变量落在 `listConflicts` 的返回形状上——它**没有** `suggested` 字段。
 * ⚠ `上台讨论` 的**后果** Q-18 未裁：端口接收该值，但**不实现后果**
 *   （`usecases.md` 1.5 逐字）。→ `PENDING_PORTS.EscalateConflictToAgenda`
 */
export const ConflictAction = z.enum(["以样本为准", "再补一路检索", "上台讨论"]);

/* ─────────────────── 三个「值域未定」的字段（Q-10 / Q-12 / Q-7）─────────────────── */

/**
 * 🔴 **研究状态：本束刻意不给它一个枚举。**
 *
 * 原型在四处给出**至少八个词**，无一处给全集（`OPEN-QUESTIONS.md` Q-10 的表）：
 *   · Studio 卡 `进行中`
 *   · Studio 左栏 `进行中` / `已完成` / `待复核`
 *   · 项目侧行 `已出结论` / `已归档`
 *   · 现场行 `运行中` / `已就绪` / `待判定`
 * 疑似同义对：`进行中`≈`运行中` · `已完成`≈`已出结论` · `待复核`≈`待判定`。
 *
 * ⚠ **「疑似」不能当依据**——本仓第八次事故就是「同名不同义 / 异名同义」。
 *   收敛成一套是 Q-10 的**推荐方案 A**，但它没被裁，**agent 不许代裁**。
 * ⇒ 下方凡涉及状态的字段一律 `z.string()`，**这个宽松是一个待裁标记，不是设计**。
 *   裁决后收敛为单一 `z.enum` + 一道「全仓恰一处定义」的机械门控。
 */
export const RESEARCH_STATUS_PENDING = {
  studioCard: ["进行中"],
  studioSidebar: ["进行中", "已完成", "待复核"],
  projectRow: ["已出结论", "已归档"],
  liveRow: ["运行中", "已就绪", "待判定"],
  why: "Q-10 unruled: four screens use at least eight words, no source gives the full set, and the suspected synonyms are only suspected",
} as const;

/**
 * 🔴 **证据「去向」：本束刻意不给它一个枚举，而且不打算给。**
 *
 * 原型只给两值 `已引用` / `反对证据` `[原型 @16,168,869B]`，全集未知。
 * ⚠ 更关键的是 **`反对证据` 与 phase-03 `14-brain` 决策链模板的硬要求
 *   「要求至少 1 条反对证据」`[原型 @16,334,264B]` 是同一概念**。
 * ⇒ Q-12 要裁的第一件事是**哪一边是单一事实源**（`usecases.md` 的推荐：`14-brain` 定义，
 *   本域引用）。在那之前本域声明一份 = 第二份事实源，正是要挡的东西。
 */
export const EVIDENCE_DISPOSITION_PENDING = {
  fromPrototype: ["已引用", "反对证据"],
  sharedConceptWith: "phase-03 14-brain decision-chain template requires >=1 counter-evidence",
  why: "Q-12 unruled: full value set unknown AND ownership of the shared concept undecided; declaring it here would be the second source of truth",
} as const;

/**
 * 🔴 **来源类别的全称 ↔ 简称映射：本束不发明。**
 *
 * 配置面板用全称五项（本文件的 `SourceKind`）；Scout 执行步骤与证据表用简称
 * （`官方` / `行业` / `媒体` / `监管年报` / `判例检索`），且**后两个全称
 * （`内部洞察库` / `本场转写`）在简称侧根本没有对应项**——不是笔误，是缺一块。
 * ⇒ Q-7 未裁前，执行步骤的分类计数用 `z.string()` 键。
 */
export const SOURCE_KIND_SHORTHAND_PENDING = {
  fullNames: SourceKind.options,
  shorthandsSeen: ["官方", "行业", "媒体", "监管年报", "判例检索"],
  why: "Q-7 unruled: the shorthand vocabulary is neither a subset nor a renaming of the full one; two full names have no shorthand at all",
} as const;

/* ──────────────────────────── 失败面 ──────────────────────────── */

/**
 * 本束的失败面。**每一个成员都在下方某个操作里出现**（`DECISION_NODE_GONE` 在 `out`，其余在 `err`）。
 *
 * 分四段：
 *   ① 与 phase-00 `identity` 束**同码同义**（下方 `_sharedWithIdentity` 是它的编译期门控）
 *   ② 与 phase-01 `skills` 束（**已签核**）**同码同义**（`_sharedWithSkills` 同理）
 *   ③ **`usecases.md` 声称「复用既有码」但全仓查无此字面量**的三条 —— 本文件是它们的第一处声明
 *   ④ 本束新增（`usecases.md` 零节逐条列出，**这里不许多一条**）
 *
 * ⚠ ③ 这一段是本文件写作过程中**最重要的发现**，逐条登记在
 *   `KNOWN_CONTRACT_GAPS.R1`。`project` 束当初撞到过一模一样的形状
 *   （`usecases.md:54` 声称 `ORG_ROLE_INSUFFICIENT` 与 phase-00 同码同义，核过之后那句话不成立）。
 *   **「声称复用」不等于「真的存在」——每一条都要 grep 过才算数。**
 */
export const ResearchError = z.enum([
  /* ── ① identity 束同码同义 ────────────────────────────────────── */
  /**
   * ⚠ **正常状态不是异常**（identity I-11）：一个不在本项目里的人读研究，
   *   这是「你没有这个上下文」，不是「你被拒绝了」。
   * ⚠ `usecases.md` 零节写的是 `FORBIDDEN_ROLE`（声称来自 `project` / `org-admin`），
   *   **全仓无此字面量**。本文件改用真实存在的两条 identity 码。见 `KNOWN_CONTRACT_GAPS.R1`。
   */
  "NO_PROJECT_ROLE",
  /** 有角色但该角色不含此动作。**N-10 的观察者写端口走的就是它** */
  "PROJECT_ROLE_INSUFFICIENT",

  /* ── ② skills 束（已签核）同码同义 ────────────────────────────── */
  /**
   * Scout 所用模型不可达（`uc-24-1` E1 / `uc-24-2`）。
   * ⚠ **不得静默换模型**（`skills.ts` 对该码的原注逐字）。
   * ⚠ `usecases.md` 说它来自 `agent-runtime`——**核过了，它在 `skills.SkillError` 里**，
   *   `agent-runtime.AgentRuntimeError` 没有这个成员。见 `KNOWN_CONTRACT_GAPS.R1`。
   */
  "MODEL_UNAVAILABLE",

  /* ── ③ 声称复用、实则本文件首次声明 ───────────────────────────── */
  /**
   * 检索执行失败（`uc-24-2` E1 / `uc-24-5` E1）。
   * ⚠ `usecases.md` 声称来自 `agent-runtime`（已签核）——**那束里没有这个字面量**，
   *   最接近的是 `AGENT_DEPENDENCY_FAILED`（agent 依赖失败），**语义不同**：
   *   一次检索跑挂 ≠ 它依赖的东西挂了。⇒ 本文件是第一处声明。
   * ⚠ **部分完成的结果必须可见**（`uc-24-2` E1）：这个码是**单路失败**的载体，
   *   不是「整单失败」——`runResearch.out.partial` 才是那条不变量的可断言面。
   */
  "AGENT_RUN_FAILED",
  /** 引导式研究会话不存在或对当前用户不可见；两种情况共用同一外部结果。 */
  "RESEARCH_NOT_FOUND",
  /** 创建时指定的协作者不是当前组织成员。 */
  "INVALID_RESEARCH_COLLABORATOR",
  /** 同一创建幂等键被用于不同的 brief 或协作者集合。 */
  "RESEARCH_CREATE_REPLAY_MISMATCH",
  /** 人工确认所基于的候选版本已被另一轮生成或确认替换。 */
  "RESEARCH_CHECKPOINT_CONFLICT",
  /** 生命周期操作未按已确认的大纲与研究阶段顺序执行。 */
  "RESEARCH_STAGE_CONFLICT",
  /** 报告大纲只能基于已经由人确认的研究方向生成。 */
  "RESEARCH_DIRECTIONS_NOT_CONFIRMED",
  /** Guided Research Graph 服务暂时不可用。 */
  "RESEARCH_WORKFLOW_UNAVAILABLE",
  /** 节点尚未由服务端工作流解锁。 */
  "RESEARCH_NODE_LOCKED",
  /** 命令节点与服务端当前节点不一致。 */
  "RESEARCH_NODE_MISMATCH",
  /** 命令基于的 Graph 版本已过期。 */
  "RESEARCH_GRAPH_VERSION_CONFLICT",
  /** 当前节点提交的完整前端状态未通过严格校验。 */
  "RESEARCH_NODE_STATE_INVALID",
  /** 同一个 requestId 被用于不同的命令载荷。 */
  "RESEARCH_IDEMPOTENCY_REPLAY_MISMATCH",
  /** 命令引用了当前 revision 不可用的下游内容。 */
  "RESEARCH_CONTENT_REFERENCE_INVALID",
  /** 当前研究任务没有可重试的失败项。 */
  "RESEARCH_TASK_NOT_RETRYABLE",
  /**
   * 证据所依赖的访谈引述已被撤回（X-C）。
   * ⚠ `usecases.md` 声称来自 `interview`（已签核）——**那束里没有这个字面量**；
   *   它有的是 `WITHDRAWAL_IN_PROGRESS` / `ERASURE_NOT_COMPLETE`（撤回**流程**的两态），
   *   而本束要表达的是「引述已经没了，这条证据不能再用」。⇒ 本文件是第一处声明。
   * ⚠ **失效 SLA 在对方**（`interview` 是撤回链的单一事实源），
   *   本束一个天数都不复述——本仓已因复述撤回链 SLA 漂移过一次。
   */
  "QUOTE_REVOKED",
  /**
   * 观察者试图经由研究结论间接读到本场逐字稿原文（X-B）。
   * ⚠ `usecases.md` 声称来自 `recording`（已签核）——**那束里没有这个字面量**。
   *   ⇒ 本文件是第一处声明。**判定仍属 `recording`**（可见性的单一事实源），
   *   本束只是它的投影：`SourceKind` 含 `本场转写` 时的读取要向那束求交。
   */
  "SOURCE_OUT_OF_SCOPE",

  /* ── ④ 本束新增（usecases.md 零节，六条）──────────────────────── */
  /**
   * **N-1**：结论无外部来源却调入库。
   * 项目侧列表页副标题逐字「结论必须**挂着外部来源**才能进洞察库」`[原型 @15,326,937B]`。
   * ⚠ 与下一条**必须分开**：这是**缺出处**（可补），下一条是**有出处但相互矛盾**（要判定）。
   *   合并会让用户走错补救路径。
   * ⚠ 阻断必须是**机械的**（`uc-24-4` R12.1）：灰按钮在 API 层挡不住任何东西。
   */
  "NO_EXTERNAL_SOURCE",
  /** **N-2**：「争议 / 不确定」段的条目调入库。段 ② 的条目**永不**入库 */
  "EVIDENCE_IS_DISPUTED",
  /**
   * **N-5**：冲突未经**人**判定却调入库。
   * ⚠ 与 `EVIDENCE_IS_DISPUTED` 的区别：那是**单条**证据不确定，
   *   这是**两条结论互斥**且**等人判定**。系统替人拍板正是 N-5 要挡的。
   */
  "CONFLICT_PENDING_HUMAN",
  /**
   * **N-4**：检索请求越出 `sourcePrefs`。
   * ⚠ 这是**内部一致性违反**，不是权限问题——用一个权限码会误导用户去找管理员，
   *   而正确的下一步是「先改本研究的来源偏好配置」。
   */
  "SOURCE_PREF_VIOLATION",
  /** **N-7**：对已归档研究调写端口。⚠ 归档**不是**删除，也**不是**无权限 */
  "RESEARCH_ARCHIVED",
  /**
   * `uc-24-4` E2：入库成功但决策节点回流失败（节点已删 / 已关闭）。
   *
   * 🔴 **这是本束唯一在 `out` 里而不在任何 `err` 里的成员，而且必须如此。**
   * 它是**部分成功**：入库已经发生了。把它放进 `err` ⇒ 前端读到失败 ⇒ 回滚一次
   * **已经成功的入库**。`usecases.md` 零节末尾逐字点名这是「本节最容易做错的一条」。
   * ⇒ 它出现在 `promoteConclusionToInsight.out.nodeBackflow.reason` 上。
   */
  "DECISION_NODE_GONE",
]);

type ResearchErrorT = z.infer<typeof ResearchError>;
type PermissionReasonT = z.infer<typeof PermissionReason>;
type SkillErrorT = z.infer<typeof SkillError>;
type ArtifactSourceT = z.infer<typeof ArtifactSource>;

/**
 * **跨束同码同义的编译期门控**（`pnpm --filter @repo/contracts run typecheck` 会红）。
 *
 * 交集类型 `PermissionReasonT & ResearchErrorT` 只接受**两个枚举都有**的字面量：
 * 任何一侧改名、拼错、或有人在本束「另起一份名字」，这里立刻不通过类型检查。
 *
 * ⚠ 为什么不 import 枚举本身：`identity` 是更内层的束，直接 import 会让本束的失败面
 *   随它变动。这里要的是「同名是刻意的」的**证明**，不是依赖
 *   （同 `project.ts` / `files.ts` / `auth.ts` 的处理）。
 */
const _sharedWithIdentity = [
  "NO_PROJECT_ROLE",
  "PROJECT_ROLE_INSUFFICIENT",
] as const satisfies readonly (PermissionReasonT & ResearchErrorT)[];

/**
 * 与**已签核**的 `skills` 束同码同义。
 * ⚠ 注意它不在 `agent-runtime` 里——`usecases.md` 那一行写错了归属，
 *   而**归属写错的后果不是文档瑕疵**：它会让人去改错的束、以为改完就对齐了。
 */
const _sharedWithSkills = ["MODEL_UNAVAILABLE"] as const satisfies readonly (SkillErrorT &
  ResearchErrorT)[];

/* ─────────────────── 与 `files` 束（已签核）的八值枚举对齐 ─────────────────── */

/**
 * 🔴 **X-E：一个已签核的束正在依赖本束，而两侧现在对不齐。**
 *
 * `contracts/files/domain.md:178` 与 `requirements/22-files/uc-22-1.md:255` 逐字要求：
 * 「来源类型八值枚举必须与 12-survey / 06-itv / 05-rec / 08-chat / 07-canvas /
 *  **研究 Studio** 的产出侧同一份定义，**不得各建各的**」。
 *
 * ## 核对结果（三方，两两都不等）
 *   · **契约侧** `artifact.ArtifactSource`（**已签核**，7 值）里研究那一项叫 **`research-run`**
 *   · **界面侧** `apps/web/lib/mock/files.ts` 的 `SourceType`（8 值）里叫 **`research`**
 *   · **本束的产出侧**（X-E 逐字）：「研究产物物化为 `网页快照 + citations.json`，
 *     `source = research`」——**站在界面侧那个拼写上**
 * ⇒ 三方里有两方（界面 + 本束）用 `research`，一方（**已签核的契约**）用 `research-run`。
 *
 * ## 本束的处置：**不改任何一侧，把差异钉成编译期事实 + 登记为缺口**
 * 下方 `satisfies` 断言的是「**已签核契约侧的字面量就是 `research-run`**」：
 * 若 `artifact` 束哪天把它改名，这一行立刻不通过类型检查——
 * 也就是说，**这条跨束约束从今天起有一道会红的门**，不再是一句悬空的话。
 *
 * ⚠ **对齐方向是签核动作，不是实现动作**（`files.ts` 已经因为同一个分歧
 *   把所有 `sourceType` 写成 `z.string()`，见它的 `SOURCE_TYPE_VOCABULARY_DISPUTED`）。
 *   要么 `artifact`（已签核）改名 `research-run` → `research`，
 *   要么界面侧与本束改用 `research-run`。**前者动已签核束，后者动两处；两边都得人点头。**
 *   逐条见 `KNOWN_CONTRACT_GAPS.R3`。
 */
export const RESEARCH_ARTIFACT_SOURCE = ["research-run"] as const satisfies readonly ArtifactSourceT[];

/* ─────────────────────────────── 实体 ─────────────────────────────── */

/**
 * **七项配置**（D-20 逐字点名的那一块，`uc-24-1` R3 的七组字段）。
 *
 * ⚠ **N-12：七项配置是执行契约，创建后固化。** 预览句逐字承诺「来源**限定**在 {…}」
 *   ⇒ `uc-24-2` 的检索**不得**越出 `sourcePrefs`；越出即缺陷，不是「更聪明」。
 * ⚠ **默认值不在契约里**（`uc-24-1` R7.5 的七个默认值：`desk` / `std` /
 *   `[官方与监管, 行业报告]` / `[研究简报]` / `n1` …）。它们是**创建表单的默认**，
 *   属界面层；写进契约就是第二份声明。R7.5 的断言打在界面上（V2 / V9）。
 *   ⚠ 本仓已因「默认值画反」判过一次重做（`PROTOTYPE-SWEEP-UI.md` P-05）。
 */
export const ResearchConfig = z
  .object({
    /** ① 研究场景 · 在什么处境下要这个答案 `[原型 @16,904,379B]` */
    scene: z.string(),
    /** ② 要回答的问题 · 一句话，**可判定** `[原型 @16,904,542B]`。
     *  ⚠ 系统**不做**语义可判定性判定（`uc-24-1` E2），也**不许**发明一个「可判定性打分」 */
    question: z.string().min(1),
    /** ③ 四类型 */
    kind: ResearchKind,
    /** ④ 三档时间盒 */
    depth: ResearchDepth,
    /**
     * ⑤ 来源偏好（多选）。
     * ⚠ **空数组的语义未定**（Q-5：等价于全选 / 拒绝创建 / 至少保留一项）
     *   ⇒ 这里**不加 `.min(1)`**：加上就是替 Q-5 裁了「拒绝创建」。→ `KNOWN_CONTRACT_GAPS.R4`
     */
    sourcePrefs: z.array(SourceKind),
    /** ⑥ 交付形式（多选） */
    deliverables: z.array(Deliverable),
    /** ⑦-a 挂到哪一组。`"all"` = 全场共用 `[原型 @16,905,760B]`。
     *  ⚠ 组长能否选 `"all"` → Q-3 未裁，本契约**不设权限分支** */
    groupRef: z.union([z.string(), z.literal("all")]),
    /** ⑦-b 挂到哪个决策节点。`null` ⟺ 选了「不挂节点，**只存进洞察库**」`[原型 @16,906,274B]`。
     *  ⚠ **R7.4：「不挂节点」是一等公民选项，不是取消**——选它仍然产生洞察 */
    decisionNodeRef: z.string().nullable(),
  })
  .strict();

/**
 * 研究实体（`domain.md` 1.1）。
 *
 * ⚠ **Q-8 未裁，这是一层还是两层的「一层」**：若裁 B（两层），
 *   `ResearchQuestion` 会成为独立实体、本实体多一个 `questions` 关系。
 *   **本文件不预建那个实体**（建了就是把未定的范围伪装成已定）→ `KNOWN_CONTRACT_GAPS.R7`。
 */
export const Research = z
  .object({
    id: z.string(),
    /** ⚠ `null` = Studio 独立发起（`usecases.md` 1.1 的 `projectRef` 注释逐字） */
    projectRef: z.string().nullable(),
    config: ResearchConfig,
    /** ⚠ **值域未定**（Q-10）。见 `RESEARCH_STATUS_PENDING` —— 这个 `string` 是待裁标记 */
    status: z.string(),
    /** **N-9**：提出方必须留痕（`[原型 @15,330,698B]`「林可提出」/ `uc-24-5` R3.3） */
    createdBy: z.string(),
    createdAt: z.string(),
    /** **N-7**：只归档不删除；`archivedAt` 非空后**被引用的证据仍不失效** */
    archivedAt: z.string().nullable(),
    /** `关键 · 置顶`。⚠ 与结论区的「标为关键问题」是否同一动作 → Q-13 未裁，两者不合并 */
    pinned: z.boolean(),
  })
  .strict();

/**
 * 证据（`domain.md` 1.3）。
 *
 * ⚠ **`confidence` 是数值不是标签**（`uc-24-2` R7.6：0–1 一位小数，原型示例 0.9 / 0.8 / 0.3）。
 *   做成 `高/中/低` 三档就再也表达不了 N-3 的「0.3 这一条必须出现且带标注」。
 * ⚠ **N-3：低置信必须保留并标注，不得在任何层过滤。**
 */
export const Evidence = z
  .object({
    id: z.string(),
    /** 一句可判定陈述，例：`审批周期中位数 11 个月` */
    claim: z.string(),
    /** ⚠ **简称还是全称未定**（Q-7）⇒ `z.string()`。见 `SOURCE_KIND_SHORTHAND_PENDING` */
    sourceKind: z.string(),
    /** 多态引用：外部来源 / 访谈引述 / 转写片段…。⚠ 指向访谈引述时受 X-C 的撤回链约束 */
    sourceRef: z.string(),
    /** ⚠ `null` = 该行原型逐字给的是 `—`（例：「其余 12 条 · 含 3 条低可信度已标注 | —」）。
     *  **N-8：缺失渲染 `—` 而非 `0`**，所以这里是 `nullable` 不是默认 0 */
    confidence: z.number().min(0).max(1).nullable(),
    /** 「去向」。⚠ **值域未定且归属未定**（Q-12）⇒ `z.string()`。见 `EVIDENCE_DISPOSITION_PENDING` */
    disposition: z.string(),
  })
  .strict();

/**
 * Scout 一轮执行的产物（`uc-24-2` R3.3 的「执行步骤层」）。
 *
 * ⚠ 步骤①的**分类计数**必须与七项配置的来源偏好口径**同源**（`uc-24-2` R7.4），
 *   否则是第二份来源枚举。Q-7 未裁 ⇒ 键是 `z.string()`，**不是** `Record<SourceKind, number>`。
 */
export const ResearchRun = z
  .object({
    id: z.string(),
    researchId: z.string(),
    /**
     * 计划的检索路数（来自 `depth`：fast 3 / std 6 / deep 12）与**实际完成**的路数。
     * ⚠ **E1 的可断言面**：`completedRoutes < plannedRoutes` 时
     *   「已完成路的结果**必须可见**」——把它做成一个整体 200/500 就表达不了。
     */
    plannedRoutes: z.number().int().positive(),
    completedRoutes: z.number().int().nonnegative(),
    /** 失败路的原因。⚠ 空数组 = 无失败；**失败不得呈现为「没有结果」** */
    failedRoutes: z.array(
      z
        .object({ route: z.number().int().nonnegative(), reason: ResearchError })
        .strict(),
    ),
    /**
     * 步骤①的按类别计数（`官方 6 / 行业 5 / 媒体 12`）。
     * ⚠ 写成数组而不是对象，理由同 `files.ts` 的 `sourceCounts`：
     *   键的值域未定（Q-7）时，对象形状会把一套未定的键固化进 OpenAPI。
     */
    sourceCounts: z.array(
      z.object({ sourceKind: z.string(), count: z.number().int().nonnegative() }).strict(),
    ),
    /** 步骤②：交叉验证标为不确定的条数 */
    conflictsMarked: z.number().int().nonnegative(),
  })
  .strict();

/**
 * 研究结果的**四段固定结构**（`uc-24-2` R3.5，四个标题逐字）。
 *
 * ⚠ **段 ② 带「不进洞察库」语义**（N-2）；段 ③ 是入库门槛 N-1 的判据面。
 * ⚠ **E2 零来源时段 ① 为空、段 ④ 是数据需求说明而非结论**——
 *   所以段 ④ 有 `isDataRequest` 而不是让前端猜。
 */
export const ResearchResult = z
  .object({
    /** 段 ① **关键发现**：每条一句可判定陈述。空数组是**合法**的（E2 / E3） */
    keyFindings: z.array(z.string()),
    /** 段 ② **争议 / 不确定**。⚠ 这一段的条目**永不入洞察库**（N-2） */
    disputed: z.array(z.string()),
    /** 段 ③ **外部来源**。⚠ **N-3：这里没有任何过滤参数**——低置信必须出现在其中 */
    externalSources: z.array(Evidence),
    /** 段 ④ **研究结论**。`null` = 尚未产出（A2 运行中 / E2 零来源 / E3 全低置信） */
    conclusion: z.string().nullable(),
    /**
     * 段 ④ 是**数据需求说明**而不是结论（E2）。
     * ⚠ 没有这个布尔，「框架/数据需求说明」和「结论」在响应里长得一模一样，
     *   而 R7 的通用硬规则是「没有数据时**不能生成真实结论**」——那条规则就不可断言了。
     */
    isDataRequest: z.boolean(),
  })
  .strict();

/**
 * 候选洞察（**N-11**）。
 *
 * ⚠ **入库 ≠ 已采信**：原型逐字「候选洞察 7 · **待送综合 Studio 验证**」`[原型 @16,171,008B]` /
 *   「候选洞察 2 条 · **待入定题池**」`[原型 @16,944,170B]`。
 * ⚠ 下游那道验证**不在 phase-01**（`14-brain` 在 phase-03），
 *   且「综合 Studio」**在任何 phase 都不存在** → Q-11 / X-D，见 `PENDING_PORTS`。
 */
export const CandidateInsight = z
  .object({
    id: z.string(),
    researchId: z.string(),
    conclusionId: z.string(),
    /**
     * **N-3 的下游一半**：低置信来源**随之带过去并保持标注**。
     * ⚠ 这里携带的是**证据本身**而不是一个 `sourceCount` 数字：
     *   数字表达不了「入库后的洞察上仍能读到该来源与其置信度」（V3 / 24-4 R12.3）。
     */
    evidence: z.array(Evidence),
    /** ⚠ **值域未定**（Q-10 同族）：「待入定题池」「待送综合 Studio 验证」是原型给的两串文案 */
    candidateStatus: z.string(),
  })
  .strict();

/** 冲突项（`uc-24-5` R3.4–3.6）。 */
export const ResearchConflict = z
  .object({
    id: z.string(),
    researchId: z.string(),
    /** 冲突正文，例：「行业报告说平均 7 个月，项目样本中位 9.5 个月」 */
    statement: z.string(),
    /**
     * agent 的建议正文（原型逐字「建议以样本为准，报告标为参考」）。
     * 🔴 **N-6：它是一段文字，不是一个预选值。**
     *   本对象刻意**没有** `suggestedAction: ConflictAction` 这样的字段——
     *   一旦有了它，前端把它渲染成预选/高亮/倒计时只是时间问题，
     *   而那正是「系统替人拍板」。三个动作**永远是三个平权的选项**。
     */
    agentSuggestion: z.string(),
    /** 三个可选动作。⚠ **恒为全集三项，且无序无预选**（N-6） */
    actions: z.array(ConflictAction),
    /** `null` = 待判定。非空 = 已由**人**判定（N-5） */
    resolution: z
      .object({
        action: ConflictAction,
        /** **N-9 / R6：谁在何时选了哪一条**，且**不可静默删除**（`uc-24-5` R6） */
        actorUserId: z.string(),
        resolvedAt: z.string(),
      })
      .strict()
      .nullable(),
  })
  .strict();

/**
 * **禁止存在的路由**（**N-7**）。
 *
 * 交付物是**一条断言它不存在的测试**，不是一个接口——理由逐字照抄 N-5：
 * 「**『没有』这件事本身没人会去验**，某天有人为别的需求加上，不会有任何东西报警。」
 *
 * ⚠ 原型的行动作提示逐字是「已**归档**该研究主题」`[原型 @16,907,049B]`，
 *   handler 名却叫 `delDrItem`——**名字像删除、行为是归档**。
 *   一个照着 handler 名做实现的人会造出真的删除，而**没有任何东西会报警**。
 *   这条断言就是那个警报。
 */
export const RESEARCH_FORBIDDEN_ROUTES = [
  {
    route: "DELETE /research/:researchId",
    why: "N-7：研究只归档不删除，且**被引用的证据在归档后不失效**。硬删除会让引用方（09-kg 证据 / 10-report 取材 / 14-brain 候选洞察）凭空断链——而 D-20 的立论正是「研究 Studio 是 09-kg 证据的主要生产者」。原型 handler 叫 delDrItem 但提示逐字是「已归档」，照名字实现就会造出删除。",
  },
] as const;

/* ───────────────────────────── 操作 ───────────────────────────── */

export const GuidedResearchStage = z.enum([
  "brief", "directions", "outline", "researching", "report", "failed",
]);

export const GuidedResearchBrief = z.object({
  topic: z.string().trim().min(1).max(200),
  goal: z.string().trim().min(1).max(2000),
  timeRange: z.string().trim().max(200),
  region: z.string().trim().max(200),
  focus: z.string().trim().max(2000),
}).strict();

export const GuidedResearchDirection = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(2000),
  enabled: z.boolean(),
  order: z.number().int().nonnegative(),
}).strict();

export const GuidedResearchDirectionGenerationResponse = z.object({
  directions: z.array(GuidedResearchDirection).min(1),
}).strict();

export const GuidedResearchOutlineSection = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1).max(200),
  questions: z.array(z.string().trim().min(1).max(1000)).min(1),
  enabled: z.boolean(),
  order: z.number().int().nonnegative(),
}).strict();

const versionedCheckpoint = <T extends z.ZodTypeAny>(item: T) => z.object({
  candidateVersion: z.number().int().positive().nullable(),
  confirmedVersion: z.number().int().positive().nullable(),
  versions: z.array(z.object({
    version: z.number().int().positive(), items: z.array(item).min(1),
    createdAt: z.string(), confirmedAt: z.string().nullable(),
  }).strict()),
}).strict();

export const GuidedResearchDirectionsCheckpoint = versionedCheckpoint(GuidedResearchDirection);
export const GuidedResearchOutlineCheckpoint = versionedCheckpoint(GuidedResearchOutlineSection);

export const ResearchNode = z.enum(["brief", "directions", "outline", "research", "report"]);
export const ResearchNodeAction = z.enum([
  "save", "generate", "confirm", "start", "retry", "reconfirm", "complete",
]);

export const BriefNodeInputState = z.object({
  name: z.string().trim().min(1).max(100),
  tags: z.array(z.string().trim().min(1).max(20)).max(5)
    .refine((tags) => new Set(tags).size === tags.length, "research tags must be unique"),
  topic: z.string().trim().min(1).max(200),
  objective: z.string().trim().min(1).max(2000),
  timeRange: z.string().trim().max(200),
  geography: z.string().trim().max(200),
  focus: z.string().trim().max(2000),
}).strict();

const uniqueIds = (ids: string[]) => new Set(ids).size === ids.length;
const hasContiguousOrder = (items: readonly { order: number }[]) =>
  items.map((item) => item.order).sort((left, right) => left - right)
    .every((order, index) => order === index);

export const DirectionsNodeInputState = z.object({
  directions: z.array(GuidedResearchDirection).min(1),
}).strict()
  .refine((state) => state.directions.some((direction) => direction.enabled), "at least one direction must be enabled")
  .refine((state) => uniqueIds(state.directions.map((direction) => direction.id)), "direction ids must be unique")
  .refine((state) => hasContiguousOrder(state.directions), "direction order must be contiguous from zero");

export const GuidedResearchWorkflowOutlineSection = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(2000),
  researchQuestions: z.array(z.string().trim().min(1).max(1000)).min(1),
  order: z.number().int().nonnegative(),
}).strict();

export const GuidedResearchOutlineGenerationResponse = z.object({
  sections: z.array(GuidedResearchWorkflowOutlineSection).min(1),
}).strict();

export const OutlineNodeInputState = z.object({
  sections: z.array(GuidedResearchWorkflowOutlineSection).min(1),
}).strict()
  .refine((state) => uniqueIds(state.sections.map((section) => section.id)), "outline section ids must be unique")
  .refine((state) => hasContiguousOrder(state.sections), "outline section order must be contiguous from zero");

export const ResearchNodeInputState = z.object({
  acceptedSourceIds: z.array(z.string().trim().min(1)).refine(uniqueIds, "accepted source ids must be unique"),
  excludedSourceIds: z.array(z.string().trim().min(1)).refine(uniqueIds, "excluded source ids must be unique"),
}).strict().refine(
  (state) => !state.acceptedSourceIds.some((id) => state.excludedSourceIds.includes(id)),
  "accepted and excluded source ids must not overlap",
);

export const ReportNodeInputState = z.object({
  title: z.string().trim().min(1).max(200),
  revisionInstruction: z.string().trim().max(2000),
}).strict();

const nodeCommandBase = {
  sessionId: z.string().trim().min(1),
  action: ResearchNodeAction,
  requestId: z.string().trim().min(1).max(200),
  expectedGraphVersion: z.number().int().nonnegative(),
};

export const GuidedResearchNodeCommand = z.discriminatedUnion("node", [
  z.object({ ...nodeCommandBase, node: z.literal("brief"), nodeState: BriefNodeInputState }).strict(),
  z.object({ ...nodeCommandBase, node: z.literal("directions"), nodeState: DirectionsNodeInputState }).strict(),
  z.object({ ...nodeCommandBase, node: z.literal("outline"), nodeState: OutlineNodeInputState }).strict(),
  z.object({ ...nodeCommandBase, node: z.literal("research"), nodeState: ResearchNodeInputState }).strict(),
  z.object({ ...nodeCommandBase, node: z.literal("report"), nodeState: ReportNodeInputState }).strict(),
]);

export const GuidedResearchNodeStatus = z.enum([
  "locked", "draft", "running", "ready", "confirmed", "failed", "stale", "completed",
]);

export const GuidedResearchNodeMeta = z.object({
  status: GuidedResearchNodeStatus,
  version: z.number().int().nonnegative(),
  confirmedVersion: z.number().int().nonnegative().nullable(),
  contentVersionId: z.string().nullable(),
  modelId: z.literal("qwen3.7-plus").nullable(),
  modelInvocationId: z.string().nullable(),
  modelOutputSchemaVersion: z.string().nullable(),
  confirmedAt: z.string().nullable(),
  updatedAt: z.string(),
  errorCode: z.string().nullable(),
}).strict();

export const GuidedResearchSkillProjection = z.object({
  threadId: z.string(),
  activeNode: ResearchNode,
  summaryId: z.string().nullable(),
  recentMessageIds: z.array(z.string()),
  activeProposalId: z.string().nullable(),
  proposalStatus: z.enum(["none", "proposed", "applied_to_draft", "rejected", "committed", "stale"]),
}).strict();

/**
 * The conversational research assistant accepts the complete draft for the
 * step the user is looking at.  Keeping the draft in the request makes a turn
 * stateless and, importantly, prevents the model from inventing a second copy
 * of the workflow state.
 */
export const GuidedResearchSkillDraft = z.discriminatedUnion("node", [
  z.object({ node: z.literal("brief"), value: GuidedResearchBrief }).strict(),
  z.object({ node: z.literal("directions"), value: z.array(GuidedResearchDirection) }).strict(),
  z.object({ node: z.literal("outline"), value: z.array(GuidedResearchOutlineSection) }).strict(),
  z.object({
    node: z.literal("research"),
    value: z.object({
      acceptedSourceIds: z.array(z.string()),
      excludedSourceIds: z.array(z.string()),
    }).strict(),
  }).strict(),
  z.object({
    node: z.literal("report"),
    value: z.object({ reportSummary: z.string().max(20_000) }).strict(),
  }).strict(),
]);

export const GuidedResearchSkillTurnResponse = z.object({
  assistantMessage: z.string().trim().min(1).max(10_000),
  proposal: GuidedResearchSkillDraft,
  modelId: z.literal("qwen3.7-plus"),
  modelInvocationId: z.string().min(1),
}).strict();

const GuidedResearchNodeSummaries = z.object({
  brief: GuidedResearchNodeMeta,
  directions: GuidedResearchNodeMeta,
  outline: GuidedResearchNodeMeta,
  research: GuidedResearchNodeMeta,
  report: GuidedResearchNodeMeta,
}).strict();

export const GuidedResearchWorkflowProjection = z.object({
  sessionId: z.string(),
  graphVersion: z.number().int().nonnegative(),
  revision: z.number().int().positive(),
  currentNode: ResearchNode,
  availableNodes: z.array(ResearchNode),
  nodeSummaries: GuidedResearchNodeSummaries,
  activeNodeState: z.union([
    BriefNodeInputState,
    DirectionsNodeInputState,
    OutlineNodeInputState,
    ResearchNodeInputState,
    ReportNodeInputState,
  ]),
  nodeStateVersions: z.object({
    brief: z.number().int().nonnegative().optional(),
    directions: z.number().int().nonnegative().optional(),
    outline: z.number().int().nonnegative().optional(),
    research: z.number().int().nonnegative().optional(),
    report: z.number().int().nonnegative().optional(),
  }).strict(),
  skill: GuidedResearchSkillProjection,
  interrupt: z.object({
    node: ResearchNode,
    allowedActions: z.array(ResearchNodeAction),
  }).strict().nullable(),
}).strict();

const guidedWorkflowErrors = [
  "RESEARCH_NOT_FOUND",
  "RESEARCH_WORKFLOW_UNAVAILABLE",
  "RESEARCH_NODE_LOCKED",
  "RESEARCH_NODE_MISMATCH",
  "RESEARCH_GRAPH_VERSION_CONFLICT",
  "RESEARCH_NODE_STATE_INVALID",
  "RESEARCH_IDEMPOTENCY_REPLAY_MISMATCH",
  "RESEARCH_CONTENT_REFERENCE_INVALID",
  "RESEARCH_TASK_NOT_RETRYABLE",
  "RESEARCH_WORKFLOW_BUSY",
  "RESEARCH_MODEL_GENERATION_REQUIRED",
  "RESEARCH_TASKS_INCOMPLETE",
  "RESEARCH_SOURCES_REQUIRED",
  "RESEARCH_SEARCH_NOT_CONFIGURED",
  "RESEARCH_SEARCH_UNAVAILABLE",
  "RESEARCH_SEARCH_PARTIAL_FAILURE",
] as const;

export const GuidedResearchSession = z.object({
  sessionId: z.string(),
  title: z.string(),
  tags: z.array(z.string().trim().min(1).max(20)).max(5).default([]),
  brief: GuidedResearchBrief,
  briefVersion: z.number().int().positive().default(1),
  briefConfirmedAt: z.string().nullable().default(null),
  directions: GuidedResearchDirectionsCheckpoint.default({ candidateVersion: null, confirmedVersion: null, versions: [] }),
  outline: GuidedResearchOutlineCheckpoint.default({ candidateVersion: null, confirmedVersion: null, versions: [] }),
  /** 服务端断点事实；客户端只能读取，不能在创建时指定。 */
  stage: GuidedResearchStage,
  /** 失败态仍指向最近稳定阶段；首页只按这个服务端字段恢复。 */
  resumeStage: GuidedResearchStage.exclude(["failed"]),
  status: z.enum(["active", "completed", "failed"]),
  progress: z.number().int().min(0).max(100),
  sourceCount: z.number().int().min(0),
  reportId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).strict();

// Durable five-step research. Provider output never supplies source identifiers or URLs.
export const GuidedResearchSource = z.object({
  id: z.string().min(1), taskId: z.string().min(1), title: z.string().min(1),
  url: z.string().url().refine((url) => /^https?:\/\//.test(url)),
  content: z.string().min(1).max(30000), retrievedAt: z.string(),
  decision: z.enum(["pending", "accepted", "excluded"]),
}).strict();
export const GuidedResearchTask = z.object({
  id: z.string().min(1), sectionId: z.string().min(1), query: z.string().trim().min(1).max(1000),
  status: z.enum(["pending", "running", "succeeded", "failed"]), attempts: z.number().int().nonnegative(),
  errorCode: z.string().nullable(),
}).strict();
export const GuidedResearchReport = z.object({
  title: z.string().trim().min(1).max(200), summary: z.string().trim().min(1).max(10000),
  sections: z.array(z.object({
    sectionId: z.string().min(1), body: z.string().trim().min(1).max(20000),
    sourceIds: z.array(z.string().min(1)).min(1),
  }).strict()).min(1).max(30),
}).strict();
export const GuidedResearchRuntimeDraft = z.discriminatedUnion("node", [
  z.object({ node: z.literal("brief"), value: GuidedResearchBrief }).strict(),
  z.object({ node: z.literal("directions"), value: z.array(GuidedResearchDirection).min(1).max(20).refine((items) => items.some((item) => item.enabled) && new Set(items.map((item) => item.id)).size === items.length) }).strict(),
  z.object({ node: z.literal("outline"), value: z.array(GuidedResearchOutlineSection).min(1).max(30).refine((items) => items.some((item) => item.enabled) && new Set(items.map((item) => item.id)).size === items.length) }).strict(),
  z.object({ node: z.literal("research"), value: z.array(z.object({ id: z.string(), decision: z.enum(["pending", "accepted", "excluded"]) }).strict()) }).strict(),
  z.object({ node: z.literal("report"), value: GuidedResearchReport }).strict(),
]);
export const GuidedResearchRuntime = z.object({
  sessionId: z.string(), version: z.number().int().nonnegative(), revision: z.number().int().positive(),
  currentNode: ResearchNode, availableNodes: z.array(ResearchNode),
  brief: GuidedResearchBrief, directions: z.array(GuidedResearchDirection), outline: z.array(GuidedResearchOutlineSection),
  tasks: z.array(GuidedResearchTask), sources: z.array(GuidedResearchSource), report: GuidedResearchReport.nullable(),
  legacyCheckpoint: GuidedResearchSession.nullable().optional(),
  completed: z.boolean(), busy: z.boolean(), leaseUntil: z.string().nullable(), errorCode: z.string().nullable(),
  generatedNodes: z.array(ResearchNode),
  messages: z.array(z.object({ id: z.string(), node: ResearchNode, role: z.enum(["user", "assistant"]), text: z.string(), createdAt: z.string() }).strict()),
  proposal: z.object({ id: z.string(), version: z.number().int(), draft: GuidedResearchRuntimeDraft, action: z.enum(["save", "generate", "start", "retry", "confirm", "complete"]).optional() }).strict().nullable(),
  modelCalls: z.array(z.object({ id: z.string(), node: ResearchNode, modelId: z.string(), status: z.enum(["succeeded", "failed"]), createdAt: z.string() }).strict()),
}).strict();
export const GuidedResearchRuntimeCommand = z.object({
  sessionId: z.string().min(1), node: ResearchNode,
  action: z.enum(["save", "generate", "confirm", "start", "retry", "complete", "message", "apply"]),
  requestId: z.string().min(1).max(200), expectedVersion: z.number().int().nonnegative(),
  draft: GuidedResearchRuntimeDraft.optional(), message: z.string().trim().min(1).max(10000).optional(),
  proposalId: z.string().min(1).optional(),
}).strict().refine((command) => !command.draft || command.node === command.draft.node, "draft must target the requested node");

export const operations = {
  getGuidedResearchRuntime: {
    method: "GET", path: "/research/guided-sessions/:sessionId/runtime",
    in: z.object({ sessionId: z.string().min(1) }).strict(), out: GuidedResearchRuntime,
    err: ["RESEARCH_NOT_FOUND", "RESEARCH_WORKFLOW_UNAVAILABLE"] as const,
  },
  executeGuidedResearchRuntime: {
    method: "POST", path: "/research/guided-sessions/:sessionId/runtime/commands",
    in: GuidedResearchRuntimeCommand, out: GuidedResearchRuntime, err: guidedWorkflowErrors,
  },
  runGuidedResearchSkillTurn: {
    method: "POST",
    path: "/research/guided-skill/turns",
    in: z.object({
      requestId: z.string().trim().min(1).max(200),
      message: z.string().trim().min(1).max(10_000),
      draft: GuidedResearchSkillDraft,
    }).strict(),
    out: GuidedResearchSkillTurnResponse,
    err: ["RESEARCH_WORKFLOW_UNAVAILABLE", "RESEARCH_NODE_STATE_INVALID"] as const,
  },
  getGuidedResearchWorkflow: {
    method: "GET",
    path: "/research/guided-sessions/:sessionId/workflow",
    in: z.object({ sessionId: z.string().min(1) }).strict(),
    out: GuidedResearchWorkflowProjection,
    err: ["RESEARCH_NOT_FOUND", "RESEARCH_WORKFLOW_UNAVAILABLE"] as const,
  },
  getGuidedResearchNode: {
    method: "GET",
    path: "/research/guided-sessions/:sessionId/workflow/nodes/:node",
    in: z.object({ sessionId: z.string().min(1), node: ResearchNode }).strict(),
    out: z.object({
      sessionId: z.string(),
      node: ResearchNode,
      graphVersion: z.number().int().nonnegative(),
      revision: z.number().int().positive(),
      nodeState: z.union([
        BriefNodeInputState,
        DirectionsNodeInputState,
        OutlineNodeInputState,
        ResearchNodeInputState,
        ReportNodeInputState,
      ]),
      nodeMeta: GuidedResearchNodeMeta,
    }).strict(),
    err: ["RESEARCH_NOT_FOUND", "RESEARCH_NODE_LOCKED", "RESEARCH_WORKFLOW_UNAVAILABLE"] as const,
  },
  executeGuidedResearchNode: {
    method: "POST",
    path: "/research/guided-sessions/:sessionId/workflow/nodes/:node",
    in: GuidedResearchNodeCommand,
    out: GuidedResearchWorkflowProjection,
    err: guidedWorkflowErrors,
  },
  listGuidedResearchEvents: {
    method: "GET",
    path: "/research/guided-sessions/:sessionId/workflow/events",
    in: z.object({
      sessionId: z.string().min(1),
      after: z.number().int().nonnegative().default(0),
    }).strict(),
    out: z.object({
      events: z.array(z.object({
        cursor: z.number().int().positive(),
        node: ResearchNode,
        type: z.string().min(1),
        createdAt: z.string(),
      }).strict()),
      nextCursor: z.number().int().nonnegative(),
    }).strict(),
    err: ["RESEARCH_NOT_FOUND", "RESEARCH_WORKFLOW_UNAVAILABLE"] as const,
  },
  appendGuidedResearchSkillMessage: {
    method: "POST",
    path: "/research/guided-sessions/:sessionId/skill/messages",
    in: z.object({
      sessionId: z.string().min(1),
      node: ResearchNode,
      requestId: z.string().trim().min(1).max(200),
      message: z.string().trim().min(1).max(10_000),
    }).strict(),
    out: z.object({
      messageId: z.string(),
      skill: GuidedResearchSkillProjection,
    }).strict(),
    err: ["RESEARCH_NOT_FOUND", "RESEARCH_WORKFLOW_UNAVAILABLE", "RESEARCH_NODE_MISMATCH"] as const,
  },
  createGuidedResearchSession: {
    method: "POST",
    path: "/research/guided-sessions",
    in: z.object({
      title: z.string().trim().min(1).max(100),
      tags: z.array(z.string().trim().min(1).max(20)).max(5)
        .refine((tags) => new Set(tags).size === tags.length, "research tags must be unique")
        .default([]),
      idempotencyKey: z.string().trim().min(1).max(200),
      collaboratorUserIds: z.array(z.string().trim().min(1)).max(50)
        .refine((ids) => new Set(ids).size === ids.length, "collaborator ids must be unique")
        .default([]),
      brief: GuidedResearchBrief,
    }).strict(),
    out: GuidedResearchSession,
    err: ["INVALID_RESEARCH_COLLABORATOR", "RESEARCH_CREATE_REPLAY_MISMATCH"] as const,
  },
  listGuidedResearchSessions: {
    method: "GET",
    path: "/research/guided-sessions",
    in: z.object({}).strict(),
    out: z.object({ items: z.array(GuidedResearchSession) }).strict(),
    err: [] as const,
  },
  getGuidedResearchSession: {
    method: "GET",
    path: "/research/guided-sessions/:sessionId",
    in: z.object({ sessionId: z.string().min(1) }).strict(),
    out: GuidedResearchSession,
    err: ["RESEARCH_NOT_FOUND"] as const,
  },
  confirmResearchBrief: {
    method: "PUT",
    path: "/research/guided-sessions/:sessionId/brief",
    in: z.object({
      sessionId: z.string().min(1),
      briefVersion: z.number().int().positive(),
      brief: GuidedResearchBrief,
    }).strict(),
    out: GuidedResearchSession,
    err: ["RESEARCH_NOT_FOUND", "RESEARCH_CHECKPOINT_CONFLICT"] as const,
  },
  generateResearchDirections: {
    method: "POST", path: "/research/guided-sessions/:sessionId/directions/generate",
    in: z.object({ sessionId: z.string().min(1) }).strict(), out: GuidedResearchSession,
    err: ["RESEARCH_NOT_FOUND", "RESEARCH_STAGE_CONFLICT"] as const,
  },
  confirmResearchDirections: {
    method: "PUT", path: "/research/guided-sessions/:sessionId/directions",
    in: z.object({
      sessionId: z.string().min(1), candidateVersion: z.number().int().positive(),
      directions: z.array(GuidedResearchDirection).min(1)
        .refine((items) => items.some((item) => item.enabled), "at least one direction must be enabled"),
    }).strict(), out: GuidedResearchSession,
    err: ["RESEARCH_NOT_FOUND", "RESEARCH_CHECKPOINT_CONFLICT", "RESEARCH_STAGE_CONFLICT"] as const,
  },
  generateResearchOutline: {
    method: "POST", path: "/research/guided-sessions/:sessionId/outline/generate",
    in: z.object({ sessionId: z.string().min(1) }).strict(), out: GuidedResearchSession,
    err: ["RESEARCH_NOT_FOUND", "RESEARCH_DIRECTIONS_NOT_CONFIRMED", "RESEARCH_STAGE_CONFLICT"] as const,
  },
  confirmResearchOutline: {
    method: "PUT", path: "/research/guided-sessions/:sessionId/outline",
    in: z.object({
      sessionId: z.string().min(1), candidateVersion: z.number().int().positive(),
      outline: z.array(GuidedResearchOutlineSection).min(1)
        .refine((items) => items.some((item) => item.enabled && item.title.trim().length > 0), "at least one outline section must be enabled"),
    }).strict(), out: GuidedResearchSession,
    err: ["RESEARCH_NOT_FOUND", "RESEARCH_CHECKPOINT_CONFLICT", "RESEARCH_STAGE_CONFLICT"] as const,
  },
  finishGuidedResearchCollection: {
    method: "POST",
    path: "/research/guided-sessions/:sessionId/researching/complete",
    in: z.object({
      sessionId: z.string().min(1),
      sourceCount: z.number().int().min(0).max(10_000),
    }).strict(),
    out: GuidedResearchSession,
    err: ["RESEARCH_NOT_FOUND", "RESEARCH_STAGE_CONFLICT"] as const,
  },
  completeGuidedResearchSession: {
    method: "POST",
    path: "/research/guided-sessions/:sessionId/complete",
    in: z.object({ sessionId: z.string().min(1) }).strict(),
    out: GuidedResearchSession,
    err: ["RESEARCH_NOT_FOUND", "RESEARCH_STAGE_CONFLICT"] as const,
  },
  /**
   * `CreateResearch`（`usecases.md` 1.1 / `uc-24-1` R3）—— 七项配置一次固化（**N-12**）
   *
   * ## ⚠ 即便 Scout 不可用也必须创建成功（`uc-24-1` E1）
   * 因此 `MODEL_UNAVAILABLE` **不在本操作的 `err` 里**——它属 `runResearch`。
   * 「不得因为跑不动就丢弃用户填的七项配置」这条要求，落成契约就是**这个 `err` 里没有它**。
   * 反过来说：谁把 `MODEL_UNAVAILABLE` 加进这里，E1 就当场破了。
   *
   * ## 刻意没有的东西
   * · **没有草稿**（Q-4 未裁；原型的 `×` 直接 `modal:null`，未见草稿保存）
   * · **没有模板参数**（Q-4；`itv` 有访谈模板、`survey` 有问卷模板，研究没有——
   *   「模板层被砍中段」是本轮查出两次的形状，**但不能因此就发明一个**）
   * · **没有幂等键**（`uc-24-1` 未提出该要求，本束不替它编一个）
   */
  createResearch: {
    method: "POST",
    path: "/research",
    in: z
      .object({
        /** `null` = Studio 独立发起 */
        projectRef: z.string().nullable(),
        config: ResearchConfig,
      })
      .strict(),
    out: Research,
    /**
     * ⚠ 刻意**没有** `VALIDATION_FAILED`：`usecases.md` 1.1 提到它，
     *   但零节的失败枚举里**没有它**，且全仓没有第二个束声明这种码
     *   （入参校验由全局 ValidationPipe 统一处理）。见 `KNOWN_CONTRACT_GAPS.R6`。
     *   `question` 的非空由上方 `.min(1)` 表达——那是**契约面**的表达，不是一个域错误码。
     */
    err: ["NO_PROJECT_ROLE", "PROJECT_ROLE_INSUFFICIENT"] as const,
  },

  /**
   * `RunResearch` / `RetryResearch`（`usecases.md` 1.2）—— **同一个操作**
   *
   * `usecases.md` 在同一节标题下只给了**一个签名** `RunResearch(id) -> ResearchRun`。
   * ⇒ 重试 = 再调一次本操作，**不另开路由**。
   * ⚠ 不另开的理由与 `project.addProjectMember` 的两入口同源：
   *   另开一个接口意味着「来源 ⊆ sourcePrefs」这条不变量要写两遍，
   *   **漏掉的那一遍不会有任何东西报警**。
   *
   * ## 后置条件里最关键的一条
   * **部分完成的结果必须可见**（`uc-24-2` E1）——载体是 `out` 的
   * `plannedRoutes` / `completedRoutes` / `failedRoutes` 三件。
   * ⚠ 只返回一个 `success: boolean` 的实现会让「3 路挂了 9 路成了」和「全挂」
   *   在响应里长得一样，而 V5（24-2 R12.5）要断言的正是这两者的区别。
   */
  runResearch: {
    method: "POST",
    path: "/research/:researchId/run",
    in: z.object({ researchId: z.string() }).strict(),
    out: ResearchRun,
    err: [
      "MODEL_UNAVAILABLE",
      "AGENT_RUN_FAILED",
      "SOURCE_PREF_VIOLATION",
      "RESEARCH_ARCHIVED",
      "NO_PROJECT_ROLE",
      "PROJECT_ROLE_INSUFFICIENT",
    ] as const,
  },

  /**
   * `AskFollowUp`（`usecases.md` 1.3 / `uc-24-2` A1）—— 追问，可指定补哪一类来源
   *
   * ⚠ **消息本体复用 `chat` 束**（X-H，已签核）：本操作**不起第二套对话模型**，
   *   只管「这条追问属于哪个研究、要补哪类来源」。
   * ⚠ **A1 的硬要求**：要补的类别不在 `sourcePrefs` 内时**提示需要先改配置，
   *   而不是静默越界**（R7.1）⇒ `SOURCE_PREF_VIOLATION`，不是悄悄放行。
   * ⚠ 每次追问**重算**段 ①–④ 而不是追加（`uc-24-2` R3.8）；
   *   已入库洞察是否跟随更新 → Q-6 未裁，本操作**不声明**它对已入库对象的影响。
   */
  askFollowUp: {
    method: "POST",
    path: "/research/:researchId/follow-ups",
    in: z
      .object({
        researchId: z.string(),
        text: z.string().min(1),
        /** `null` = 纯追问，不指定补来源类别 */
        wantSourceKind: SourceKind.nullable(),
      })
      .strict(),
    out: ResearchRun,
    err: [
      "SOURCE_PREF_VIOLATION",
      "AGENT_RUN_FAILED",
      "RESEARCH_ARCHIVED",
      "NO_PROJECT_ROLE",
      "PROJECT_ROLE_INSUFFICIENT",
    ] as const,
  },

  /**
   * `PromoteConclusionToInsight`（`usecases.md` 1.4）—— **本束最关键的操作**
   *
   * ## 三道门槛（**N-1 / N-2 / N-5**），三条全过才放行
   *   ① 结论挂 ≥1 条**外部来源** → `NO_EXTERNAL_SOURCE`
   *   ② 结论**不在**「争议 / 不确定」段 → `EVIDENCE_IS_DISPUTED`
   *   ③ 若涉冲突，该冲突**已由人判定** → `CONFLICT_PENDING_HUMAN`
   * ⚠ 三个码**必须分开**：它们对应三条**不同的补救路径**（补来源 / 改判定 / 等人判）。
   *   合并成一个 `PROMOTE_BLOCKED` 会让用户走错路。
   * ⚠ 断言必须打在**行为**上（入库未发生），**不是**打在按钮的 `disabled` 属性上
   *   （`uc-24-4` R12.1 逐字）——灰按钮在 API 层挡不住任何东西。
   *
   * ## 双返回 = 部分成功（**本束唯一**）
   * `insight` 成功 + `nodeBackflow` 可能失败。**禁止乐观 UI**（`uc-24-4` R9）：
   * 下游不可用时**不得**显示已入库。
   * ⚠ 做成单一 `Result` 会导致前端在 `DECISION_NODE_GONE` 时**回滚一次已成功的入库**。
   *
   * ## 刻意没有的东西
   * · **重复入库的语义**（幂等 / 报错 / 新建一条）—— Q-15 未裁，本操作不设对应码
   * · **`SendToSynthesisStudio` 这个下游出口** —— Q-11 / X-D，见 `PENDING_PORTS`
   */
  promoteConclusionToInsight: {
    method: "POST",
    path: "/research-conclusions/:conclusionId/promote",
    in: z.object({ conclusionId: z.string() }).strict(),
    out: z
      .object({
        /** **N-11**：产出的是**候选**洞察，不是已采信结论 */
        insight: CandidateInsight,
        /**
         * 决策节点回流结果。
         * ⚠ `ok: true` 且 `reason: null` = 回流成功；
         *   `ok: false` 且 `reason: "DECISION_NODE_GONE"` = **入库已成、回流失败**（E2）；
         *   `ok: true` 且 `attempted: false` = A1 合法路径（配置里选了「不挂节点」）——
         *   **这是合法路径，不是降级**，所以它不是一个失败。
         * ⚠ 三种情况必须可区分：只给一个布尔的话，「没挂节点」和「挂了但挂失败了」一样。
         */
        nodeBackflow: z
          .object({
            attempted: z.boolean(),
            ok: z.boolean(),
            reason: z.literal("DECISION_NODE_GONE").nullable(),
          })
          .strict(),
      })
      .strict(),
    err: [
      "NO_EXTERNAL_SOURCE",
      "EVIDENCE_IS_DISPUTED",
      "CONFLICT_PENDING_HUMAN",
      "QUOTE_REVOKED",
      "RESEARCH_ARCHIVED",
      "NO_PROJECT_ROLE",
      "PROJECT_ROLE_INSUFFICIENT",
    ] as const,
  },

  /**
   * `ResolveConflict`（`usecases.md` 1.5 / `uc-24-5` R3.6）
   *
   * ⚠ **N-6：`以样本为准` 不得由系统预选，也不得倒计时自动执行。**
   *   契约面的表达是：本操作**必须**带 `actorUserId`，且 `ResearchConflict`
   *   里没有任何 `suggestedAction` 字段。没有人，就没有判定。
   * ⚠ **N-9 / R6：处置留痕（谁 / 何时 / 选了哪一条），不可静默删除。**
   * ⚠ **`上台讨论` 的后果 Q-18 未裁**——本操作接收该值，但**不实现后果**。
   *   接收 ≠ 实现：三个动作都要能被记录，否则「引导师选了上台讨论」这件事本身会丢。
   * ⚠ 组长能否判定 → **Q-14 未裁**，本契约**不设角色分支**，只保留 `PROJECT_ROLE_INSUFFICIENT`。
   * ⚠ 已判定的冲突在出现新证据后是否重开 → Q-19 未裁，本操作不表达重开。
   */
  resolveConflict: {
    method: "POST",
    path: "/research-conflicts/:conflictId/resolve",
    in: z
      .object({
        conflictId: z.string(),
        action: ConflictAction,
      })
      .strict(),
    out: ResearchConflict,
    err: ["NO_PROJECT_ROLE", "PROJECT_ROLE_INSUFFICIENT", "RESEARCH_ARCHIVED"] as const,
  },

  /**
   * `ArchiveResearch`（`usecases.md` 1.6 / **N-7**）
   *
   * ⚠ **归档不是删除**：被引用的证据在归档后**不失效**，归档后**仍可检索**
   *   （`uc-24-3` R7.3 / V4）。只断言「列表里筛得到」的实现会漏掉后半条。
   * ⚠ **本操作没有反向的 `unarchive`**：`uc-24-3` R3.B.4 只给了归档一侧，
   *   原型的标签筛选里 `已归档` 是一个筛选项而非一个可切换的开关。
   *   **不照抄 `project.unarchiveProject`**——那束的可逆性是 U-2⑴ 裁出来的，
   *   本束没有对应裁决。→ `KNOWN_CONTRACT_GAPS.R5`
   */
  archiveResearch: {
    method: "POST",
    path: "/research/:researchId/archive",
    in: z.object({ researchId: z.string() }).strict(),
    out: Research,
    err: ["NO_PROJECT_ROLE", "PROJECT_ROLE_INSUFFICIENT", "RESEARCH_ARCHIVED"] as const,
  },

  /**
   * `PinResearch`（`usecases.md` 1.7）—— 列表里的 `关键 · 置顶`
   *
   * ⚠ 与结论区的「标为关键问题」按钮是否同一动作 → **Q-13 未裁**，
   *   在裁定前**本操作与那个按钮不合并**。合并了再拆比现在多一条迁移。
   */
  pinResearch: {
    method: "POST",
    path: "/research/:researchId/pin",
    in: z.object({ researchId: z.string(), pinned: z.boolean() }).strict(),
    out: Research,
    err: ["NO_PROJECT_ROLE", "PROJECT_ROLE_INSUFFICIENT", "RESEARCH_ARCHIVED"] as const,
  },

  /**
   * `ListResearch`（`usecases.md` 二节 / `uc-24-3` R3.A/B/C）
   *
   * ⚠ **可见性在数据层过滤**（`uc-24-3` E5 / V5）：未共享的研究
   *   **不在返回的数据里**，不是「界面上没渲染」。渲染层隐藏在 API 层挡不住任何东西。
   * ⚠ 计数是**派生值**：**不许**接受一个 `count` 入参然后原样回显——
   *   那是本仓已确认的「假数据穿透」形状（`asset-governance/coverage.md` 第 5 条同型）。
   * ⚠ 标签筛选首项两处不同（`全部` vs `全部标签`）→ Q-9 未裁，
   *   ⇒ `tag` 是 `nullable` 而不是一个带首项的枚举——**首项是界面的事**。
   */
  listResearch: {
    method: "GET",
    path: "/research",
    in: z
      .object({
        /** `null` = Studio 全域；非空 = 某项目内的深度研究列表 */
        projectRef: z.string().nullable(),
        tag: z.string().nullable(),
        /** `null` = 不按归档状态过滤（即两者都要） */
        archived: z.boolean().nullable(),
        /** `"all"` = 全场共用 + 全部组；否则只看该组 */
        groupScope: z.union([z.string(), z.literal("all")]),
      })
      .strict(),
    out: z
      .object({
        items: z.array(Research),
        /** ⚠ **派生自 `items` 的同一次查询**，不是入参回显 */
        total: z.number().int().nonnegative(),
      })
      .strict(),
    err: ["NO_PROJECT_ROLE"] as const,
  },

  /**
   * `GetResearchPlan`（`usecases.md` 二节 / `uc-24-3` R3.D）—— 三计数 + 证据表
   *
   * ⚠ **N-8：计数是派生值，缺失返回 `null` 而非 `0`。**
   *   `evidenceTarget: null` 让界面渲染 `证据 41 / —`；返回 0 会让人读成
   *   「目标 0，已超额完成」。这是本操作**最容易做错**的一处（V3 / 24-3 R12.3）。
   * ⚠ 三计数的三条注脚各指一个**跨域依赖**：`来自项目环节 2 的假设`（X-A，`project` 未签核）、
   *   `含 6 条访谈引述`（X-C，`interview` 已签核）、`待送综合 Studio 验证`（X-D / Q-11）。
   *   ⇒ 本操作**只返回数**，注脚文案不进契约（它们是三个别束的事实）。
   */
  getResearchPlan: {
    method: "GET",
    path: "/research/:researchId/plan",
    in: z.object({ researchId: z.string() }).strict(),
    out: z
      .object({
        researchId: z.string(),
        /**
         * 研究问题数。
         * ⚠ **Q-8 未裁**：两层模型下它是子实体计数，一层模型下它没有对象。
         *   ⇒ `nullable`，且 `null` 与 `0` **必须可区分**（N-8 的同一条理由）。
         */
        questionCount: z.number().int().nonnegative().nullable(),
        evidenceCount: z.number().int().nonnegative().nullable(),
        /** ⚠ **N-8 的主战场**：目标缺失是 `null`，界面渲染 `—`，**不是** `0` */
        evidenceTarget: z.number().int().nonnegative().nullable(),
        candidateInsightCount: z.number().int().nonnegative().nullable(),
        /** 证据表（按研究问题分组的展示由界面做；契约只给平铺的行 + 分组键） */
        evidence: z.array(Evidence),
      })
      .strict(),
    err: ["NO_PROJECT_ROLE", "SOURCE_OUT_OF_SCOPE"] as const,
  },

  /**
   * `GetResearchDetail`（`usecases.md` 二节 / `uc-24-2` R3）—— 对话轮 + 四段结果
   *
   * ⚠ **N-3：段 ③ 低置信不得过滤。** 契约面的表达是：
   *   **本操作没有任何 `minConfidence` / `hideLowConfidence` 参数**。
   *   加一个就是给「丢弃」开了一道门，而 `res.goal` 逐字是
   *   「低置信度**必须标出而不是丢弃**」`[原型 @16,781,061B]`。
   * ⚠ 段 ③ 对观察者按 **X-B** 脱敏：来自 `本场转写` 的行，观察者只能看到
   *   「来自本场转写」这一事实与置信度，**读不到原文引述** ⇒ `SOURCE_OUT_OF_SCOPE`。
   *   ⚠ 判定属 `recording`（已签核，可见性的单一事实源），本束只投影。
   */
  getResearchDetail: {
    method: "GET",
    path: "/research/:researchId",
    in: z.object({ researchId: z.string() }).strict(),
    out: z
      .object({
        research: Research,
        /** n 轮对话的执行步骤枚举。⚠ 消息本体在 `chat` 束（X-H），这里只有 run */
        runs: z.array(ResearchRun),
        result: ResearchResult,
      })
      .strict(),
    err: ["NO_PROJECT_ROLE", "SOURCE_OUT_OF_SCOPE"] as const,
  },

  /**
   * `ListLiveResearchTasks`（`usecases.md` 二节 / `uc-24-5` R3.2–3.3）
   *
   * ⚠ **`onlyConflicts` 的判据取 `conflicts > 0` 而非状态词**（A1 逐字）——
   *   状态枚举尚未收敛（Q-10），按词过滤会在 Q-10 裁完后整条失效。
   * ⚠ **A2：冲突为 0 时冲突区仍然渲染空态，不隐藏整个区块**——
   *   隐藏会让引导师以为这个能力不存在。契约面的表达是 `conflicts` 恒返回（可为 0）。
   * ⚠ 第三列在无冲突时显示来源数、有冲突时显示冲突数（**同一列两种语义**）→ Q-17 未裁
   *   ⇒ 契约**两个数都给**，由界面决定显示哪个。**不在契约里做那个二选一**。
   * ⚠ 刷新率**无出处**（Q-20：原型只在知识图谱屏给了「每 15 秒」，那不是本域的数）
   *   ⇒ 契约里**没有任何轮询间隔**。
   */
  listLiveResearchTasks: {
    method: "GET",
    path: "/projects/:projectId/live-research-tasks",
    in: z
      .object({
        projectId: z.string(),
        onlyConflicts: z.boolean(),
      })
      .strict(),
    out: z
      .object({
        tasks: z.array(
          z
            .object({
              researchId: z.string(),
              /** `12:31` 这一列 */
              at: z.string(),
              question: z.string(),
              /** **N-9**：`第 2 组提出` / `引导师提出` —— 提出方必须留痕 */
              proposedBy: z.string(),
              /** ⚠ **值域未定**（Q-10）：现场侧三值 `运行中 / 已就绪 / 待判定` */
              status: z.string(),
              /** ⚠ Q-17：与下一个字段**同列两义**，契约两个都给 */
              sourceCount: z.number().int().nonnegative(),
              conflictCount: z.number().int().nonnegative(),
            })
            .strict(),
        ),
        /** 头部「4 个 · 2 个已就绪」的两个数。⚠ **派生值**，不是入参回显 */
        total: z.number().int().nonnegative(),
        ready: z.number().int().nonnegative(),
        conflicts: z.number().int().nonnegative(),
      })
      .strict(),
    err: ["NO_PROJECT_ROLE", "PROJECT_ROLE_INSUFFICIENT"] as const,
  },

  /**
   * `ListConflicts`（`usecases.md` 二节 / `uc-24-5` R3.4–3.6）
   *
   * 🔴 **N-6 的主战场：返回的动作集合不带预选态。**
   *   `ResearchConflict.actions` 恒为三项全集，且**没有** `suggested` / `default` /
   *   `countdownSeconds` 任何一个字段。
   * ⚠ 断言要打在**性质**上（三项都不是预选/自动执行），不是 `toHaveLength(3)`
   *   ——长度断言在「删一个加一个」时全绿（coding-standards E-4 / 纪律第 9 条）。
   */
  listConflicts: {
    method: "GET",
    path: "/projects/:projectId/research-conflicts",
    in: z.object({ projectId: z.string() }).strict(),
    out: z
      .object({
        conflicts: z.array(ResearchConflict),
        /** ⚠ **派生值**。A2：为 0 时界面仍渲染空态，不隐藏区块 */
        pending: z.number().int().nonnegative(),
      })
      .strict(),
    err: ["NO_PROJECT_ROLE", "PROJECT_ROLE_INSUFFICIENT"] as const,
  },
} as const;

/**
 * **随裁决增删的端口（`usecases.md` 第三节）—— 现在不写签名，但必须有名字。**
 *
 * 这一节存在的意义逐字照抄 `usecases.md`：
 * 「让**还没定的接口**有名字、可见、会在复核里被问到，
 *  而不是等实现者写代码时顺手创造出来」（ADR-020 的立论）。
 *
 * ⚠ 它们**不参与** `coverage.md` 的 API→UC 反向检查——它们现在还不是端口，
 *   是**登记在案的未定项**。
 */
export const PENDING_PORTS = [
  {
    port: "CreateResearchQuestion / ListQuestions",
    blockedBy: "Q-8",
    why: "裁 B（两层）才存在；裁 A 则塌缩进 createResearch。实体层数未定时把端口写满 = 把未定的范围伪装成已定",
  },
  {
    port: "SaveResearchDraft",
    blockedBy: "Q-4",
    why: "原型弹层的 × 直接 modal:null，未见草稿保存；而 23-asset 三步向导有「草稿自动保存 · 14:52」。两边不同型，不能互相推定",
  },
  {
    port: "CopyResearch",
    blockedBy: "Q-4",
    why: "uc-24-3 A3 的 copyDrItem 提示逐字「已复制为新的深度研究」，但「只复制七项配置、不复制对话与结论」是 [设计] 不是原型出处。usecases.md 1.6 逐字「Q-4 未裁前不实现」",
  },
  {
    port: "ListResearchTemplates / ApplyTemplate",
    blockedBy: "Q-4",
    why: "itv 有访谈模板、survey 有问卷模板、研究没有。「模板层被砍中段」是本轮查出两次的形状，**但不能因此就发明一个**",
  },
  {
    port: "EscalateConflictToAgenda",
    blockedBy: "Q-18",
    why: "「上台讨论」把冲突升级成什么（议程讨论项 / 待办 / 决策节点 / 仅标记）原型只给按钮没给去向。resolveConflict 接收该值但不实现后果",
  },
  {
    port: "SendToSynthesisStudio",
    blockedBy: "Q-11 / X-D",
    why: "🔴 apps/web/lib/mock/itv.ts:888 的 INSIGHT_REPORT_EXPORTS 里**已经有**「送入综合 Studio」这个动作，而「综合 Studio」在任何 phase 都不存在，且 interview 束**已由人类签核**。⇒ 一个已签核的束里已有一个通往未定义目的地的出口。裁定前**两边都不实现**",
  },
] as const;

/**
 * 本束写作时撞到的契约缺口，逐条登记在契约自己身上。
 *
 * 放在这里而不是放在某个 report 里：report 会随着会话结束消失，
 * 而下一个动这份契约的人一定会打开这个文件。
 *
 * ⚠ 这不是 TODO 列表，是**需要人类签核才能补**的东西
 * （`design-signoff.md` 的 `status` 只能由人类改，agent 不许动）。
 */
export const KNOWN_CONTRACT_GAPS = {
  /**
   * 🔴 **`usecases.md` 零节「复用（不新建）」五条里，四条的出处不成立。**
   * 机械核过（`grep -rE '"(FORBIDDEN_ROLE|AGENT_RUN_FAILED|QUOTE_REVOKED|SOURCE_OUT_OF_SCOPE)"'
   * packages/contracts/src` **零命中**）：
   *   · `FORBIDDEN_ROLE`（称来自 project / org-admin）—— **全仓不存在**。
   *     本文件改用真实存在的 `NO_PROJECT_ROLE` / `PROJECT_ROLE_INSUFFICIENT`（identity 单一事实源）。
   *   · `MODEL_UNAVAILABLE`（称来自 agent-runtime）—— 存在，**但在 `skills.SkillError` 里**。
   *     归属写错的后果不是文档瑕疵：它会让人去改错的束。
   *   · `AGENT_RUN_FAILED`（称来自 agent-runtime）—— 不存在；最近的是 `AGENT_DEPENDENCY_FAILED`，语义不同。
   *   · `QUOTE_REVOKED`（称来自 interview）—— 不存在；那束有的是 `WITHDRAWAL_IN_PROGRESS` / `ERASURE_NOT_COMPLETE`。
   *   · `SOURCE_OUT_OF_SCOPE`（称来自 recording）—— 不存在。
   * ⇒ 后三条由**本文件第一次声明**。若签核人认为某一条应当归对方束，
   *   那是**修订已签核束**，不是本束能做的（先例：project 束的 `ORG_ROLE_INSUFFICIENT`）。
   */
  R1: "usecases.md section 0 claims 5 error codes are REUSED from signed bundles; 4 of the 5 claims are false (FORBIDDEN_ROLE/AGENT_RUN_FAILED/QUOTE_REVOKED/SOURCE_OUT_OF_SCOPE do not exist anywhere; MODEL_UNAVAILABLE exists but in skills, not agent-runtime). Three are FIRST DECLARED here",
  /**
   * **深度档位的两串文案，哪一串是权威未定（Q-1）。**
   * `nrDepths[].note`（`8 分钟 · 3 路 · 只要方向`）与 `DEPTH_L`（`8 分钟 · 3 路检索`）
   * 在原型里是两个常量。本契约只落枚举键 `fast/std/deep`，**一串文案都不落**。
   * ⚠ 不落是结论：落了就是第三份副本，而预览句（`uc-24-1` R3.3）要用其中一串拼接。
   */
  R2: "Q-1 unruled: the depth tier has two different prototype strings (nrDepths[].note vs DEPTH_L); this contract deliberately carries neither, only the enum keys",
  /**
   * 🔴 **X-E：与已签核的 `files` / `artifact` 束对不齐，且是本束不能单方面修的。**
   * `files/domain.md:178` 要求八值来源枚举与「研究 Studio 的产出侧」一致。三方核对：
   * 已签核的 `artifact.ArtifactSource` 用 **`research-run`**；
   * 界面侧 `apps/web/lib/mock/files.ts` 的 `SourceType` 与本束的 X-E 描述都用 **`research`**。
   * ⇒ **两票 `research` 对一票 `research-run`，而那一票是已签核的那一票。**
   * 修法二选一，**都要人点头**：
   *   (a) `artifact`（已签核）改名 `research-run` → `research`——动已签核束；
   *   (b) 界面侧与本束改用 `research-run`——动两处，且 `files.ts` 的
   *       `SOURCE_TYPE_VOCABULARY_DISPUTED` 还并列着 `workshop` / `canvas` / `prototype-run`
   *       三个更大的分歧，单独对齐 research 这一项**解决不了那张表**。
   * ⇒ 本文件的处置：`RESEARCH_ARTIFACT_SOURCE` 把「已签核侧的字面量是 research-run」
   *   钉成编译期事实（对方改名则 tsc 红），差异本身登记在这里，**不擅自选边**。
   */
  R3: "X-E MISALIGNED: files/domain.md:178 requires the source-type enum to match the research Studio output side; the SIGNED artifact.ArtifactSource says `research-run` while the UI SourceType and this bundle's X-E both say `research`. Aligning either way is a signoff action (amend a signed bundle, or change two places), not an implementation choice",
  /**
   * **`sourcePrefs` 为空数组的语义未定（Q-5）。**
   * 三个候选：等价于全选 / 拒绝创建 / 至少保留一项不可取消。原型未给。
   * ⇒ `ResearchConfig.sourcePrefs` **刻意没有 `.min(1)`**：加上就是替 Q-5 裁了「拒绝创建」。
   * ⚠ 后果：N-4（检索来源 ⊆ sourcePrefs）在空数组上的语义也随之未定
   *   （⊆ 空集 = 什么都不许检索？还是不限制？）。**这条要和 Q-5 一起裁。**
   */
  R4: "Q-5 unruled: empty sourcePrefs could mean select-all / reject-creation / keep-at-least-one. The contract carries no .min(1) so as not to pre-rule it; N-4's meaning on an empty set is undefined as a consequence",
  /**
   * **归档是否可逆，本束无出处。**
   * `uc-24-3` R3.B.4 只给了归档一侧；原型的 `已归档` 是筛选标签而非可切换开关。
   * ⇒ 本束**没有** `unarchiveResearch`。
   * ⚠ 刻意**不照抄** `project.unarchiveProject`：那束的可逆性是 U-2⑴ 裁出来的，
   *   本束没有对应裁决。**照抄一个别束的裁决结论，就是把它的出处偷渡成本束的出处。**
   */
  R5: "No source for whether archiving is reversible in this bundle; project.unarchiveProject exists only because U-2(1) ruled it. Deliberately not copied",
  /**
   * **`VALIDATION_FAILED` 出现在 `usecases.md` 1.1，却不在零节的失败枚举里。**
   * 零节自称是「统一失败枚举」，两处对不上。且全仓没有第二个束声明这种码
   * （入参校验由全局 ValidationPipe 统一处理，ADR-020）。
   * ⇒ 本文件**不声明它**，`question` 的非空由 `.min(1)` 在契约面表达。
   * ⚠ 若签核人认为域内需要一个可读的校验失败码，那是给零节加一条，需要重新签 ②。
   */
  R6: "VALIDATION_FAILED appears in usecases.md 1.1 but is absent from section 0's 'unified failure enum'; no other bundle declares such a code (global ValidationPipe owns input validation). Not declared here",
  /**
   * **Q-8（一层还是两层）未裁 ⇒ `ResearchQuestion` 实体不存在于本契约。**
   * `getResearchPlan.out.questionCount` 因此是 `nullable`——
   * 一层模型下它没有对象可数，`null` 与 `0` 必须可区分（N-8 同理）。
   * ⚠ 裁 B（两层，`usecases.md` 的推荐）之后要新增两个端口 + 一个实体，
   *   那是**签核后新增**，需要重新签核；本文件不预建。
   */
  R7: "Q-8 unruled (one entity layer or two): ResearchQuestion is deliberately not modeled; questionCount is nullable because under a one-layer model there is nothing to count",
  /**
   * **`status` / `disposition` / 来源类别简称三个值域未定（Q-10 / Q-12 / Q-7）。**
   * 三处都写成 `z.string()` + 一个 `*_PENDING` 常量。
   * ⚠ **这个宽松是待裁标记，不是设计**（形状照 `files.ts` 的 `sourceType`）。
   * ⚠ 后果是可断言性：涉及这三者的 R12 线索（24-3/1、24-3/7、24-5/1、24-5/2、24-2/8）
   *   现在**写不成机械判据**——它们在 `coverage.md` 里逐行具名。
   */
  R8: "Q-10 / Q-12 / Q-7 unruled: research status, evidence disposition, and the source-kind shorthand mapping are all z.string() plus a *_PENDING constant; five R12 clues cannot become mechanical assertions until they are ruled",
} as const;
