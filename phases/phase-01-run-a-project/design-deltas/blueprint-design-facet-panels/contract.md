# 蓝本设计器 16 项面板内容 contract delta（解开 D-05 二级 sign-off）

本文件描述**每一项设计配置面板打开后的字段/数据结构提议**——是给后续实现参考的
**设计描述**，不是最终代码，也不修改任何已签核的契约操作（`updateDesignFacet` 等
今天仍是 `content: z.string()` 的不透明字符串存储；本文件只是为"这个字符串里应该
装什么形状的内容"提供一份人类可签核的参照，不在本 delta 里改动契约的写入形状）。

依据材料：`phases/phase-01-run-a-project/requirements/02-tpl/r10-design-facet-panels-draft.md`
（agent 从 `WorkspaceX Standalone.html` 逐项抽取的草稿，已含 16 项面板的字段/交互）。
本文件是该草稿的**签核化整理**，字段提议逐条可回溯到草稿对应小节，未新增任何草稿
之外的臆造内容。

---

## 人类已裁决的两点（本次签核前置）

1. **命名**：第 4 项面板标题统一使用**「角色与权限」**（不使用草稿记录的原型内部渲染
   标题「角色与分组」——草稿问题 1 的裁决结果）。下文第 4 项的字段提议按「角色与权限」
   命名，不再出现「角色与分组」这个名字。
2. **权限矩阵**：「角色权限默认值矩阵」里的灰色格子是**只读**（产品硬约束，界面上
   禁用、不可点击），其余格子**可勾选**，方法负责人（引导师/组织管理员）可在灰色格子
   之外自由配置默认值。下文第 4 项据此给出矩阵字段的编辑态提议。

## 未决问题的处理方式（登记为已知缺口，不阻塞本轮签核）

以下 3 点人类尚未裁决，本文件**不代为回答**，按草稿本身"给人类的下一步建议"一节的
态度处理——先签核可签的部分，未决项各自登记一条已知缺口，留待后续单独确认：

- **G1**（对应草稿问题 2）：「分组规则」（第 3 项）与「角色与权限」（第 4 项）内容
  是否重叠、是否应合并——本文件第 3、4 项**按草稿现状分别给出字段提议**（不预判合并
  与否），字段命名刻意避免相互依赖，将来合并时改动面可控。
- **G2**（对应草稿问题 4）：「空间要求」（第 8 项）字段的输入形态未确认（文本/下拉/
  结构化数值）——第 8 项字段提议里该字段标注为 `unknown-input-shape`，暂不假设具体
  控件类型。
- **G3**（对应草稿问题 5）：「问卷 Studio」模块指代不明——第 5 项字段提议里"从问卷
  Studio 引入"标注为**不在本轮字段范围内**，不构造一个不存在模块的调用形状。

---

## 分组一：基本配置（5 项，含独立于 5 组 15 项列表之外的第 0 项）

### 0. 基本配置（第 16 项，总览/初始化设置页，非 `design-facet-table.ts` 的一个 key）

**性质说明**：这一项**不是**一个新的 `designFacetKey`——它是蓝本设计器的**总览页**，
聚合的是已经各自有契约操作的四件事，字段提议因此是"这一页展示/编辑哪些已有操作的
数据"，不是一份新表：

- `initializationPreview`：六类一览卡片区，**直接复用已实现的
  `getInitializationPreview`**（F189/BP-07，`GET /blueprints/:id/initialization-preview`），
  不新开第二个聚合接口。
- `durationTier`：时长档位单选（四档 + 自定义），**直接对应已实现的
  `setDurationTier`**（BP-03/F177）。档位说明文案（"半场=3–3.5 小时"等）是静态展示文案，
  不进数据结构。
- `formatAndLanguage`：形式（混合/线下/全线上）+ 语言（中文/英文/双语）+ 是否双语交付
  勾选，**对应契约已有的 `setFormatAndLanguage` 操作**（`SessionFormat`/`SessionLanguage`
  枚举，见 `packages/contracts/src/templates.ts`）。
- `modelStrategy` / `quotaPolicy`：现场/会后/机密三条 lane 的模型选择 + 配额与降级阈值，
  **对应契约已有的 `setModelStrategy`/`setQuotaPolicy` 操作**（`ModelLane` 三值）。

⇒ 第 0 项的实现建议是**纯前端聚合页**，把上述四个已签核操作的读写拼到一屏，不需要
新的后端 facet key、不需要新表。这与人类"第 16 项建议单独列一条 UC 或作为『套用初始化』
的顶层配置，不要漏排入开发计划"的提醒一致——它确实需要被排进开发计划（一个前端聚合
feature），但不需要新的数据结构。

### 1. 主题与背景（`topic-and-background`）

```
ThemeStatement: {
  template: string          // 固定模板句式，如"以什么{方式}在{时间约束}内{达成什么可验证的结果}"
  rules: string[]           // 4 条固定规则标签（时间约束/可证伪/字数上限/不写解决方案），静态展示
}
BackgroundElement: {
  element: "为什么现在" | "已知结论" | "硬约束" | "要拍板的事" | "不讨论的事"  // 5 行固定要素，闭集
  content: string
  source: "客户输入" | "会前访谈" | "洞察库自动带入" | "引导师填写"          // 与 element 一一对应的默认来源
  citedFrom?: string        // 挂来源引用；草稿"未挂来源标灰"暗示这是可选字段
}
ThemeContent: {
  statement: ThemeStatement
  background: BackgroundElement[]   // 恒 5 行，element 闭集
  candidateThemes?: string[]        // AI 生成的候选主题（"3 个候选主题并标注支持洞察条数"），可选
}
```

### 2. 流程 Agenda（`flow-agenda`）

内容最丰富的一项，草稿证据充分但结构复杂——建议实现时拆两层：

```
AgendaHalfDay: {
  ordinal: number
  segments: AgendaSegmentDraft[]
  collapsible: boolean      // 半场本身可拖拽整体换位
}
AgendaSegmentDraft: {
  ordinal: number
  title: string
  optional: boolean         // 对应 F19 已实现的 optional 语义（可选环节自动增删）
  duration: number          // 分钟；⚠ 与 project 束 P5（KNOWN_CONTRACT_GAPS）"AgendaSegment.duration
                             //   无文档化单位"是同一个未决点，本文件不重复裁决，仅标注关联
  facilitatorRole?: string
  groupRole?: string
  canvasBinding?: string    // 绑定画布模板引用
  skillBinding?: string[]   // 绑定 Skill 引用（可多个）
}
AgendaContent: {
  halfDays: AgendaHalfDay[]
  aiPacingSuggestions?: { segmentOrdinal: number; suggestion: string; adopted: boolean }[]  // "AI 节奏校对建议"，可选
}
```

⚠ 档位联动折叠（"切到一天档自动折掉四节"）是**派生行为**，由 F19 的
`agenda-segment-table.ts` 定义表驱动，不在本结构里重复存一份"哪档折哪节"的映射
（同该文件自己的单一事实源纪律）。

### 3. 分组规则（`grouping-rule`）—— 见上方 G1（与第 4 项可能重叠，未裁决是否合并）

```
GroupSizePreset: {
  groupCount: number
  membersPerGroup: string    // 草稿是区间描述（如"每组3人"），非单一数值
  usageHint: string          // "12-16人时用" 等适用场景说明
}
GroupScenario: {
  scenario: string           // 场景名（示例数据"业主首次评估"等，行业相关，非通用占位符）
  whatToAnswer: string
  defaultLeaderProfile: string
}
GroupingRuleContent: {
  sizePresets: GroupSizePreset[]     // 3 个预设
  rules: string[]                    // 4 条固定规则标签，静态展示
  scenarios: GroupScenario[]         // 场景清单，条数不固定（示例 4 行）
  leaderAssignment: {
    autoMatchByProfile: boolean
    balanceByBackground: boolean     // "按背景均衡（同部门不同组）"
  }
}
```

### 4. 角色与权限（`roles-and-perms`）—— 命名已裁决，见上方「人类已裁决的两点」①

```
RoleGroupingConfig: {
  mode: "职能混编" | "按议题自选" | "随机" | "手排"   // 默认"职能混编"
  groupCount: number | "auto"        // "4组" 或 "按人数自动"
  membersPerGroup: string            // "3-5人，超5人自动拆组"
  leaderAssignment: "引导师指定" | "组内推举"
}

// 角色权限默认值矩阵：5 项能力 × 4 个角色（引导/组长/组员/观察者，恒 4 角色，见 O-03 裁决）
PermissionCapability =
  | "改议程" | "写本组画布" | "提交本组产出" | "看别组过程" | "看已发布结论"
PermissionRole = "引导" | "组长" | "组员" | "观察者"

PermissionCell: {
  capability: PermissionCapability
  role: PermissionRole
  editable: boolean     // false = 灰色只读格（产品硬约束，界面禁用不可点击）——
                         //   人类已裁决②："灰色格子只读"，此字段的真值集由产品硬约束表决定，
                         //   不由蓝本作者配置；哪些 (capability, role) 组合恒 editable=false
                         //   本文件不枚举（草稿未给出完整矩阵值，需另行走查原型/产品确认）
  defaultValue: boolean  // 方法负责人可自由配置的默认勾选值——仅在 editable=true 时可改
}
RolesAndPermsContent: {
  grouping: RoleGroupingConfig
  permissionMatrix: PermissionCell[]   // 5 capability × 4 role = 20 个格子
  onboarding: {
    internal: { ssoAutoLogin: boolean }
    external: { phoneVerification: boolean; roster: boolean; tokenValidHours: number }  // "令牌24h"
    observer: { readonlyLink: boolean; rawContentNeedsSeparateGrant: boolean }
  }
}
```

⚠ 20 个矩阵格子里具体哪些 `editable=false`（灰色）是产品侧的既定事实，不是蓝本作者
每次配置——本文件只钉住"矩阵允许区分可编辑/只读两类格子"这个**结构**（回应人类裁决②
的字面要求），具体哪几格是灰色需要实现前再走查一次原型交互态或产品确认（草稿本身
的静态 HTML 抽取无法看到这一层）。

---

## 分组二：会前输入（3 项）

### 5. 问卷（`survey`）—— 见上方 G3（"问卷 Studio" 不在本轮字段范围内）

```
SurveyQuestionSkeleton: {
  ordinal: number
  questionSkeleton: string   // 占位题目骨架，非最终题目文本（"套用时 AI 按议题补成具体问法"）
  questionType: "开放题" | "排序题" | "1-5分题" | string  // 草稿只展示 3 种，可能非闭集，暂不强收窄
  purpose: string            // "生成HMW" / "预设投票项" / "混编依据" 等
}
SurveyCard: {
  kind: "pre-session" | "post-session"   // 会前预习 / 会后满意度与效果
  sendTiming: string          // "开始前5天发" / "结束后2小时发"
  blockingThreshold?: string  // 仅 pre-session 有："回收 < 60% 阻断开始"
  estimatedMinutes?: number
  questions: SurveyQuestionSkeleton[]
}
SurveyContent: {
  cards: SurveyCard[]
  // "从问卷 Studio 引入"按钮对应的能力不在本次字段范围内（G3）——
  // 若该模块日后确认存在，这里应追加一个 importFromStudio 相关字段，本文件不预先造它。
}
```

### 6. 访谈与对象（`interview-and-subjects`）

```
InterviewPlanRow: {
  respondentRole: string      // "客户方决策人" 等
  sessionCount: number
  goal: string                // "要问出什么"
  outline: string             // 提纲引用/名称
}
InterviewContent: {
  plans: InterviewPlanRow[]
  authorization: {
    recordAndTranscribeByDefault: boolean   // 默认✓
    sendConsentLink: boolean                // 默认✓
    requestAiAnalysisByDefault: boolean     // 默认未勾选，"建议逐人问"
  }
  evidenceRule: {
    minIndependentSources: number   // "2 个独立来源才算强"
    excludesSameSessionEcho: boolean
    virtualExpertCountsAsClue: boolean  // 不计入独立证据，只作提问线索
  }
}
```

### 7. 会前任务（`pre-tasks`）

```
PreTaskCard: {
  title: string
  attachedSegmentOrdinal: number   // "必须挂到具体环节"——非可选字段，草稿明确硬约束
  audience: "全员" | "仅组长"
  consequenceIfSkipped: string     // "不做会怎样"，非可选说明
  deadline?: string
  submissionFormat?: string        // "文字/语音均可"
  aiPreread?: boolean
}
PreTaskContent: {
  tasks: PreTaskCard[]
  reminderPolicy: { hoursBeforeDeadline: number; escalatesToReadinessCheck: boolean }  // "截止前24h提醒，仍未交则readiness标红"
}
```

---

## 分组三：现场（4 项）

### 8. 场地与形式（`venue-and-format`）—— 见上方 G2（"空间要求"输入形态未确认）

```
SpaceRequirement: {
  field: "主场地" | "分组空间" | "墙面" | "投屏" | "网络"   // 恒 5 行
  value: unknown             // ⚠ 输入形态未确认（纯文本/下拉/结构化数值），见 G2，
                              //   本字段类型故意留 unknown，不假设具体控件
}
FormatComparisonCard: {
  format: "混合" | "全线上" | "纯线下"
  impact: string[]           // 对场地/流程的具体影响描述（自动加环节/物料倍数/离线兜底等）
}
VenueContent: {
  spaceRequirements: SpaceRequirement[]
  formatComparison: FormatComparisonCard[]
  layoutDiagram?: { groupZones: { label: string }[]; note: string }  // "现场布置图"，示意性质，可选
}
```

### 9. 项目材料（`project-materials`）

```
MaterialItem: {
  name: string
  quantity: number            // "按4组/16人基准计算，会按实际人数重算"——quantity 是基准值，非最终值
  usedInSegment?: string
  preparedBy: "场地方" | "我方"
}
ProjectMaterialsContent: {
  items: MaterialItem[]
  quantityBasis: { groupCount: number; memberCount: number }   // 数量计算的基准人数/组数
}
```

### 10. 分组打印素材（`print-materials`）

```
PrintMaterialCard: {
  kind: "A0-HMW画布" | "A3-组长手册" | "A5-洞察卡" | "A4-进组指引"   // 4 类固定，草稿逐一给出内容
  quantity: number
  spec: Record<string, unknown>   // 各类卡片内部结构差异较大（画布区版面/手册页大纲/洞察卡来源置信度/
                                    //   进组指引信息），草稿未给出统一结构，暂用开放记录，
                                    //   实现时按 4 个子类型各自细化（不在本轮拆四份 schema，
                                    //   避免在未有实现优先级前过度设计）
}
PrintMaterialsContent: {
  cards: PrintMaterialCard[]
  digitizationFlow: { ocrByRegion: boolean; keepsOriginalPosition: boolean }  // "拍照上传后OCR归位"
  constraint: string   // "打印件和线上画布必须同构"——硬约束说明，静态展示
}
```

### 11. 组内能力（`group-capabilities`）

```
CapabilityDefault: {
  capability: "与AI的对话" | "用户访谈" | "深度研究" | "用户研究" | "画布便签" | "组内投票" | "证据检索"  // 7 项固定
  defaultOn: boolean
  locked: boolean       // "开·必留" = true，表示不可被关闭
}
VisibilityRow: {
  role: "组员" | "组长" | "引导师" | "观察者"   // 恒 4 角色
  canSee: string[]
  cannotSee: string[]
}
GroupCapabilitiesContent: {
  capabilities: CapabilityDefault[]
  outputRouting: { from: string; to: string }[]   // "画布节点→成果沉淀清单" 等产出回流规则
  visibility: VisibilityRow[]
}
```

---

## 分组四：AI 能力（2 项）

### 12. Agent 编排（`agent-orchestration`）

```
AgentPresenceRow: {
  agentRef: string           // Agent 引用（对应 M4 上传Agent 模块已注册的 agent）
  responsibility: string
  presentSegments: "全程" | string[]   // 全程在场 或 具体环节编号列表
  canSpeakProactively: boolean | "按需召唤"
}
AgentOrchestrationContent: {
  agents: AgentPresenceRow[]
  interventionThreshold: { label: string; value: number; note?: string }  // "提议收敛的触发阈值"滑杆参数
  behaviorFlags: {
    askFacilitatorBeforeProposing: boolean
    canEditCanvasWithAiSignature: boolean
    autoInitiateVote: boolean
  }
  hardConstraints: string[]   // 4 条不可配置的产品级硬约束，静态展示，不可编辑
}
```

### 13. Skill 绑定（`skill-binding`）

```
SkillBindingRow: {
  skillRef: string            // 对应 M3 上传Skill 模块已发布的 skill
  segmentOrdinal: number      // "绑在环节上，不绑在人上"
  purpose: string
  status: "生效" | "已降级"    // 与 skill 版本停用/降级状态联动（M3"停用时列出还在引用它的蓝本"）
}
SkillBindingContent: {
  bindings: SkillBindingRow[]
  universalSkillCount: number   // "其余N个为全程可用的通用skill"，与 bindings.length 相加=总数
  degradationWarning?: { skillRef: string; reason: string; mustResolveBeforePublish: boolean }
}
```

---

## 分组五：产出（2 项）

### 14. 输出物（`outputs`）

```
OutputItem: {
  name: string
  required: boolean            // 草稿"红色标记必须有"
  fromSegment: string
  generationMode: string       // "人拍板·AI整理依据" 等，自由文本描述生成责任分工
  destination: string          // "决策台账" / "任务看板" 等去向
}
OutputsContent: {
  items: OutputItem[]
  routingRule: string          // "正式产出只能绑固定快照，不能绑活文档"
  completionChecklist: { item: string; satisfied: boolean }[]
}
```

### 15. 报告模板（`report-template`）

```
ReportPage: {
  ordinal: number
  title: string
  authoring: "必须人写" | "AI起草" | "AI生成" | "必须保留"
}
ReportVersion: {
  kind: "客户交付版" | "内部复盘版"
  pageCount: number
  pages: ReportPage[]
  language?: "中英双语"
}
ReportTemplateContent: {
  versions: ReportVersion[]
  writingConstraints: string[]   // 4 条硬约束（结论先行/每条结论挂证据/过期证据标注/原文引述限制）
}
```

---

## 范围边界（本 delta 明确不做的事）

- **不改动任何已签核契约操作的形状**：`updateDesignFacet`/`getBlueprintDesignFacets` 等
  的 `content: string` 字段类型不变——上述 16 份结构是"这个字符串未来应该装什么"的
  设计参考，不是本次要落地的存储变更。是否/何时把 `content` 从不透明字符串升级为
  结构化 JSON（比如逐 key 建专属列或 JSON schema 校验）是一个**独立的、更大的实现
  决策**，本 delta 不预支它。
- **不裁决 G1/G2/G3 三个未决问题**——已在上方逐条标注、不臆造答案。
- **不新增 `designFacetKey`**：第 16 项"基本配置"被定性为聚合页而非新 facet key，
  不触发 `design-facet-table.ts` 的单一事实源表变更。
- **不产出实现代码**：以上均为设计描述（TS-like 记号，非最终 zod schema/DB 表），
  实现时的具体字段名/类型仍需按 `contract-design.md` 的流程走一遍契约落地。
