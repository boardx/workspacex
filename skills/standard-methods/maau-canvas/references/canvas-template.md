# MAAU Canvas 输出骨架与出图 prompt 模板

两部分：前半是文字画布的固定骨架（六节，顺序不可调），后半是拼给 `wx_image_generate`
的 prompt 模板。骨架里的引导问句是给你自己看的，不要原样抄进回复；回复里只出现标题和
你填出来的内容。

## 一、文字画布骨架

### MAAU 名称

一句话概括这个最小智能体协作单元。名字要能让没参加会议的人看懂它在替谁做什么事。

### ① Intent（意图）

自问：我们要创造什么价值？为什么值得做？如何定义成功？

- **目标（Goal）**：一到两句，说清这个单元要达成的业务结果，不是要用什么技术。
- **价值（Value）**：为什么值得做——省了谁的什么、换来了什么。
- **成功指标（Success Metrics）**：2-4 条**可衡量**的指标，每条带口径（怎么算、跟谁比、
  多久看一次）。写不出口径的指标不要放进来，那是口号不是指标。

### ② User（用户）

自问：用户是谁？他们面临哪些需求或痛点？什么结果最重要？

- **用户**：具体到角色和场景，不写“所有员工”这种等于没写的范围。
- **需求**：他们要达成什么。
- **痛点**：今天卡在哪，卡的是时间、质量、成本还是信心。

### ③ Agent Team（人 + Agent）

自问：需要哪些角色？哪些工作由 Agent 完成？哪些必须由人完成？边界在哪？

| 角色 | 职责 | 是否 Agent | 决策边界 |
|---|---|---|---|

“决策边界”写的是**这个角色不能自己拍板的那一类决定**，以及越界时把事交给谁——写不出
边界的角色说明职责还没想清楚。表后单独一行：

**协作模式：** 一句话说明人与 Agent 的接力方式（谁起头、谁把关、在哪一步交回给人）。

### ④ Workflow（工作流）

提炼完整执行流程，用纵向箭头链：

```
开始
↓
步骤1
↓
步骤2
↓
......
↓
结束
```

步骤用动宾短语，一步只做一件事。链子后面接两张清单：

- **自动化节点**：无人值守就能跑完的步骤。
- **人工确认节点**：必须有人点头才能继续的步骤，每条附一句“为什么这一步不能自动”。

两张清单的并集必须等于流程里的全部步骤，不能有步骤两边都不在。

### ⑤ Context（上下文）

Agent 为完成任务需要哪些上下文？

- **知识库**：需要哪些沉淀下来的资料/规范/历史案例。
- **数据源**：需要读哪些系统的哪些数据，读的是实时还是快照。
- **工具**：需要哪些工具能力（能对应到真实工具名就写真实工具名）。

### ⑥ Validation（闭环验证）

1. **能否执行？** 这套单元能不能完整跑完一次真实业务任务？说明理由；跑不完就点名卡在
   哪一步、缺什么。
2. **能否创造价值？** 列出可衡量指标（效率提升 / 成本降低 / 质量提升 / 收入增长 /
   用户满意度提升，按实际情况取用），每条写明**如何衡量**——基线从哪来、多久回看一次。
3. **能否持续进化？** 本次执行能沉淀哪些组织资产：Prompt / Workflow / SOP / Knowledge /
   Agent / Template / Best Practice / 数据资产。写清楚沉淀物存在哪、谁维护。

### 一句话总结

一句话描述这个 MAAU。

## 二、出图 prompt 模板

把尖括号里的内容换成本次画布的真实内容，其余照抄。视觉指令用英文（模型对英文构图词更
稳），面板里的短标签可中英混排。

```
A clean, modern business infographic titled "<MAAU 名称>". Flat vector poster layout,
six labeled panels in a 3x2 grid; each panel is a rounded card with a bold header band
and one simple line icon. Panel headers in order: "① Intent", "② User", "③ Agent Team",
"④ Workflow", "⑤ Context", "⑥ Validation". Inside each card, 2-4 very short bullet
phrases only. The Agent Team panel shows small person and robot icons side by side with a
dividing line marking the human/agent boundary. The Workflow panel shows a vertical arrow
chain of <步骤数> steps, automated steps in blue and human-confirmation steps in orange.
Restrained corporate palette: deep blue, teal, warm orange accent, on off-white.
Generous whitespace, thin dividers, no photographic elements, no 3D, no clutter.
Short labels to place: <每个面板 2-4 个短词组，按面板顺序给出，逗号分隔>
```

调用参数：`sizeProfile` 固定 `square`；`idempotencyKey` 用 `maau-canvas-` 加一段本次唯一
的后缀（只允许 `A-Za-z0-9_.:-`）。同一次生成意图重试沿用同一个 key，用户要求换一版才换新
key。
