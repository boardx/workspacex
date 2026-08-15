# 模型池列表读取 contract delta（#1381）

Status: proposed; human signoff required.（实现已开工，**合并前需人类签**，见 ADR-023。）

本文件是本 delta 的**唯一规范来源**。基线实测 SHA：`cc23c596`。

## 背景：`POOL_LISTING_GAP`

F48（#44）落地时，`domain/model/registry.ts` 就钉住了一个已知缺口：F48 的
`user_visible_behavior` 说管理台列表要展示 kind / vendor / 能力标签 / 上下文窗口 / 单价 /
合规属性 / 状态，而当时（也是直到本 delta 之前）57 条契约操作里没有一条把这些字段作为
`out` 返回——`registerModel.in` 只进不出，`listSelectableModels` 返回的是选择器用的
`ModelCandidate`（I-2，五个字段，刻意不带单价/vendor）。

契约待人类签核期间 agent 不得自行加操作（`contract-design.md` §五 / ADR-020），所以这个
缺口此前只能钉住上报，前端后台的「模型管理」屏因此整屏读 `lib/mock/admin.ts` 的 18 台
示例模型，`apps/api/scripts/lib/aliyun-bailian-models.ts` 的种子清单也无法在界面上被
验证——种下去的模型除了直接查库，没有任何路径能被看见。

## 人类的决定（本会话内，签核人 usamshen）

1. **批准新增 `listModelPool` 契约操作**——这是唯一能让 mockup 变成真实生产数据的路径。
2. **「删除模型」维持产品语义上的停用**（`disableModel`，已实现、可追溯）——不新增硬删除。

## 契约变更（一处新增，零处修改）

```ts
// packages/contracts/src/agent-runtime.ts

/** 管理台看到的模型池一行。与 ModelCandidate（选择器用）不是同一份清单，见下方③。 */
export const ModelPoolRow = z.object({
  modelId: z.string(),
  status: ModelStatus,
  kind: ModelKind,
  shape: ModelShape,
  vendor: z.string(),
  displayName: z.string(),
  capabilityTags: z.array(z.string()),
  contextWindow: z.number().int().positive(),
  unitPrice: z.number().nonnegative(),
  complianceAttrs: z.array(z.string()),
  members: z.array(CompositeMember),
  /** 是否已配置凭据的一个布尔位——凭据本身只写不读（I-6），与 registerModel.in 同一份禁令。 */
  credentialConfigured: z.boolean(),
}).strict();

operations.listModelPool = {
  method: "GET",
  path: "/models",
  in: z.object({}).strict(),   // 组织取自会话主体，不接受任何过滤参数
  out: z.array(ModelPoolRow),
  err: ["NOT_ORG_ADMIN"] as const,
};
```

**①「管理台列表」vs「可选范围选择器」，两份清单刻意不合并**：`listModelPool` 给管理台，
带 vendor / 单价 / 上下文窗口；`listSelectableModels` 给三处消费点选模型用，只有五个字段，
刻意不带单价/vendor（I-2，一个带单价的选择器会变成第二份管理台清单）。

**② 凭据边界不变**：`credential` 与 `endpoint` 只在 `registerModel.in` 出现，
`listModelPool.out` 没有这两个字段——只有 `credentialConfigured`，一个布尔位，实现上是
`EXISTS` 查询，从不读 `ciphertext`（`credential-never-echoed.test.ts` 逐条覆盖）。

**③ 无新错误码、无新屏、无新交互语义**：`err` 只有既有的 `NOT_ORG_ADMIN`（与
`registerModel`/`enableModel`/`disableModel` 同一枚举值，不是新造的）；前端渲染的是既有
`model-screen.tsx` 的既有卡片/列表两种视图，字段不多不少，只是数据源从 mock 换成真实
`GET /models`。

## 不在本 delta 范围内（诚实登记，不顺手做）

- `enableModel` / `disableModel` / `recordAdmissionTest` / `configureModel` /
  `probeConnectivity` 仍然没有 controller 路由（`model.controller.ts` 文件头逐条列了
  各自缺什么端口实现）——F50 覆盖这块，眼下 `in_progress`（owner `w2-model`），本 delta
  不碰这几条路由，前端的启用/停用/测试判读继续是本地演示状态，页面上有对应说明。
- 阿里云百炼种子清单（`aliyun-bailian-models.ts`）与本地模型种子清单
  （新增 `local-models.ts`，qwen3.5-4B）都是**运维脚本**，不是契约/产品代码——契约本身
  不含任何硬编码模型清单（`no-hardcoded-model-list.test.ts` 继续钉住这一点）。
