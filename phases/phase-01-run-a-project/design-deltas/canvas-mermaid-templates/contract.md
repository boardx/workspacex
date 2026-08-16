# canvas 模板承载 mermaid 图模板 · contract delta

Status: proposed; human signoff required（issue #988）。

> 勘探报告未能取得（issue 原文提到「勘探报告存 coord-main 会话 2026-08-12」，本次任务
> 无法访问该会话记录）。本材料基于当前代码库现状（实测 SHA 见下）独立分析，不编造勘探
> 结论；凡引用具体代码位置的判断都在正文标注文件路径与行号，供人类自行复核。

实测基线：分支 `worker/dev-chat-e2e-blueprint-contract-gap-audit-reframe`，
`packages/contracts/src/canvas.ts`（1098 行）、`packages/fabric-markdown/src/model.ts`、
`apps/web/components/canvas/template-admin.tsx`（现有 `/canvas?screen=template-admin` 屏）。

本 delta 覆盖三件事，均**只产出设计材料，不改契约代码**：

1. **#496 补签**：`createTemplate`（`POST /canvas/templates`）—— controller、application 用例、
   e2e 已实现并在跑，唯独人类签核动作缺失。
2. **mermaid 图模板类型扩展**（VZ-03 前置契约面）：`underlyingType` 收窄为
   `MermaidDiagramType` 12 类枚举关联；模板内容格式扩展为可承载 mermaid 图骨架。
3. **两个已知次级缺口一并裁**（`KNOWN_CONTRACT_GAPS.C_CANVAS_8`）：
   team-only 可见性的 `ownerTeamId`（fail-closed 语义）、「基于既有模板开新版」。

---

## 一、现状（补签材料，对应第①件）

### `createTemplate` 已经在跑什么

| 层 | 文件 | 状态 |
|---|---|---|
| 契约 | `packages/contracts/src/canvas.ts:316-339` | 已写入，注释逐字标「🟡 尚未经人类签核（#496）」 |
| 用例 | `apps/api/src/application/canvas/create-template.ts` | 已实现，同一份 doc-comment 复述待补签状态 |
| controller | `apps/api/src/interface/controllers/canvas-template.controller.ts` | `POST /canvas/templates` 路由已挂，文件头注释同样标注「#496 design-delta，尚未签核」 |
| e2e | `apps/api/tests/canvas/template-lifecycle-http.test.ts`（文件头承认自己是**旧**约束：五操作、无创建） + 实际新增用例覆盖 create→publish 链路 | 真栈跑通（HTTP → controller → application → repository → PostgreSQL，`asApp` 重读） |
| 前端 | `apps/web/components/canvas/template-admin.tsx:579-689`（`CreateDialog`） | 已接入真实 `createCanvasTemplate`，非 mock 壳 |

即：**实现已完整落地并可端到端复现，唯独签核状态是 `pending`。** 这正是 2026-08-04
coord-main 依人类「我离开的情况下你不要等我的决定」原文代裁「先做 + 登记待补签」的产物
（`packages/contracts/src/canvas.ts:257-266`）。本节材料的目的是把这条待补签台账正式提交
签核，而不是重新设计它。

### 当前契约形状（原样摘录，供签核对照）

```ts
createTemplate: {
  method: "POST", path: "/canvas/templates",
  in: z.object({
    key: z.string().min(1),
    displayName: z.string().min(1),
    underlyingType: z.string().min(1),   // ← 本 delta 第二节要收窄的位置
    sections: z.array(SectionDef),
    visibility: TemplateVisibility,      // "org-wide" | "team-only"
  }).strict(),
  out: z.object({
    key: z.string(),
    displayName: z.string(),
    version: z.literal(1),
    status: z.literal("draft"),
    builtin: z.literal(false),
    visibility: TemplateVisibility,
    underlyingType: z.string(),
    sections: z.array(SectionDef),
  }).strict(),
  err: ["TEMPLATE_KEY_CONFLICT", "ROLE_INSUFFICIENT", "DEPENDENCY_UNAVAILABLE"] as const,
}
```

**建议签核结论**：按现状签核（③ API 契约第一节），**不在补签动作里顺带塞入第二、三节的
扩展**——那些是新设计面，需要单独裁决是否连带批准。人类可以只签①、也可以①②③一并签，
两条路径本材料都覆盖。

---

## 二、mermaid 图模板类型扩展（对应第②件）

### 2.1 现状：`DiagramKind` 已经是权威真相源

`@repo/fabric-markdown`（vendor 基线见 `packages/fabric-markdown/VENDOR.md`）的
`src/model.ts:9-26` 已经定义：

```ts
export type DiagramKind =
  | 'flowchart' | 'class' | 'state' | 'sequence' | 'er' | 'mindmap'
  | 'gitgraph' | 'gantt' | 'journey' | 'timeline' | 'pie' | 'quadrant'
  | 'xychart'
  | 'template'   // 工作坊模板（```canvas 围栏），不是 mermaid
  | 'usecase';   // 自定义 UML 用例语法，不是 mermaid
```

**恰好 12 个纯 mermaid 图类型**（`flowchart` 到 `quadrant`，逐一去掉 `xychart` /
`template` / `usecase` 后）与 issue 原文「`MermaidDiagramType` 12 类枚举」的数字吻合：

```
flowchart, class, state, sequence, er, mindmap,
gitgraph, gantt, journey, timeline, pie, quadrant
```

`xychart` 是第 13 个 `DiagramKind` 成员，但从 `mermaid-parser.ts` 的实际解析入口看，
它与 er/gantt/pie/mindmap 一样走「registered plugin」路径（`src/diagrams/registry.ts` +
`src/diagrams/xychart.ts`），语义上也是纯 mermaid 图。**本材料如实标出这处不确定**：
`MermaidDiagramType` 到底是 12 类（issue 原文数字，不含 xychart）还是 13 类（含
xychart），需要人类在签核时明确选一个，本材料不替产品做这个选择。`template` /
`usecase` 两个成员的代码注释里逐字写明「不是 mermaid」，两者都**不**应计入
`MermaidDiagramType`，这一点没有歧义。

### 2.2 契约草案：`underlyingType` 收窄

现状 `underlyingType: z.string().min(1)` 是完全开放的字符串——前端 `template-admin.tsx:621`
的输入框标签就写着「底层类型（契约未约束取值，如实开放）」，这是一处已知的开放字段。

草案（**未落代码，仅设计稿**）：

```ts
/**
 * mermaid 图家族的封闭枚举。权威源是 @repo/fabric-markdown 的 DiagramKind
 * （src/model.ts），本枚举是它的契约层投影——不在这里重新枚举字面量，
 * 而是与上游集合相等，由编译期/测试断言绑死（仿 canvas.ts 对
 * BUILTIN_CANVAS_TEMPLATES 与上游 19 key 的既有做法，I-36 同型）。
 *
 * ⚠ 12 vs 13（是否含 xychart）待人类裁决，此草案先按 issue 原文的 12 类列出，
 *   若人类选 13 类，加一行即可，机械门控会跟着改。
 */
export const MermaidDiagramType = z.enum([
  "flowchart", "class", "state", "sequence", "er", "mindmap",
  "gitgraph", "gantt", "journey", "timeline", "pie", "quadrant",
]);
export type MermaidDiagramType = z.infer<typeof MermaidDiagramType>;

// createTemplate.in 与 .out 的 underlyingType 字段收窄：
underlyingType: z.union([
  MermaidDiagramType,                 // 新建一个「mermaid 图模板」
  z.literal("canvas-section"),        // 沿用今天的画布分区模型（向后兼容既有 19 个内置模板）
]),
```

**为什么不能简单地把 `underlyingType` 整体换成 `MermaidDiagramType`**：今天 19 个内置模板
（`BUILTIN_CANVAS_TEMPLATES`，`canvas.ts:35-52`）与既有组织自建模板走的是「画布分区模型」
（sections = 便签分区，不是 mermaid 图骨架）。把 `underlyingType` 收窄成纯 mermaid 枚举会让
这 19 个内置模板与所有既有组织自建模板的 `underlyingType` 当场校验不通过。草案用一个
`z.union` 保留向后兼容的 `"canvas-section"` 分支，mermaid 分支是**新增能力**，不是替换。

### 2.3 契约草案：模板内容格式扩展

今天 `SectionDef`（`canvas.ts:189-195`）只表达画布分区：

```ts
export const SectionDef = z.object({
  sectionId: z.string(), name: z.string(), order: z.number().int().nonnegative(),
  required: z.boolean(), capacity: z.number().int().positive().nullable(),
}).strict();
```

这套形状**表达不了** mermaid 图骨架（节点、边、方向）。草案新增一个判别联合，
`sections` 与 `diagramSkeleton` 二选一，由 `underlyingType` 的分支决定：

```ts
/**
 * mermaid 图骨架——模板初始状态的最小图，不是画布分区。
 * 复用 @repo/fabric-markdown 的 DiagramModel 形状（src/model.ts），
 * 不新造一份并行的节点/边类型（同一事实单源）。
 */
export const DiagramSkeleton = z.object({
  kind: MermaidDiagramType,
  direction: z.enum(["TD", "TB", "LR", "RL", "BT"]),
  nodes: z.array(z.object({
    id: z.string(), label: z.string(), shape: z.string(),
  })),
  edges: z.array(z.object({
    id: z.string(), from: z.string(), to: z.string(),
    kind: z.string(), label: z.string().nullable(),
  })),
}).strict();

// createTemplate.in 草案（判别联合，非新增独立字段）：
z.discriminatedUnion("underlyingType", [
  z.object({
    underlyingType: z.literal("canvas-section"),
    sections: z.array(SectionDef),
  }),
  z.object({
    underlyingType: MermaidDiagramType,
    diagramSkeleton: DiagramSkeleton,
  }),
])
```

⚠ **这处判别联合是本材料给出的最大设计取舍，必须在签核时被重点审**：它意味着
`createTemplate.in` 的顶层结构从「一份固定字段」变成「按 `underlyingType` 分岔的两份」，
前端 `CreateDialog`（`template-admin.tsx`）现有的单一表单需要按分支切换字段——这是
UI 一节的核心变化点，见下文第三节。

### 2.4 fabric-markdown 装载目标：`TemplateSpec` / `registerTemplate`

`@repo/fabric-markdown` 的模板引擎（`src/diagrams/template-engine.ts:52-70`）目前的
`TemplateSpec` 是纯画布布局数据（`key` / 标题 / `TemplateSection[]`，每个 section 是
canvas px 坐标框），装载的是 19 个「工作坊模板 A0」，与 mermaid 解析（`mermaid-parser.ts`）
是**两条并行代码路径**——`registerTemplate` 挂的是 `template-engine.ts` 这条，不是
mermaid 那条。

草案的隐含要求：mermaid 图模板不走 `registerTemplate`/`TemplateSpec`，而是走
`mermaidToModel`（`mermaid-parser.ts:1014`）产出 `DiagramModel`，再由 fabric 渲染层
（`canvas-io.ts`）画出来——**两条路径分工不变，只是 canvas 契约层新增了通往第二条路径的
入口**。VENDOR.md 规定的 19 个内置 key 不受影响（本草案不改 `template-engine.ts`，也不
新增被 `registerTemplate` 注册的 key）。

---

## 三、UI（admin 编辑器 mermaid 分支原型描述）

> 无原型截图工具，以下用文字描述交互流程与状态，不虚构截图文件。落点：
> `/canvas?screen=template-admin` 的「新建画布模板」对话框
> （`apps/web/components/canvas/template-admin.tsx` 的 `CreateDialog` 组件，
> `data-testid="tpladmin-create-dialog"`）。

### 3.1 现状（已实现，供对照）

对话框固定字段：`模板 key`（`tpladmin-create-key`）、`显示名`
（`tpladmin-create-name`）、`底层类型`——今天是一个自由文本输入框，标签写着
「底层类型（契约未约束取值，如实开放）」（`tpladmin-create-underlying-type`）、
`可见范围`下拉（`tpladmin-create-visibility`，选中 `team-only` 时弹出黄色提示条
`tpladmin-create-teamonly-note`：「归属团队取你自己的团队（契约里没有这一栏）。你若
不属于任何团队，这个模板将对所有人不可见」）、动态分区列表（`tpladmin-create-sections`
+ 逐条 `tpladmin-create-section-${i}` + 「加一个分区」按钮）。

### 3.2 mermaid 分支草案

1. **底层类型输入框 → 分岔控件**。自由文本框替换为一个两态切换（Segmented Control）：
   「画布分区模板」/「mermaid 图模板」。默认选中「画布分区模板」（保持向后兼容，
   不改变今天 19 个内置模板与既有组织模板的创建路径）。
2. 选中「mermaid 图模板」后：
   - 出现第二级选择：**图类型下拉**，选项是 `MermaidDiagramType` 的 12（或 13，
     取决于 2.1 节裁决）个枚举值，人类可读标签用中文（如「流程图」「时序图」
     「甘特图」……），value 用枚举字面量。
   - 原「分区列表」区块（`tpladmin-create-sections`）**隐藏**，替换为一个只读的
     「初始图骨架预览」区域：展示按所选图类型生成的最小骨架（例如选中 `flowchart`
     时预览两个占位节点 + 一条边），文案提示「骨架内容由所选图类型决定，创建后
     可在画布里继续编辑」——呼应今天创建对话框顶部黄色提示条「分区结构只能在这里定」
     的既有措辞模式，改成「图骨架的类型只能在这里定，节点内容创建后可在画布里继续编辑」。
   - `key` / `显示名` / `可见范围` 三个字段的交互**不变**（复用既有校验与
     team-only 提示条逻辑）。
3. **提交态**：按钮文案从「新建草稿」根据分支细化为「新建草稿（分区模板）」/
   「新建草稿（mermaid 图模板）」，避免用户混淆两条路径产出的模板形态不同。
4. **失败态**（呼应 usecases.md 的失败模式穷举）：与今天一致复用
   `tpladmin-create-error` 展示区，`TEMPLATE_KEY_CONFLICT` / `ROLE_INSUFFICIENT` /
   `DEPENDENCY_UNAVAILABLE` 三个既有错误码的文案不变；若图类型枚举校验在客户端就能拦
   （选择框本身是封闭枚举，不会产生非法值），则该分支**不会**新增前端专属错误文案。

### 3.3 「基于既有模板开新版」草案落点

模板库列表（`tpladmin-table` / `tpladmin-cards`）每行操作列（今天有
`tpladmin-publish-*` / `tpladmin-archive-*` / `tpladmin-restore-*` / `canvas-template-use-*`）
新增一个「基于此开新版」按钮，仅在该行 `status !== "draft"`（已发布/试跑/归档的模板
才有「新版本」的意义，draft 本身还没定稿）时可见。点击后打开与「新建画布模板」同一个
`CreateDialog`，但预填 `key`（禁止编辑，锁定为同一 key）、`displayName` / `underlyingType`
/ `sections` 或 `diagramSkeleton` 取自选中版本，人类可编辑后提交，产出 `version: N+1`
的新 `draft` 行。

---

## 四、用例（对应第②件）

| 用例 | 触发 | 前置条件 | 输出 | 失败模式 |
|---|---|---|---|---|
| **创建画布分区模板**（现状，#496 待补签） | 管理员在 `template-admin` 点「新建草稿」，`underlyingType: "canvas-section"` | 具备模板管理权限（`requireTemplateAdmin`） | `draft` v1 行 | `TEMPLATE_KEY_CONFLICT`（key 已占用）/ `ROLE_INSUFFICIENT` / `DEPENDENCY_UNAVAILABLE` |
| **创建 mermaid 图模板**（草案，本 delta 新增） | 同上，`underlyingType` 取 `MermaidDiagramType` 之一，附 `diagramSkeleton` | 同上 + `diagramSkeleton.kind` 必须与顶层 `underlyingType` 一致（否则契约层拒绝，见判别联合） | `draft` v1 行，`sections` 字段为空数组或省略（视最终判别联合实现） | 同上三码；另需裁决：骨架结构非法（如 edge 引用不存在的 nodeId）是否新增 `INVALID_DIAGRAM_SKELETON` 错误码——**本材料不替产品定这一条，留给签核** |
| **编辑**（现状缺口，C_CANVAS_8②，本 delta 提议补） | 见下「基于既有模板开新版」，编辑=开新版，不是原地改 | — | — | — |
| **发布** | `publishTemplate`，现状已签核，不受本 delta 影响 | 模板存在且 `status` 允许该迁移 | `status: "published"` | `TEMPLATE_NOT_FOUND` / 既有错误码不变 |
| **基于已有模板开新版**（草案，本 delta 新增，裁 C_CANVAS_8②） | 管理员在列表行点「基于此开新版」 | 该 key 至少存在一个已发布/归档版本；调用者具备模板管理权限 | 新 `draft` 行，`version = 该 key 当前最大 version + 1` | `TEMPLATE_NOT_FOUND`（key 不存在）/ `ROLE_INSUFFICIENT` / `DEPENDENCY_UNAVAILABLE`；**幂等性未定**——同一来源版本重复点击是否产生多个 draft，草案默认**不去重**（每次点击都新建一行），留待签核确认是否需要幂等键 |
| **team-only 可见性归属**（草案，裁 C_CANVAS_8①） | 创建/开新版时 `visibility: "team-only"` | 见下 API 契约草案的 `.refine` | `ownerTeamId` 非空 | `TEAM_REQUIRED_FOR_TEAM_ONLY`（新错误码草案）——今天的实现是静默 fail-closed（创建者无团队则模板对所有人不可见），草案改为在创建/开新版时**提前拒绝**，把「建完看不见」的隐性失败变成显式 400 |

---

## 五、API 契约草案汇总（对应第②③件，供 `design-signoff.md` ③逐条对照）

### 5.1 `underlyingType` 收窄 + `diagramSkeleton`

见二 2.2 / 2.3 节完整代码草案。核心字段：

- `MermaidDiagramType`：12 类封闭枚举（`xychart` 是否纳入待裁，见 2.1）。
- `underlyingType`：从 `z.string().min(1)` 收窄为
  `MermaidDiagramType | z.literal("canvas-section")`（判别联合的判别键）。
- `DiagramSkeleton`：mermaid 分支新增字段，复用 `@repo/fabric-markdown` 的
  `DiagramModel` 节点/边形状，不新造并行类型。

### 5.2 `ownerTeamId`（fail-closed 语义，C_CANVAS_8①）

沿用 `packages/contracts/src/identity.ts:439-467`（`CapabilityAddPayload`）已经存在的
同型先例——本仓已经有一处「`scope: team-only` 时 `ownerTeamId` 必填」的契约级 `.refine`，
草案原样复刻这个模式，不发明新语义：

```ts
// createTemplate.in / 「开新版」的 in 追加：
ownerTeamId: z.string().nullable().optional(),
// .refine，与 CapabilityAddPayload 同型：
.refine((v) => v.visibility !== "team-only" || (v.ownerTeamId ?? null) !== null, {
  path: ["ownerTeamId"],
  message: "team-only 模板需要指定归属团队",
})
```

⚠ 这与今天的实现（`create-template.ts` 静默取创建者自己的团队、无团队则 fail-closed
不可见）是**行为变化**，不只是补一个字段：草案把「隐性不可见」改成「显式拒绝」。
若人类认为静默 fail-closed 已经足够（毕竟数据库层已有强制），可以只签「补字段」不签
「改为显式拒绝」，两种颗粒度本材料都摆出来，由签核时勾选。

新增错误码草案：`TEAM_REQUIRED_FOR_TEAM_ONLY`（`createTemplate.err` 追加）。

### 5.3 「基于既有模板开新版」（C_CANVAS_8②）

草案新操作（**新增，不改 `createTemplate` 本身**——沿用「加一段不替一段」的既有原则，
避免把 `createTemplate.out.version` 的 `z.literal(1)` 也顺带改掉，那会波及已签核的
「只铸 v1」不变量）：

```ts
mintTemplateVersion: {
  method: "POST", path: "/canvas/templates/:key/versions",
  in: z.object({
    key: z.string().min(1),          // 路径参数，与 body 一致性沿用既有「打架即 400」规则
    displayName: z.string().min(1),
    underlyingType: z.union([MermaidDiagramType, z.literal("canvas-section")]),
    sections: z.array(SectionDef).optional(),
    diagramSkeleton: DiagramSkeleton.optional(),
    visibility: TemplateVisibility,
    ownerTeamId: z.string().nullable().optional(),
  }).strict(),
  out: z.object({
    key: z.string(), displayName: z.string(),
    version: z.number().int().positive(),   // 不是 z.literal(1)——这正是本操作存在的理由
    status: z.literal("draft"),
    builtin: z.literal(false),
    visibility: TemplateVisibility,
    underlyingType: z.string(),
    sections: z.array(SectionDef),
  }).strict(),
  err: ["TEMPLATE_NOT_FOUND", "ROLE_INSUFFICIENT", "DEPENDENCY_UNAVAILABLE", "TEAM_REQUIRED_FOR_TEAM_ONLY"] as const,
}
```

未定的点，如实标出留待签核：

- 幂等性：是否需要 `basedOnVersion` 字段来避免并发开新版产生 version 冲突（当前草案靠
  仓储层「一条语句里判定 + 写入」的既有模式，参照 `create-template.ts` 注释里「这里没有
  先查再建」的既有解法，理论上可以复用同一套并发安全写法，但需要人类确认 version 号
  的分配策略——`max(version)+1` 在并发下需要行锁或唯一约束保证，属于实现细节但影响
  契约要不要暴露 `basedOnVersion`）。
- `mintTemplateVersion` 是否也要允许「从 `canvas-section` 开出 mermaid 版本」（即
  `underlyingType` 跨分支变化）——草案默认允许（判别联合本身不限制跨版本切换类型），
  但这是否符合产品意图未经验证，标注待裁。

---

## 六、与既有契约的交叉检查（对应阶段一致性复核会问的问题）

- **是否与 `identity` 束的 `ownerTeamId` 语义冲突**：不冲突，5.2 节直接复用同一模式，
  这是「同一事实不得声明两处」纪律下的**唯一正确做法**——两处 `ownerTeamId` 校验规则
  逐字同型。
- **是否与已签核的 `publishTemplate` / `trialTemplate` / `archiveTemplate` /
  `restoreTemplate` 五操作冲突**：不冲突，`mintTemplateVersion` 只产生新 `draft` 行，
  发布/试跑/归档/恢复仍是那五个操作各自的职责，未被本草案触碰。
- **是否与 `KNOWN_CONTRACT_GAPS` 其余七条冲突**：`C_CANVAS_1`（三粒度 AI 权限）与本
  delta 无关，`SectionDef` 未新增字段（`DiagramSkeleton` 是平行结构，不是 `SectionDef`
  的扩展），不放大 C_CANVAS_1 的缺口范围。
