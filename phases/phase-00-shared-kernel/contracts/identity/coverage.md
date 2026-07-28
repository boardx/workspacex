# 契约束 `identity` — ④ UC 覆盖证明

> **这一件回答的问题**：前面三件定的接口，**真的够跑通业务吗？**
> 领域模型再漂亮、API 再整齐，如果有一条 UC 的验收线索找不到对应的接口，业务就是跑不通的。
>
> 覆盖 feature：F01 F02 F03（uc-0-3）· F15 F16 F17（uc-0-5），合计 **33 点**
> 验收线索来源：`uc-0-3` 的 R12 共 **11 条**、`uc-0-5` 的 R12 共 **12 条** = **23 条**

## 怎么读这张表

**两个方向都要查，缺一个方向就是白查**：

- **UC → API**：某条 R12 找不到对应 API ⇒ **接口不够，业务跑不通**
- **API → UC**：某个 API 操作没有任何 UC 要它 ⇒ **接口是多余的，或有 UC 没写**

「前端消费点」列填**已建成界面**里的真实 `data-testid` 或路由。
填不出来的，说明这条验收只能在 API 层验——那也是合法的，标 `—（API 层验收）`，
但**不能空着**：空着意味着没人想过它怎么被人看见。

---

## 一、`uc-0-3` 角色本体与两层权限模型（11 条）

| R12 | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | 管理员访问无项目角色的项目内容被拒；审计目的访问留痕且负责人可查 | `authorize` → `ADMIN_NOT_SUPERUSER`；`mutateCapability` 的 provenance | `/admin/members` `admin-members-boundary` | ✅ |
| V2 | 管理员查他人个人层，**响应体中不存在内容字段**（只有计数） | `authorize` → `PERSONAL_LAYER_CLOSED` | `/admin/members` `admin-boundary-personal-counts-only` | ✅ |
| V3 | 非能源组成员请求「仅能源组」资源被拒，**原因标明为组织层限制** | `authorize` → `ORG_SCOPE_DENIED` | `denied` + `denied-layer`（七态保留名） | ✅ |
| V4 | 四角色 × 同一批接口，返回数据与可执行动作严格符合 R5 表 | `authorize`（`action` 参数遍历） | `?as=` 四视角切换器（**仅预览，非权限**） | ✅ |
| V5 | 无项目角色的用户打开项目，显示**无权限态而非空列表** | `resolveIdentity` → `projectRole: null` | `denied`（不是 `empty`） | ✅ |
| V6 | 鉴权服务不可用时**全部请求被拒，无任何放行** | `authorize` → `AUTH_SERVICE_UNAVAILABLE` | `dep-failed` | ✅ |
| V7 | 操作过程中角色被撤回，后续写操作立即失败，已完成步骤保留审计 | `authorize`（每次写操作前调用，不缓存判定） | —（API 层验收） | ✅ |
| V8 | 角色变更、团队变更、管理员项目访问三类事件可按操作者/时间/对象检索 | `mutateCapability` 的 `provenanceEventId` | `/admin` 活动流 `admin-activity-*` | ⚠ **缺口 1** |
| V9 | RLS 强制三条：跨租户查询 0 行 / 运行时角色非 owner / `FORCE ROW LEVEL SECURITY` | **不经 API**——直连 SQL 断言 | — | ✅ 见 domain I-4/I-5/I-6 |
| V10 | 一份「仅能源组」的 Artifact，经**六条路径**访问都不返回内容 | `authorize`（六条路径共用同一判定） | `/projects/[id]/files` + `/brain` + 检索 | ⚠ **缺口 2** |
| V11 | 组织切换：项目级上下文清空 / 跨组织请求被拒 / 权限按新组织重新求值 | `switchOrganization`（副作用是契约的一部分） | `org-switcher` + `topbar-project-context` | ✅ |

## 二、`uc-0-5` 组织配置平面与个人本地组织（12 条）

| R12 | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | 删掉硬编码清单后系统仍能跑；**清空组织配置后见空态而非默认值** | `listCapabilities` → `[]` | `/admin/*` 的 `empty` 态 | ✅ |
| V2 | 同一用户在 A/B 两组织看到的清单不同且互不泄漏 | `listCapabilities`（按 `orgId`） | `org-switcher` 切换后 `/admin/agent` | ✅ |
| V3 | 本地组织内发起 AI 调用，**网络层出网请求数为 0** | `resolveModelConstraint` → `localOnly, source: "promise"` | `topbar-local-banner` | ⚠ **缺口 3** |
| V4 | 新注册用户**立即**拥有一个可用的本地组织 | `EnsurePersonalLocalOrg`（用例，无 HTTP 面） | `org-switcher` 里的 🔒 条目 | ⚠ **缺口 4** |
| V5 | 停掉本地运行时后**失败**，且**没有任何云端调用发生** | `resolveModelConstraint` + 端口 `NetworkEgressGuard` | `dep-failed` | ⚠ 同缺口 3 |
| V6 | 切换组织：能力清单完全替换 / 项目上下文清空 / 云端模型不可选 | `switchOrganization` → `capabilities` | `org-switcher` | ✅ |
| V7 | 管理员查成员列表/配额/审计报表，**任何位置都不出现**他人的本地组织 | `listCapabilities` / `resolveIdentity` 的 RLS 过滤 | `/admin/members` | ✅ |
| V8 | 增删 agent 后 `provenance_events` 有记录，含操作者/时间/能力标识/前后值 | `mutateCapability` → `provenanceEventId` | `/admin` 活动流 | ⚠ 同缺口 1 |
| V9 | 尝试删除/退出本地组织被拒 | —— | —— | ⚠ **缺口 5** |
| V10 | 能力在本组织存在但「仅能源组」，非该组成员请求 → 原因标明为**可见性范围**（而非「本组织没有」） | `authorize` → `ORG_SCOPE_DENIED`（≠ `NO_ORG_MEMBERSHIP`） | `denied-layer` | ✅ |
| V11 | 导出豁口五条：无自动同步 / 预览门 / 复制非迁移 / 两侧留痕 / 单向 | `previewExport` + `exportToOrganization` | ⚠ **缺口 6**（界面未建） | ⚠ |
| V12 | 正式组织的 `modelPolicy` 可改且留痕；本地组织的同名约束**任何接口都改不动** | `mutateCapability` vs `resolveModelConstraint.source` | `topbar-selfhosted-policy` vs `topbar-local-banner` | ✅ |

---

## 三、缺口清单（这一件的真正价值所在）

> 这 6 条是**这一轮设计的产出**，不是失败。四件套的意义就是把它们在写代码之前找出来。

| # | 缺口 | 性质 | 补法 |
|---|---|---|---|
| **1** | **审计事件的查询接口没定**。`mutateCapability` 只返回 `provenanceEventId`，但 V8「按操作者/时间/对象检索」需要一个**查询**操作 | 接口不够 | 契约加 `queryProvenance`。⚠ 但它跨束——`artifact` 束也要写 `provenance_events`。**建议提到阶段一致性复核，统一设计一个 provenance 查询面，不要每束各造一个** |
| **2** | **V10 的六条路径没有统一入口**。契约只给了 `authorize`，但「经 embedding / 图节点 / 缓存 / 文件浏览器访问」这四条路径在 `context-pack` 与 `artifact` 束里 | 跨束 | 提到一致性复核：**六条路径必须共用同一个判定，不能各查各的**。这正是 UC-0.3 R7「权限沿数据链路传播」的实现要害 |
| **3** | **`NetworkEgressGuard` 是端口不是 API**。V3/V5 要在网络层断言，而契约只能定应用层 | **契约管不到** | 这条要落成**部署形态约束**（容器网络策略），写进 `architecture.md`，并在一致性复核时确认它有人负责。⚠ 应用层的断言只能证明「我没主动出网」，证明不了「没有任何出网」 |
| **4** | **`EnsurePersonalLocalOrg` 没有 HTTP 面**。它是注册流程内部调用 | 设计如此 | 不补 API。但要在 `auth` 束（phase-01 的 01-auth）的注册接口契约里**显式声明这个后置效果**，否则会被漏掉 |
| **5** | **V9「删除/退出本地组织被拒」没有对应操作**。因为根本没有「删除组织」这个 API | 需裁决 | 两条路：① 不提供该 API（V9 变成「接口层面不存在」，用**架构测试**断言路由表里没有它）② 提供但恒拒。**建议 ①**，但需人类确认 |
| **6** | **导出豁口的界面未建**。`previewExport` 的逐项预览、`exportToOrganization` 的确认流都没有屏 | 界面缺口 | F17 已标 `needs_ui_signoff: true`。⚠ 这一屏**合规重量高**——它是隐私承诺的唯一豁口，预览必须让人看清「哪些内容会离开本机、进去后谁能看到」 |

---

## 四、反向检查：有没有多余的 API

| API 操作 | 被哪条 R12 要求 | 结论 |
|---|---|---|
| `authorize` | V1 V2 V3 V4 V6 V10（两份 UC） | ✅ |
| `resolveIdentity` | V5 V7 | ✅ |
| `switchOrganization` | V11 · V6 | ✅ |
| `listCapabilities` | V1 V2 V7 | ✅ |
| `mutateCapability` | V8（两份） | ✅ |
| `resolveModelConstraint` | V3 V5 V12 | ✅ |
| `previewExport` | V11 | ✅ |
| `exportToOrganization` | V11 | ✅ |

**8 个操作全部有 UC 要求，无孤儿接口。**

---

## 五、签核时请重点看这三处

1. **缺口 1 与 2 都是跨束的** —— 它们不该在 `identity` 束里解决，而应在**阶段一致性复核**统一设计。
   如果每束各造一个 provenance 查询面 / 各写一套权限传播，就是第七次「同一事实声明在多处」。
2. **缺口 3 是契约管不到的东西** —— 「出网为零」是部署形态的保证，不是 API 的保证。
   请确认这一条有人负责，否则它会在两边的缝里掉下去。
3. **缺口 5 需要你裁决** —— 「没有删除组织的 API」和「有但恒拒」是两种设计，
   前者更彻底（攻击面为零），但要求用架构测试断言路由表里确实没有它。
