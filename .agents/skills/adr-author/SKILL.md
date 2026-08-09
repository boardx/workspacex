---
name: adr-author
description: >
  激活条件：用户提到 架构决策、ADR、设计权衡、技术选型、为什么这么设计、
  决策记录、trade-off 等关键词时触发。
  用 adr.template.md 写架构决策记录，沉淀反复出现的决策模式。
---

# ADR Author Skill

## 何时使用

做了一个有长期影响、且未来有人会问「当初为什么这么定」的架构/选型决策时。
判断标准：**这个决定改起来很贵，或者会约束后续多个 feature** → 值得写 ADR。

**另一类触发场景：事故 → 教训 → 固化为规则。** 一次真实事故暴露出流程/门控漏洞、
且修复引入了新的硬约束时，用 ADR 记下「出了什么事、为什么定这条规则」。例如：
evidence 文件被 gitignore 挡在仓库外导致"指向空气的引用"、feature status 在 PR diff
中被手改绕过 verify 门控、双 coordinator 并行产出冲突 review 结论——这类教训写进 ADR
的背景段（事故即背景），规则本身进决策段，未来质疑规则时可直接回溯事故现场。

> **起号用 `pnpm harness new-adr --title "<标题>" [--layer methodology|project]`**，
> 不要手翻 README.md 数下一个号再手写文件——ADR-018 真实撞过号（两个在飞分支各自
> 读到同一句"新 ADR 从 X 起"的提示，直到合并才发现冲突）。new-adr 原子取号 +
> scaffold + 索引登记一步做完，模板本体见 [adr.template.md](.harness/templates/adr.template.md)。
> 本 skill 讲怎么写得有用。

---

## 一条好 ADR 的四段

| 段 | 写什么 | 常见失误 |
|----|--------|---------|
| 背景 | 要解决的问题 + 硬约束 + 当时已知信息 | 只写「我们要选 X」，不写为什么要选 |
| 决策 | 我们决定怎么做（一句话能说清） | 含糊其辞，未来无法判断是否偏离 |
| 后果 | 正面 / **负面**影响 + 对架构平面的影响 | 只写好处，不写代价 = 没人信 |
| 备选 | 认真考虑过但否决的方案 + 否决理由 | 不写备选 = 显得没比较过 |

**关键：负面后果和被否决的备选，是 ADR 最有价值的部分。** 它们让未来的人
知道哪些路已经走过、为什么不走，避免重复踩坑。

---

## 落地

```bash
# ADR 是全局治理文件，统一放 docs/adr/（2026-07-12 人类拍板迁移），编号递增
docs/adr/ADR-0XX-<slug>.md      # 下一个编号看 docs/adr/README.md 索引表
```
写完同步更新 `docs/adr/README.md` 的索引表（编号/主题/状态一行）。

按模板四段写。状态从 `Proposed` 起步，被采纳后改 `Accepted`，
被后续决策取代时改 `Superseded` 并链接到新 ADR。

---

## 沉淀决策模式

反复出现的同类决策（如「又一次在 X 和 Y 之间选」），把判断依据抽象成模式
记进 ADR 的背景段或 [coding-standards.md](.harness/instructions/coding-standards.md)，
下次直接引用，不用从头辩论。

---

## 能力清单（这个 skill 让你具备的可执行动作）

- 判断"这个决定值不值得写 ADR"：用"改起来贵 / 约束后续多个 feature / 事故→
  规则"三条判据筛，不是所有技术选型都要写（外部实践同样强调"不是每个技术选择
  都需要 ADR"，见下方领域知识）。
- 用 `pnpm harness new-adr --title "<标题>" [--layer methodology|project]`
  原子取号，不手翻 README 数编号——这条命令本身就是防止 ADR-018 撞号事故重演
  的机械门控，跳过它等于把自己放回事故现场。
- 判断该用哪个 `--layer`：`methodology`（工程过程决策，可移植到其它项目）还是
  `project`（专属本项目业务决策，即 ADR-100 起的项目实现层）。
- 判断一份 ADR 的状态该停在哪一步：`Proposed → Accepted →
  Deprecated/Superseded`，Accepted 之后原则上不可再改内容本身（可改状态，
  不改已发生的决策记录），需要修订就开一份新 ADR 并把旧的标 Superseded。
- 识别"这其实是第二份事实副本"：如果发现自己在 ADR 正文里抄了一遍某个脚本/
  配置文件里已有的具体规则值（token 数、字号档位、SLA 数字），停下来改成
  指针引用，不要复述——这是本仓已经漂移过 6 次以上的模式（见 AGENTS.md）。

---

## 架构知识：这个 skill 在 harness 工具链里的位置

```
真实决策/事故现场（PR review、事故复盘、新技术选型讨论）
        │
pnpm harness new-adr --title "..." [--id ADR-NNN] [--layer ...]
        │  原子取号：同时扫 docs/adr/README.md 索引表 + docs/adr/ 目录下已有文件名，
        │  取两者交集之外最小可用号，占号当次运行即写回索引（不留"建了文件但
        │  索引没登记"的孤儿态窗口）
        ▼
docs/adr/ADR-0XX-<slug>.md（正文，四段式）+ docs/adr/README.md（索引表行）
        │
下游消费者：
  - 新 agent 接入（agent-bootstrap.md）读关键 ADR 建立初始上下文
  - AGENTS.md / instructions/*.md 用 "见 ADR-0XX" 指针引用，不复述规则值
  - coordinator/reviewer 判断"这个改动是否违反已有决策"时按编号回溯
```

- **输入**：一个已经发生的决策或事故（背景段的原材料），以及
  `docs/adr/README.md` 当前索引表 + `docs/adr/` 目录现有文件（`new-adr`
  取号时两者都读，只看索引表会在"文件建了但没登记"的孤儿场景下取重号）。
- **产出**：一份新 ADR 正文文件 + README 索引表新增一行。**索引表本身就是
  取号的权威锁**，不是取完号之后才手动登记——`new-adr` 是"占号即登记"，同一
  次运行原子完成。
- **它不做什么**：不校验 ADR 内容质量，不检查四段是否写全——`new-adr` 只管
  scaffold 和编号，内容质量是本 skill 剩余部分（"一条好 ADR 的四段"）管的事。

---

## 领域知识：为什么是"四段式 + 原子取号 + 三态生命周期"

**四段式对齐 MADR，但做了本仓自己的取舍**：MADR（Markdown Architectural
Decision Records）标准模板包含 status/context/decision drivers/considered
options/decision outcome/consequences 等字段。本仓的"背景/决策/后果/备选"
四段是 MADR 的精简映射——`decision drivers` 并入"背景"，`considered options`
对应"备选"，`decision outcome` 对应"决策"，`consequences` 对应"后果"。精简
的理由是 harness 场景下大多数 ADR 由 agent 在事故复盘后短时间内写就，字段
越多、越容易在紧迫场景下被跳过不填；四段是"最少信息量仍能让未来的人做判断"
的下限，不是嫌 MADR 设计得不好。

**"负面后果和被否决的备选是最有价值的部分"这条判断，外部实践也在反复强调**：
ADR 治理的通用共识是"决策记录的核心价值在于记录权衡（trade-off），而不是
记录选型本身"——只写"我们选了 X"没有信息量，能查代码就知道；写"为什么不选
Y、Z，选 X 要付出什么代价"才是别人没有的信息。本仓这条规则不是自创，是把
外部共识落成了"常见失误"表里的机械检查项。

**Accepted 状态的不可变性，以及 Deprecated vs Superseded 的区分**：外部实践
把 ADR 集合的可信度直接系在"Accepted 状态在实践中是否真的不可变"上——如果
Accepted 的决策可以被随意改内容，历史记录就失去了"这是当时真实做过的决定"
这个价值。本仓的处理方式（决策被推翻时标 Superseded 并链接新 ADR，不删原文）
与外部实践的区分一致：**Deprecated** 用于"决策不再适用但没有替代方案"（决策
本身过时、失效），**Superseded** 用于"决策被一份新 ADR 明确取代"（新旧之间
有直接指向关系）。本仓当前 README 索引里的用法基本是 Superseded 场景（如
ADR-004 被专用协调服务取代），如果未来出现"决策单纯失效、没有替代"的场景，
应该用 Deprecated 而不是勉强套 Superseded。

**原子取号本身是"事故→规则"的直接产物**：ADR-018 被两个在飞分支同时占用，
根因是两边都读到同一句"新 ADR 从 X 起"的静态提示文字后各自本地取号，直到
合并才发现冲突——这是**没有单点写入锁**的经典并发问题。`new-adr` 的解法
（取号时同时扫描索引表和文件名两个来源，占号当次原子写回索引）本质上是把
"取号"从"读一个可能过期的提示"变成"对权威文件做一次读-写事务"，与
`.harness/scripts/lib/adr-id.ts` 里 `nextAdrId` 的实现思路一致。`templates
allocate` 的域码分配复用了同一个模式，不是巧合，是同一个根因的通用解法。

- 参考来源：[MADR 官方说明与模板](https://adr.github.io/madr/)、
  [MADR GitHub 模板原文](https://github.com/adr/madr/blob/develop/template/adr-template.md)、
  [ADR 治理最佳实践：Deprecated vs Superseded 的区分与生命周期维护](https://hidekazu-konishi.com/entry/architecture_decision_records_templates_and_operations.html)。

---

## 迭代 / 知识回流机制

- 每次一份 ADR 从 Accepted 被标成 Superseded/Deprecated，检查触发它的那次
  决策是否揭示了新的通用模式（例如"又一次因为没有单点写入锁而撞号"），如果
  是，把模式抽象后追加进本文件"领域知识"段，而不是只留在具体那份 ADR 里。
- 如果本仓开始出现"该用 Deprecated 却都用了 Superseded"（或反之）的误用，
  在本文件补一条判据示例，帮后来者快速分辨，不要指望每个人都记得看这段区分。
- 升级状态记录在 `.harness/state/skill-upgrade-backlog.md`（批次 C）。
