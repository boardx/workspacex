# 第一个价值时刻 —— 定义与漏斗（backlog E1）

> 状态：**PROPOSED**，待人类签核。E3（埋点并测量）的前置；E2（脱敏示例项目）并行。
> 事件目录、步骤顺序、时间预算的**唯一事实源**是契约
> `packages/contracts/src/first-value-events.ts`——本文只讲「为什么」，不复述取值。

## 1. 定义

**一个组织第一次拿到一条「引用了它自己上传的材料」的智能体回答。**

- 可观测：回答的引用列表（`chat.ts` 的 `citations`，界面上 `data-testid="chat-citation-row"`）
  里至少一条指向该组织自己上传的附件 / 文件，而不是示例项目、不是模型常识。
- 计时：从该组织**第一次登录**起，到上面那条回答落地；预算见契约 `FIRST_VALUE_BUDGET_MINUTES`。
- 对应契约步：`FIRST_VALUE_STEP`（`cited_answer_own_material`）。

## 2. 为什么是它

1. 商业方案 §4.1 已把北极星写成「上传一份真实材料，拿到第一条带证据引用的结论」，
   本文只把它收窄成可机械判定的一件事：**带引用 + 引用指向自有材料**。
2. 引用是本产品区别于「又一个聊天框」的地方：能复核才有信任（§4.4 最终读者：点开就看到原件）。
3. 「自有材料」而不是示例：示例项目（E2）证明链路通，但用户没交出真实数据前还没信任我们。
   示例上的带引用回答单列一步 `cited_answer_sample`，用来区分「卡在链路」和「卡在信任」。
4. 计时起点选**首次登录**而非安装：安装耗时被 GB 级模型下载主导（§4.1 最大卡点），
   混进来会掩盖产品本身的卡点；安装到登录的耗时由健康信号另算。

## 3. 漏斗（顺序见契约 `FirstValueStep`）

| 步 | 含义 | 卡在这里说明 |
|---|---|---|
| `first_sign_in` | 组织内首次登录（计时起点） | 部署 / 身份配置失败 |
| `workspace_opened` | 首次打开项目或线程 | 首页不知道该干什么 |
| `cited_answer_sample` | 示例项目上拿到带引用回答 | 模型 / 检索链路不通 |
| `own_material_uploaded` | 首次上传自有材料 | 不信任、上传失败 |
| `question_on_own_material` | 首次针对自有材料提问 | 不知道怎么问 |
| `cited_answer_own_material` | **价值时刻** | 回答没引用上材料（检索 / 解析问题） |
| `citation_opened` | 首次点开引用看原件 | 价值之后：信任是否形成 |

失败信号（§事前验尸第 3 条）：`first_sign_in` 远大于 `cited_answer_own_material`。

## 4. 数据边界（D16 / D22）

- **本地先行**：每步只记「某组织第一次发生的时刻」（`FirstValueLocalFact`），永不离开实例；
  实例内的管理员可以直接看自己组织的漏斗。
- **离开实例**：只有本地聚合后的计数（`FirstValueFunnelReport`：各步到达的组织数、
  预算内到达数），且仅当 `usage` 同意开启（出厂默认关）。
- 无自由文本、无文件名、无问题 / 回答原文、无组织名；`personal-local` 组织不计入上报。
  由 `pnpm run lint:telemetry-schema` 对两层 schema 机械检查。
- 首次登录→价值时刻的中位分钟数**只在一处声明**：S2 已签核契约的 `TelemetryBenchmark.firstValueMedianMinutes`（`benchmark` 同意）。本契约只提供算它的纯函数 `firstValueMedianMinutes()`，漏斗报文里不另设字段（多带即被 strict 拒绝）。

## 5. 待人类决定

1. 时间预算取值（契约暂定 15 分钟，从首次登录起）。
2. ~~中位数两处声明~~ 已收敛：只留 S2 的 `firstValueMedianMinutes`，本契约只算不存。
3. 漏斗计数是否并入 `InstanceTelemetryReport.usage` 分节（同一同意项），还是保持独立报文。
