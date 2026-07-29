# 契约束 `identity` — ② 用例接口（application 层端口）

> 洋葱中层。**只依赖 `domain`**，不知道 HTTP、不知道 PostgreSQL。
> `infrastructure` 实现这里定义的端口（依赖倒置）；`interface` 调用这里的用例。

⚠ **失败模式必须穷举**——「失败长什么样」是契约的一半，界面的异常态全靠它。
已有原型是 happy path 演示、零异常态，**别继承这个缺陷**。

---

## 统一失败枚举 `PermissionReason`

前端据此渲染无权限态的**分层原因**（UC-0.3 R8：不能只显示「无权限」）。

| 码 | 层 | 前端应显示 | 备注 |
|---|---|---|---|
| `NO_ORG_MEMBERSHIP` | 组织层 | 你不属于这个组织 | |
| `ORG_SCOPE_DENIED` | 组织层 | 组织层限制：该资源仅限「能源组」 | 资源可见性范围不匹配 |
| `NO_PROJECT_ROLE` | 项目层 | 项目层限制：你在本项目中没有对应的角色 | **这是正常状态不是异常**（I-11） |
| `PROJECT_ROLE_INSUFFICIENT` | 项目层 | 你的角色不能执行这个动作 | 角色存在但权限不够 |
| `ADMIN_NOT_SUPERUSER` | 组织层 | 管理员身份不授予项目内容读取权 | D-18 |
| `PERSONAL_LAYER_CLOSED` | — | 个人层内容对任何人不可见，只能看到条目计数 | I-8 |
| `LOCAL_ORG_ISOLATED` | — | 本地组织的内容不对外可见 | I-9/I-10 |
| `AUTH_SERVICE_UNAVAILABLE` | — | 依赖失败态（**一律拒绝，不得降级放行**） | UC-0.3 R9 |

⚠ 拒绝响应**不得泄露资源是否存在**——`NO_PROJECT_ROLE` 与「资源不存在」必须不可区分。

---

## 用例

### `Authorize` —— 两层交集鉴权

```
in:  { userId, orgId, projectId?: ProjectId, object: {kind, id}, action }
out: PermissionDecision        // 含 decisionId，写进 Context Pack 的 items[]
pre: —（这是最底层用例，无前置）
err: 不抛错。**任何情况都返回 PermissionDecision**，allowed=false 时带 reasonCode。
```

> 为什么不抛错：鉴权结果是**可解释的数据**，不是异常。
> 「为什么允许/为什么拒绝」要能回溯（UC-0.3 R6），抛错会丢掉这个信息。

### `ResolveIdentity` —— 解析当前身份的两层

```
in:  { userId, orgId, projectId?: ProjectId }
out: { org: Organization, orgRole, teamId,
       projectRole: ProjectRole | null,     // 无项目上下文时为 null（I-11）
       groupId: GroupId | null }
err: NO_ORG_MEMBERSHIP
```

### `SwitchOrganization` —— 切换组织（O-12 + F15）

```
in:  { userId, toOrgId }
out: { org, capabilities: CapabilityListing[] }   // 新组织的整套能力清单
pre: 用户是 toOrgId 的成员
err: NO_ORG_MEMBERSHIP
post-effect（**契约的一部分，不是实现细节**）：
  · 清空全部**项目级**上下文：当前项目 / 环节 / Context Pack / 已缓存的鉴权判定 / 未提交草稿引用
  · 清空全部**组织级**能力解析：上一个组织的 agent/skill/model/mcp 一个都不带过去（F15）
  · 权限按新组织**重新求值**，不复用切换前的任何判定结果
```

### `ListCapabilities` —— 能力清单来自组织配置（F15）

```
in:  { orgId, kind: "agent"|"skill"|"model"|"mcp"|"canvas-template"|"blueprint", userId }
out: CapabilityListing[]        // 已按 scope 过滤到该用户可见的
pre: 用户是 orgId 的成员
err: NO_ORG_MEMBERSHIP
```

⚠ **组织配置为空时返回空数组，不返回任何内置默认值。** 这是 F15 的验收面 V1。

### `MutateCapability` —— 增删改能力清单

```
in:  { orgId, kind, op: "add"|"update"|"disable", payload, actorId,
       disableMode?: "interrupt" | "drain" }      // 停用时必填（D-U5）
out: { listing, provenanceEventId, affectedInFlightCalls: number }
pre: actor 的 orgRole = "admin"
err: PROJECT_ROLE_INSUFFICIENT | ORG_SCOPE_DENIED
```

**D-U5 停用语义**：默认 `interrupt`（立即中断，进行中的调用失败并提示「该能力已被管理员停用」）；
可选 `drain`（允许跑完当前一轮，新调用被拒）。
`affectedInFlightCalls` 是**契约的一部分**——界面的确认弹窗要显示「当前有 N 个进行中的调用会被中断」。

> 为什么给二选一：停用动机分**安全事件**（必须立即断）与**版本下线**（可跑完）。
> 只支持一种必然有一种场景很难受，故把选择权给按下停用的那个人。

### `EnsurePersonalLocalOrg` —— 注册即有（F16 / I-2）

```
in:  { userId, displayName }
out: Organization                 // kind = "personal-local"
pre: —（注册流程调用，幂等）
err: —
```

⚠ 幂等：重复调用返回同一个组织，不新建。

### `ResolveModelConstraint` —— 机密数据的模型约束（D-U1，跨束消费）

```
in:  { orgId, dataScope: {itemId, confidential: boolean}[] }
out: { localOnly: boolean
       source: "promise" | "policy" | "none"   // 见下
       reason: string }
```

**`source` 三取值必须可分辨**（I-10 的界面投影）：
- `promise` —— 本地组织的**不可关闭产品承诺**（`kind === "personal-local"` 推出）
- `policy` —— 正式组织的**管理员可改策略**（`modelPolicy === "self-hosted-only"`）
- `none` —— 不限制

**D-U1 语义（全程本地，不分流）**：`dataScope` 含**任何** `confidential: true` 的条目
⇒ `localOnly: true` ⇒ 本轮**所有**模型调用走本地，云端模型整轮不可用。
**不是**「机密走本地、云端承接非机密部分」。

> 否决分流的理由：它的安全性取决于**片段级机密判定**的准确率，
> 那是没人能保证 100% 的分类问题，一次误判的代价是不可逆泄漏。

### `ExportToOrganization` —— 本地 → 正式组织（F17，隐私承诺的唯一豁口）

```
in:  { fromLocalOrgId, toOrgId, artifactIds: ArtifactId[], actorId, confirmedPreviewToken }
out: { copiedArtifactIds, localProvenanceEventId, targetProvenanceEventId }
pre: · actor 同时是两边的成员
     · confirmedPreviewToken 有效 —— **必须先调 PreviewExport 并由人确认**
err: EXPORT_PREVIEW_REQUIRED | NO_ORG_MEMBERSHIP | EXPORT_DIRECTION_FORBIDDEN
```

**五条硬约束（每条对应一条断言）**：
1. **显式一次性人工动作**——禁止任何自动同步 / 后台上传 / 定时推送
2. 必须先 `PreviewExport`：逐项列出将离开本机的内容**及其在目标组织的可见性**（按目标 `acl_bindings` 预演）
3. **复制而非迁移**：本地副本保留
4. **两侧**都写 `provenance_events`，目标侧条目标注「来自本地组织，**未经本组织入库审核**」
5. **单向**：正式组织 → 本地组织的导入一律 `EXPORT_DIRECTION_FORBIDDEN`

### `PreviewExport`

```
in:  { fromLocalOrgId, toOrgId, artifactIds }
out: { items: {artifactId, title, willBeVisibleTo: Subject[]}[], token }
```

---

## 端口（`infrastructure` 实现这些）

| 端口 | 职责 | 实现 |
|---|---|---|
| `AclRepository` | `acl_bindings` 读写 | PostgreSQL（RLS 强制） |
| `OrganizationRepository` | 组织与成员 | PostgreSQL |
| `CapabilityRepository` | 六类能力清单 | PostgreSQL |
| `ProvenanceWriter` | append-only 事件 | PostgreSQL |
| `NetworkEgressGuard` | 本地组织的出网拦截（I-9） | 进程级网络策略 |

⚠ `NetworkEgressGuard` **不能只是应用层的开关**——I-9 要求网络层可断言。
它的实现必须落在能观测所有出网的位置（容器网络策略 / 代理层）。
