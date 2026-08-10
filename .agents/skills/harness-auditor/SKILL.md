---
name: harness-auditor
description: >
  激活条件：用户提到 评估 harness、审计系统、控制平面、harness 健康度、五子系统、
  控制变量实验、脚手架是否还需要 等关键词时触发。
  用五子系统给 harness 自身打分，跑承重测试，定位最弱子系统。
---

# Harness Auditor Skill（元层）

## 何时使用

要评估 harness 控制平面**自身**是否健康、是否过度工程时。这是元层 skill——
被审计的对象是 `.harness/` 本身，不是某个 feature。

> 这是「用 skill-creator 方法论维护的元层」。重活/写快照交给 **quality-auditor** subagent；
> 本 skill 提供评估框架。

---

## 能力清单（这个 skill 具体让你能做什么）
- **判定**：给五子系统各打 0-2 分、定位最弱子系统、决定改进从哪下手。
- **实验**：跑一次承重测试（临时移除一个脚手架 → 跑验证 → 判定承重与否 → 恢复），
  一次只改一个变量。
- **固定用例**：每次审计必跑门控绕过类事故模拟（手改 passing 不入库、status/owner/
  evidence 出现在 diff 中、verdict 越权三条），判定现有流程能否拦截。
- **产出**：打分表 + 最弱子系统 + 承重测试结论，交给 `quality-auditor` subagent 写入
  `.harness/state/quality-document.md`（本 skill 自己不写状态文件、不改 feature/
  实现代码——写权限边界在 subagent 那一层，不在这里）。

## 架构位置（你在整个协作系统里的坐标）
- **谁触发你**：人类主动要求"评估 harness 健康度"，或 architecture-coordinator 在
  职责范围第 4 条"harness 健康度审计"下定期复用你。你不是常驻角色，不挂 loop、
  不认领租约——是一次性/周期性被调用的评估框架。
- **你产出给谁用**：quality-auditor（落盘 `.harness/state/quality-document.md`）、
  architecture-coordinator（据此决定要不要开 ADR 或修订协议文档）、人类（决定是否
  该给 harness"减脂"或"加固某个门"）。
- **依赖的下游服务**：`pnpm harness verify`（承重测试的验证手段）、
  `phases/<phase>/feature_list.json`（权威来源）与各 sprint 派生的
  `active-features.json`（状态子系统的审计对象）、`.harness/scripts/*`
  （脚本子系统的审计对象）。你本身**不依赖**协调服务（D1）——审计的是控制
  平面本身的健康度，不是协调运行时状态。
- **你失效时如何被感知**：本 skill 没有心跳/租约，"失效"体现为"该定期审计的模块
  长期没被审计"——这类失效不会自动告警，只能靠 architecture-coordinator 的职责
  意识或人类主动发起来兜底，本身是这个元层 skill 相对薄弱的一环（见下方迭代机制）。

---

## 五子系统打分（每维 0–2）

| 子系统 | 健康标志 | 不健康信号 |
|--------|---------|-----------|
| 指令（instructions/AGENTS.md） | 简洁、分层、按需加载 | 堆成百科、规则重复、没人读 |
| 模板（templates） | 用了就对、字段对齐 types | 模板和实际产物漂移 |
| 状态（state/feature_list） | 真实反映 passing 边界 | 假 passing、手改痕迹 |
| 脚本（scripts） | 命令可跑、错误结构化 | 空跑成功、裸 throw |
| 验证（verify/rubrics） | 门控真拦得住、证据齐 | verify 空绿、无 evidence |

给每维打分，**定位最弱子系统**，改进从最弱处下手。

---

## 承重测试（文章核心原则）

> 「每个 harness 组件都编码了一条关于模型局限的假设。定期逐个移除组件，
> 验证它是否仍然承重。模型变强后，删掉不再承重的脚手架。」

做法——**一次只改一个变量**：

1. 选一个怀疑冗余的脚手架（某条指令 / 某个门控 / 某个 subagent）。
2. 临时移除或关闭它。
3. 跑验证（`pnpm harness verify` + 一个代表性 feature），看结果是否变化。
4. 判定：
   - 结果变差 → **承重，保留**。
   - 结果不变 → 候选冗余，记进 quality 快照，考虑删除。
5. 恢复变量，一次只测一个，避免互相干扰。

**注意方向**：不是无脑加脚手架。文章明确——任务若已在模型稳定能力范围内，
就不该叠验证开销。harness 应随模型变强而**变瘦**。

### 承重测试固定用例：门控绕过类事故（真实发生过，每次审计必跑）

模拟以下攻击路径，验证现有流程**能否拦截**（拦不住 = 对应子系统扣分）：

1. **手改 passing + evidence 不入库**：在分支上直接把 feature_list.json 的
   `status` 改成 `passing`，evidence 指向一个被 `.gitignore` 挡住的 `*.log` 路径
   （`git ls-tree HEAD -- <路径>` 为空）。审查/verify 环节是否会质询"未经
   `pnpm harness verify` 门控"并阻断？reviewer 是否实测 evidence blob 在树中，
   而非轻信 diff/progress 的声称？
2. **status/owner/evidence 出现在 PR diff 中**：这类字段的手改是否被视为嫌疑并阻断？
3. **verdict 越权**：worker 自打 `review:*-ok`、或第二个 coordinator 并行给出
   冲突结论时，流程是否以可核验事实（git ls-tree 实测）为准而非打分/声称？

三条任何一条能溜过去，说明验证/状态子系统**不承重的是流程而非脚手架**——
这时该加固门控，而不是删脚手架。

---

## 产出

把打分、最弱子系统、承重测试结论交给 **quality-auditor** subagent 写入
`.harness/state/quality-document.md`，保留历史快照以便看趋势。
本 skill 不直接改任何 feature 状态或实现代码。

---

## 领域/商业知识（为什么用这套方法论，而不是"感觉哪里不对劲就改哪里"）
本仓的教训是"全绿但空转"——门控显示通过，但没有真的挡住任何东西（用户跨会话记忆
里明确记录"已九次"）。这正是承重测试要解决的问题：**光看门控是否存在，不能判断它
是否承重**，必须主动移除、观察结果是否变差，才能区分"真正拦截风险的门"和"摆设"。
外部对照（抄的是方法论，不是照搬指标定义——本仓不是线上服务，没有 SLI/SLO）：
- **SRE 的 error budget**：核心思路是"允许一定量的失败换取迭代速度，超预算才收紧"——
  对应本项目"harness 该随模型变强而变瘦"的原则：不是所有脚手架都要永久保留，
  没有承重的验证开销就是在花掉本可以用于交付的"预算"，该被识别出来并移除。
  区别：本仓没有正式的 SLO 数字化预算，这是有意为之（AGENTS.md 硬约束禁止制造
  第二份事实副本），承重测试本身就是替代"数字化预算"的判定手段。
  ([SRE error budget guide](https://www.nobl9.com/resources/a-complete-guide-to-error-budgets-setting-up-slos-slis-and-slas-to-maintain-reliability))
- **五个为什么（Five Whys）**：承重测试的"结果不变→候选冗余"判定，本质是在问
  "如果这个门不存在，真正会出问题的第一层原因是什么"——一次追问就能定位，比反复
  猜测更快收敛到"这条规则最初为了防什么"。
- **控制变量实验**：承重测试"一次只改一个变量、跑验证、恢复"的三步循环，就是控制
  变量法在流程审计场景下的直接应用——多个变量同时改动时，结果变差无法归因到具体
  哪一层，审计就失去意义。

## 迭代/进化机制（这份 skill 自己怎么变好）
- 本 skill 属于 `.harness/state/skill-upgrade-backlog.md` 的批次 A，升级历史记在该
  文件的"迭代日志"。
- **每次审计跑完，本身就是一次经验回流的机会**：若发现固定用例之外还有新的门控
  绕过路径（新的攻击面），补进"承重测试固定用例"一节，而不是只写进那一次的
  quality-document 快照就完事——快照是历史记录，固定用例列表才是下次审计会真的
  重跑的部分，两者不是同一件事。
- **本 skill 目前最弱的一环是"谁来定期触发"**（见上方架构位置）：没有心跳/租约意味
  着它依赖人或 architecture-coordinator 的主动意识，这是已知短板，未来若要补强，
  方向是让 architecture-coordinator 的 C-cycle 复盘里显式包含"距上次 harness 审计
  多久"这类检查点，而不是给本 skill 本身加一个租约（元层评估工具没必要模拟一个
  常驻角色）。
