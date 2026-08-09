---
name: requirement-author
description: >
  激活条件：用户提到 需求、PRD、用户故事、功能定义、验收标准、把想法变成 feature、
  需求澄清、user_visible_behavior 等关键词时触发。
  把模糊需求转成可验证的 feature 四元组（spec_ref + 行为 + 可执行验证 + 证据位）。
---

# Requirement Author Skill

## 何时使用

用户给的是「想要什么」的自然语言（PRD / 用户故事 / 一句话需求），
你要把它落成 `feature_list.json` 里可执行、可验证的 feature。

> 规则不在这里复制。feature 的黄金粒度与反模式见 **feature-writing** skill；
> 字段结构见 [feature_list.template.json](.harness/templates/feature_list.template.json)。
> 本 skill 只讲「从模糊到可验证」的转换手法。

---

## 能力清单（这个 skill 让你具体能做什么）

- 通读某 phase `requirements/` 下**全部** `*.md`，识别哪些章节（R1-R12）已写、
  哪些是空占位符（占位符 ≠ 已规格化，不能跳过）。
- 用澄清提问清单收敛模糊点，**不清楚就先问，不替用户拍板**。
- 把 R3（主流程）/ R4（异常流程）改写成 Given-When-Then 三段，直接把 Then
  部分誊写进 `user_visible_behavior` 与 `verification` 候选断言（见下方技法①）。
- 判断一条需求是「user goal 级」还是「summary 级」，决定直接转 feature 还是先拆
  （见下方技法②），避免生成过大或过小的 feature。
- 生成/更新 `phases/<phase>/feature_list.json` 里的 feature 四元组，
  `spec_ref` 精确指向你本人刚写下的章节 ID。
- 识别 `user_visible_behavior` 中本 feature 无法断言的行（契约缺口，L10），
  在 notes 里显式标注由哪个 feature 接盘，不静默跳过。
- 识别 UI 阶段（`has_ui: true`）的前置关卡，知道什么时候要等 ui-prototyper
  产出、什么时候不必等签核就能生成清单。

---

## 架构知识：这一环在全链路里的位置

```
人类/用户故事 ──▶ [requirement-author]（你）──▶ feature_list.json ──▶ feature-writing 规范校验
                       ▲                              │
                  ui-prototyper（has_ui 阶段          ├──▶ verification-writer（补全断言契约）
                  的前置输入，非门槛）                  ├──▶ sprint-planner（排期、判 parallel-safe）
                                                       └──▶ feature-implementer（读 user_visible_behavior 实现）
```

- **上游输入**：`phases/<phase>/requirements/*.md`（人类或你自己刚写的原始需求）；
  UI 阶段额外读 `ui-preview/` 已建成的真实界面（截图 + `data-testid`）。
- **下游消费者**：`feature_list.json` 是全链路**唯一权威**，被 feature-writing（校验字段规范）、
  verification-writer（补全/打磨 verification）、sprint-planner（排期）、
  feature-implementer（照 `user_visible_behavior` 实现）依次消费。你写错一个字段，
  下游全部环节都在错误基础上工作。
- **机械门控在哪几处重新校验你的产出**：
  - `spec_ref` 在 `claim`（认领开工）与 `verify`（转 passing）两处都被
    `.harness/scripts/lib/spec-ref.ts` 重新解析——文件/章节不存在则两处都拒绝。
  - `hasRequirementsCoverage`（`contract-design.md` 门控③）检查该阶段
    `requirements/` 是否有**真实 story 覆盖**（不是裸模板占位符），
    没有则直接拒绝签核，不管设计本身对不对——「设计对不对」不能替代
    「这块设计背后有没有一个真实需求」。
  - `has_ui: true` 的阶段没有契约束（`contracts/`）会被判失败，
    不是静默放行（ADR-023 收口）。

---

## 领域/商业知识：为什么这样设计

**为什么 2026-07-19 起强制 `spec_ref`（三元组→四元组）**：在此之前 feature 可以
直接凭空写 `user_visible_behavior`，没有需求出处，返工时说不清"这是不是真需求"。
`spec_ref` 把每个 feature 钉死回一段人写的、可读的需求文字，让 `verify`/`claim`
能机械核实"这不是编出来的"。

**为什么 R4（异常流程）最容易被跳过、也最重要**：本仓积累的返工里，几乎全部
"能跑但没想清楚边界"的返工都出在异常流程缺失——这与外部研究结论一致：
Cockburn 在《Writing Effective Use Cases》里把"系统性地发现分支/异常流程"列为
用例写作法相对于一句话故事的核心增益点；同时 BDD/Gherkin 社区的共识是
Given-When-Then 与 Cockburn 的前置条件/主流程/后置条件结构**本质同构**——
Given 对应前置条件，When 对应触发条件，Then 对应主/异常流程的系统响应。
这印证了本仓 R1-R12 模板不是自造的，是在成熟方法论上做了裁剪。

**外部研究支撑的两条具体建议（可直接用于写作）**：

1. **技法①：用 Given-When-Then 顶一遍 R3/R4 每一条，再誊写 Then。**
   R3/R4 每一步先在草稿里写成「Given \<前置状态\> When \<触发\> Then \<可观察结果\>」，
   哪怕最终文档不保留这个格式——`Then` 部分天然就是 `verification` 断言候选、
   `When` 部分天然就是 `user_visible_behavior` 里"做了什么操作"那半句。
   这比直接跳过草稿、凭感觉写 `user_visible_behavior` 更不容易漏边界。
2. **技法②：先判断需求层级（user goal / summary），再决定转几个 feature。**
   Cockburn 用例分级里"user goal 级"用例是一次能完整交付用户价值的最小单元，
   "summary 级"是需要拆成多个 user goal 才能完成的更大范围。对应本仓判据：
   一句需求如果转成单个 feature 会超出 4-8 小时工作量（feature-writing 的粒度标准），
   说明它是 summary 级，先在 requirements 里拆成多个 R1 小节或多个文件，
   再各自转 feature——不要硬塞成一个大 feature 指望实现者自己拆。

---

## 标准入口：phases/<phase>/requirements/ → feature_list.json

原始需求的固定家是每个阶段的 `phases/<phase>/requirements/` **文件夹**（`new-phase` 自动 scaffold，
内含 `README.md` + 起始 `00-overview.md`）。需求可按领域拆成多份 `*.md`（auth.md / teams.md / rooms.md）。
本 skill 的标准流水线：

1. **读** `phases/<phase>/requirements/` 文件夹里的**全部** `*.md`（跳过 README.md，原始需求、用户故事、验收线索、范围边界）。
2. **澄清**模糊处（用下面的澄清提问清单），不清楚就先问，别硬猜。
3. **转换**成 feature 三元组，**写入**同目录 `phases/<phase>/feature_list.json`。
4. `requirements/` 是输入/上下文，**不改它**；权威产物是 `feature_list.json`。

没有 requirements/ 内容时（用户直接口述需求），也可直接转换，但建议先把原始需求落进
该文件夹留痕，再生成 feature_list，保证可追溯。

### UI 相关阶段（roadmap `has_ui: true`）：UI 先行，确认后才生成

若本阶段是 UI 阶段（`new-phase --ui` 标记），流水线里多一道**前置关卡**（ADR-003）：

1. **先** 由 [ui-prototyper] 把真实 UI 做出来（`apps/web` + mock 数据）→ 人类工程师确认。
2. **界面做出来之后**你才开始生成 `feature_list.json`。
   ⚠ 2026-07-30（ADR-023 决策一）起**没有 phase 级 `ui-signoff.md`**——UI 是束级
   `contracts/<束>/design-signoff.md` 的第 ① 件。签核发生在 feature 之后（束的 `covers:`
   要填 feature 编号），所以**不要等签核再生成清单**；未签核挡的是**开工**（`new-sprint` / `claim`）。
3. 生成时，**输入不只是 requirements/**，还包括**已建成的真实 UI**：把 `user_visible_behavior` 和
   `verification` **锚定到界面里真实存在的 `data-testid`/元素**（束级 `ui.md` 已列出组件落点），
   让验证契约对着看得见的界面，而不是凭空描述。

---

## 转换公式：模糊需求 → feature 四元组

每个 feature 必须同时产出四样东西，缺一不可（**人类拍板 2026-07-19**：新增
`spec_ref`，此前是三元组）：

| 四元组 | 问题 | 反面（不可接受） |
|--------|------|----------------|
| `spec_ref` | 这个 feature 的 story 出处在哪？ | 空 = claim/verify 直接拒绝（机械门控，见下） |
| `user_visible_behavior` | 用户/系统做什么操作，能观察到什么结果？ | "支持登录"（不可观察） |
| `verification`（可执行命令） | 用什么命令能证明上面这句为真？ | "测试通过"（没给命令） |
| `evidence`（证据落盘位） | 证据写到哪？ | 留空 = 没完成 |

`spec_ref` 格式：`<requirements/ 下的文件名>.md#R<n>`（如 `auth.md#R4`），指向你
自己刚在 `requirements/*.md` 里用 `requirements.template.md`（2026-07-20 起 Use
Case 格式，R1-R12）写下的那个章节——**这是你本人这一步的产出物，不是转述别处
已有的东西**。写 feature 之前先确认对应章节已经落在 requirements 文件里，编不出
spec_ref 说明需求还没写够，回头先补——哪几节必填以 `requirements.template.md`
为准，本文不重复定义，只提醒一句：**R4（备选/异常流程）最容易被跳过**，几乎
所有"能跑但没想清楚边界"的返工都出在这里。
机械门控（`.harness/scripts/lib/spec-ref.ts`）：`claim` 认领时、`verify` 门控 passing
时都会重新解析 spec_ref——文件不存在 / 章节找不到，两处都拒绝，不是只在这一步查一次。

两条附加纪律：
- **证据可入库（L1）**：`evidence` 路径必须能提交进 git 树（不被根 `.gitignore` 挡住，
  如 `*.log` 规则需白名单例外），并建议 verification 里含入库断言
  （`git cat-file -e HEAD:phases/.../evidence/FXX.verify.log`）。指向未入库文件的
  evidence = 指向空气，reviewer 会实测并阻断。
- **契约缺口显式归属（L10）**：`user_visible_behavior` 中暂时无法由本 feature 的
  verification 覆盖的行，必须在 notes 里写明「由 FXX 交付时断言」，禁止静默跳过。

**关键纪律：先有 verification，再谈实现。** verification 是「完成契约」——
实现者和评审者都读它。契约定不下来，说明需求还没想清楚，不要急着写码。
（这条顺序由 [verification-writer] 与 [feature-implementer] 接力执行。）

---

## 澄清提问清单（需求模糊时先问这些）

1. **可观察出口**：成功时用户具体看到/收到什么？（HTTP 响应？文件？日志行？页面元素？）
2. **触发输入**：什么操作触发它？（请求？命令？定时？）
3. **边界**：什么算失败？失败时应该发生什么？
4. **粒度**：能在一次会话内做完并验证吗？不能就拆（见 feature-writing）。

---

## 好 / 坏对照

❌ 坏需求（无法验证）：
```
"系统要有健康检查功能，要稳定可靠。"
```

✅ 转换后（可验证四元组，`spec_ref` 指回 requirements/platform.md 里你先写下的
「健康检查」章节 R3）：
```json
{
  "id": "F03",
  "spec_ref": "platform.md#R3",
  "user_visible_behavior": "GET /api/health 返回 HTTP 200，body 为 {\"ok\":true}",
  "verification": [
    "curl -sf localhost:3000/api/health | jq -e '.ok == true'"
  ],
  "evidence": "evidence/F03.verify.log",
  "owner": null,
  "status": "not_started"
}
```

---

## 产出后

把 feature 写进对应阶段的 `phases/<phase>/feature_list.json`（唯一权威来源）。
不要碰 sprint 的 `active-features.json`（脚本派生的只读视图）。
排期分配交给 [sprint-planner]；验证命令打磨交给 [verification-writer]。

---

## 迭代/进化机制：这个 skill 本身怎么变好

- **踩坑与经验（append-only，最新在上）**：谁在转换需求时踩到新的模糊模式
  （比如某类需求反复被问出同一个澄清问题、某类 R4 反复被漏写同一种异常态），
  在本节追加一条：`- YYYY-MM-DD：一句话结论（出处：phase/issue 链接）`。
  不删旧条目，被推翻的标 ~~删除线~~ 并注明替代条目。
- **谁干活谁回流**：requirement-author 的产出被下游拒绝（`claim`/`verify` 因
  `spec_ref` 或 `hasRequirementsCoverage` 拒绝）时，说明本 skill 的转换手法有
  盲区——回来补一条经验，而不是只在当次会话里口头修正。
- **外部方法论的更新**：Cockburn 用例写作法与 BDD/Gherkin 是本 skill 转换手法的
  理论依据；若未来发现更贴近本仓机械门控（`spec_ref` + R1-R12）的写作法，
  替换依据时同样走 append-only 记录，不静默替换。

<空，升级开始后追加>

