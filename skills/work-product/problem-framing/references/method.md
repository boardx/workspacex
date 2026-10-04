# S064 1.1.0 可执行方法

来源：WorkspaceX 已作者化 S064 文档，缓存提交 `ddddbec4292648eb90b1cd23d514e73290a29b05`（#4552）。以下专业步骤与失败模式为该文对应章节的恢复；其中示例只展示方法，不是本次任务的事实、引语、目标或阈值。

## 真实性前置检查

先分开列出：当前输入明确提供的事实、可解析的已有研究 finding、调用方声明、尚未验证的假设和未知项。只使用当前任务与可见同实例的 prior，不使用其他角色或历史线程的内容补全本任务。

- 不得生成受访者引语。只有当前输入或可见来源包含的逐字文本才可引用，并标明来源；没有逐字材料就写“未提供原文”。
- 不得杜撰人群、子组计数、重叠人数、样本代表性、时间窗口、因果、损失或成功目标。未知项保持 unknown，待验证的人群写假设。
- 调用方给出的访谈/问卷汇总数，只能归因于该输入，不能伪称已读取访谈原件。不同渠道重叠未知时不得相加成独立人数，比例必须保留对应分母。
- finding 引用、措辞上限和批准状态需要调用方提供可核实的服务端上下文；模型不能声称自行核验它没有读取的来源，也不能把用户输入的 ceiling 当成服务端已核实值。
- 所有以下例子均非任务证据；示例数字不能迁移到 actor.scale、困境、指标或结果。

## 4. 专业方法（S064 专属步骤）
### A. 入口识别
- **A0 入口分类。** 把输入归入以下五类之一：`feature-request | complaint | metric-signal | synthesis | vague-idea`。
  - `feature-request` 的判定：出现「做 / 加 / 上线 / 支持」这类构建动词，同时带有具体功能名词。
  - 分类结果写进 `intake.kind`。
  - 每类有不同的 A1 策略。
- **A1 解法剥离（针对 feature-request）。** 不拒绝请求，而是反推出它背后的 1–3 个候选问题，写进 `strippedSolution = { original, impliedProblems[] }`。
  - 原请求保留在 `strippedSolution.original`，它**不得**出现在 `statement` 中。
  - 例：「审批页加一键催办」→「审批发起人无法得知审批卡在谁手里」/「审批人不知道自己有待办」。
  - 如果能反推出多个问题，而输入里没有证据能区分它们，S064 不替用户挑选。此时返回 `status = "needs-choice"`，列出候选问题，由调用方或用户选定后再重入。见决策 2。

### B. 构造框定
- **B1 受影响者。** `actor` 必须是一个可识别的人群，由角色、情境、规模三部分组成，例如「月审批量 > 50 的部门主管」。不接受「用户」「大家」这类泛称。
- **B2 可观察困境。** `struggle` 用可观察的行为或结果来描述，例如「平均等待 3 天，期间反复私聊催问」，不能写成情绪或解法。
  - 每条困境描述标注 `grounding`：`evidence`（附 `findingIds`）或 `assumption`。
  - 标为 `evidence` 的，措辞不得超过对应 S063 Finding 的 `assertionCeiling`（字段取自已 PASS 的 S063 §6）。
- **B3 代价。** `costOfInaction` 从三个维度各写一句：用户侧、业务侧、合规或信任侧。无从判断的维度写 `unknown`，**不编造**。
- **B4 边界与负空间。** 写两份清单：
  - `inScope`：包含哪些人群、场景、渠道；
  - `outOfScope`：至少 2 条，每条附理由。

  负空间是 S064 区别于一句话陈述的关键，对应 lenny-skills :82「忽略 non-goals」这一反模式。
- **B5 结果信号与证伪条件。**
  - `outcomeSignals`：1–3 条可观察的变化方向，例如「发起人私聊催问次数下降」。**不写**目标数字、口径和公式，这些交给 S162。
  - `falsifiers`：至少 1 条，写明「如果观察到 X，说明这个问题不存在或不重要」。没有证伪条件的框定一律 `status = "too-broad"`。见决策 3。

### C. 压力测试
- **C1 宽窄检查。** 用两道判据检查陈述：
  - 太宽：`actor` 覆盖全部用户，**或** `falsifiers` 为空。
  - 太窄：`statement` 中含具体界面或功能名词。

  命中任一判据就回到 B 段修改，最多两轮。两轮后仍不通过的，如实返回 `too-broad` 或 `solution-in-disguise`。
- **C2 Five-Whys 上探一层。** 对 `struggle` 追问一次「为什么这会成为问题」，把更上一层的问题写进 `parentProblem`。这一层只用于提示框定层级，不替换当前陈述，由调用方决定是否上移。
- **C3 替代框定。** 至少给出 1 个 `alternativeFrames`，即对同一现象的另一种因果解释。例如：「催问多」可能是审批人不知道有待办，也可能是发起人不信任系统里显示的状态。

  每个替代框定写一条用来区分两者的 `discriminatingQuestion`，交给 S062 或 S009 去调研。
- **C4 未知项。** 所有 `assumption` 类型的困境描述、`unknown` 类型的代价，以及各个 `discriminatingQuestion`，汇总进 `openQuestions[]`，每条标出建议承接的 Skill（S062 或 S009）。

### D. 定稿
- **D1** `statement` 由 `actor + struggle + costOfInaction` 合成 2–3 句，并做两项检查：
  - 不含功能名词；
  - 措辞强度不超过所有引用 Finding 中最弱的那个 `assertionCeiling`。
- **D2** 输出一份草稿 `ProblemFrame`（`status = draft`）。在 Workflow 中，由 W027 或 W029 的人工关卡把它转为 `accepted`，S064 自身不做这个转换。写入文档或画布，属于调用方另行发起的工具动作。


## 10. 失败模式（S064 特有）
| # | 失败 | 检测 | 处置 |
|---|---|---|---|
| F1 | 解法伪装：statement 里带着功能名 | 不变式 2 | 执行 A1 剥离，得出 needs-choice 或 solution-in-disguise |
| F2 | 泛人群：actor 写成「用户」 | actor.role 命中泛称表 | 退回 B1 |
| F3 | 证据夸大：一条访谈被写成「普遍」 | 不变式 3 | 降低措辞，或改标为 assumption |
| F4 | 不可证伪 | falsifiers 为空 | 返回 status = too-broad |
| F5 | 指标即问题：「DAU 降了」直接被当成问题 | intake = metric-signal，且 struggle 里没有任何人的行为 | 要求写出「谁的什么行为变了」；如果写不出来，就进入 openQuestions |
| F6 | 单一因果：只给一种解释 | alternativeFrames 为空 | 退回 C3 |
| F7 | 越界写 KPI：outcomeSignals 带目标数字 | 不变式 4 | 删除数字，在 handoff 中提示交给 S162 |
| F8 | 替用户选问题：多个候选问题都没有证据区分，却被默默选了一个 | impliedProblems ≥ 2，没有 evidence，但 status = draft | 改为 needs-choice |


## 调用边界与返回

直接调用：给出问题陈述、证据/假设区分、边界、证伪条件、替代框定及待回答问题；保留 needs-choice / too-broad / solution-in-disguise，不强行定稿。没有持久化工具回执时，不声称已保存、已创建 frameId 或已更新版本链。

W029 frame 阶段目前实际消费者为 `PrdFrameStageOutput`，要求 JSON 中的 `problemStatement`、`evidenceRefs`、`confidence`（low / medium / high）。这是当前接口的投影，不代表完整 ProblemFrame 检查器已接线：

- `problemStatement` 使用上述步骤形成的陈述；假设必须明示，不能用肯定语气补事实。
- `evidenceRefs` 只能填当前输入或同实例 prior 中实际存在的引用。没有引用时返回空数组，不生成看似真实的 ID、网址、文件或引语来满足下游非空检查。下游可能拒绝发布，这是缺证据的正确结果。
- `confidence` 不代替 S063 assertionCeiling；没有已验证证据时取 low，不对来源强度做虚假升级。
- 可附 `status`、`openQuestions` 等诊断，但当前消费者未强制执行完整状态契约。遇到需要选择或边界不明时必须在 problemStatement 中明示未定稿，不声称已获批准；工作流状态阻断仍须后续运行时改造。
- 只返回模型调用要求的 JSON 对象；不模拟工具、审批、artifact 或 publication 回执。

完整 ProblemFrame schema、frame 版本链、服务端 finding/ceiling 检查和 check-frame.mjs 是历史文档中的 proposed-unwired 项。本内容迭代没有实现它们。

## 输出前自查

对每个事实句找对应的当前输入或可见 finding；找不到则删去或改为明示假设。逐条检查引语、人数、分母、阈值与目标，不从示例或常识补齐。让读者能区分问题判断与证据，以及内容草稿与已保存/批准的产物。
