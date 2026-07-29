# 契约束 `identity` — ① 领域模型与不变量

> 洋葱最内层。**不依赖任何外层**：这里出现的东西不知道 HTTP、不知道 PostgreSQL、不知道 NestJS。
> 覆盖 feature：**F01 F02 F03 F15 F16 F17**（phase-00，合计 33 点）
> 依据：`uc-0-3 角色本体与两层权限模型`、`uc-0-5 组织配置平面与个人本地组织`
> 裁决：O-03（项目角色恒四种）· O-12（一账号多组织 + 顶部切换器）· D-18（管理员边界）·
> D-U3（合规负责人归组织角色，不加第三层）· D-U1（含机密整轮本地）

---

## 一、实体与值对象

### `Organization`（实体）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `OrgId` | |
| `name` | `string` | |
| `kind` | `"organization" \| "personal-local"` | **一等字段**，不是特例分支 |
| `modelPolicy` | `"any" \| "self-hosted-only"` | **仅正式组织有意义**；本地组织不读此字段 |

⚠ **`personal-local` 与 `organization` 共用同一张表、同一套 ACL / RLS 机制。**
不做成两条代码路径——「本地模式」的第二套路径必然长期失修。

### `OrgMembership`（实体）

| 字段 | 类型 | 说明 |
|---|---|---|
| `userId` / `orgId` | | |
| `orgRole` | `"admin" \| "lead" \| "consultant" \| "compliance"` | 四种。`compliance` 由 D-U3 新增 |
| `teamId` | `TeamId \| null` | **单一归属**：组织内一人一队（O-12） |

### `ProjectMembership`（实体）

| 字段 | 类型 | 说明 |
|---|---|---|
| `userId` / `projectId` | | |
| `projectRole` | `"facilitator" \| "groupLead" \| "member" \| "observer"` | **恒为四种**（O-03） |
| `groupId` | `GroupId \| null` | 组长/组员才有 |

> **协同引导师 / 联合主持**是 `facilitator` 的**多实例**，不是第五种角色（O-03）。
> **研究员 / 参与者**是 `facilitator` / `member` 在访谈、问卷场景下的**展示别名，不落库**（D-U3）。
> **受访者**不持项目角色，走一次性令牌身份（UC-6.3）。

### `AclBinding`（实体）—— 两层权限的**唯一**落库载体

| 字段 | 类型 | 说明 |
|---|---|---|
| `subject` | `{kind: "user"\|"group"\|"team", id}` | |
| `object` | `{kind: "project"\|"artifact"\|"segment", id}` | **粒度必须下探到 Segment** |
| `scope` | `"org-wide" \| "team-only"` | 资源可见性范围 |
| `orgId` | `OrgId` | 用于 RLS 与不变量 I-4 |

⚠ 组织角色、项目角色、团队可见性**三者最终都归结为 `acl_bindings` 上的判定，不另建三套权限表**。

### `PermissionDecision`（值对象）—— 每次鉴权的可解释结果

```
{ allowed: boolean
  orgLayer:     { role, teamId, passed }      // 组织层判定
  projectLayer: { role, groupId, passed } | null  // 不在项目上下文时为 null
  scopeLayer:   { scope, passed }             // 资源可见性范围
  reasonCode:   PermissionReason              // 见 usecases.md 的失败模式
  decisionId:   string                        // 写进 Context Pack 的 items[]，使「为什么给你看」可回溯
}
```

### `CapabilityListing`（实体）—— 能力清单是组织配置（F15）

六类：`agent` / `skill` / `model` / `mcp` / `canvas-template` / `blueprint`。
每条挂在某个 `orgId` 下，带 `scope`（`org-wide` / `team-only`）。

⚠ **产品代码里不得存在硬编码的默认清单。** 原型里那 6 个 agent、18 台模型都只是**示例配置**。

---

## 二、不变量

> 判据：**它在任何时刻都为真，违反即数据损坏。**
> 写不成断言的是「规则」不是「不变量」，请放到 `usecases.md` 的前置条件里。

| # | 不变量 | 断言方式 |
|---|---|---|
| **I-1** | 任一 `AclBinding` 的 `subject` 与 `object` 必属**同一** `organization` | SQL 约束 + 断言跨组织绑定插入失败 |
| **I-2** | 每个 `user` **恰好**拥有一个 `kind = "personal-local"` 的组织 | 唯一索引 `(userId) where kind='personal-local'`；注册后立即查询断言存在且唯一 |
| **I-3** | `kind = "personal-local"` 的组织，其成员数**恒为 1** | 断言 invite / addMember 对本地组织一律拒绝 |
| **I-4** | 任一查询在 RLS 之后返回的行，其 `orgId` **必等于**当前会话的 `orgId` | **用非 owner 的运行时角色**直连 SQL 跨租户查询，断言返回 0 行 |
| **I-5** | 运行时数据库连接角色**不是任何业务表的 owner** | 查 `pg_class.relowner` 与 `current_user` 比对 |
| **I-6** | 所有含租户数据的表已启用 `FORCE ROW LEVEL SECURITY` | 查 `pg_class.relforcerowsecurity` |
| **I-7** | 交集生成内容的权限取**所有来源中最严格**的一档（不是最宽松，也不是并集） | 构造双来源交集对象，断言其可见性 = min(来源权限) |
| **I-8** | 管理员对他人**个人层**的查询，响应体中**不存在**内容字段（只有计数） | 断言响应 JSON 无 content 键，而非「内容为空串」 |
| **I-9** | `personal-local` 组织内产生的任何请求，**出网请求数为 0** | **网络层**断言（不是应用日志——应用层可能自认为没出网） |
| **I-10** | 本地组织的三条硬隔离**不可通过任何接口修改** | 断言所有 mutation 端点对其返回拒绝 |
| **I-11** | 项目角色只在存在 `projectId` 上下文时有值；无项目上下文时 `projectLayer = null` | 断言非项目请求的 `PermissionDecision.projectLayer` 为 null |

### 为什么 I-9 必须在网络层断言

「数据不出本机」是对用户的**产品承诺**。应用层的断言只能证明「我没有主动发起出网调用」，
证明不了「没有任何出网发生」——第三方 SDK、遥测、依赖库都可能出网。
**只有在网络层观测才是证明。**

### 为什么 I-10 与 `modelPolicy` 必须是两个东西

正式组织的 `modelPolicy: "self-hosted-only"` 是**管理员可改的策略**；
本地组织的「只走本地」是**不可关闭的产品承诺**。
**用同一个可写字段表示会让「承诺」退化成「默认值」。**
故本地组织的约束由 `kind === "personal-local"` 直接推出，**不读 `modelPolicy` 字段**。

---

## 三、这个域不负责什么

- **鉴权的强制**：判定逻辑在 `application`，**强制在 PG RLS**（I-4/I-5/I-6）。
  应用层过滤只是第二道防线。
- **HTTP 语义**：错误码到 HTTP 状态的映射属 `interface` 层。
- **具体的能力条目**：`CapabilityListing` 定义结构，条目内容是**运行时数据**不是领域模型。
