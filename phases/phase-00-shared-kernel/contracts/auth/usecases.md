# 契约束 `auth` — ② 用例接口（application 层端口）

> 只依赖 `domain`。不知道 HTTP、不知道 PostgreSQL、不知道 Redis。
>
> ⚠ **失败模式必须穷举**——「失败长什么样」是契约的一半，界面的异常态全靠它。
> 本束的失败模式尤其重要：**认证的失败面就是它的攻击面**。

## 统一失败枚举 `AuthReason`

| 码 | 前端应显示 | ⚠ |
|---|---|---|
| `INVALID_CREDENTIAL` | 邮箱或密码不正确 | **邮箱不存在与密码错误共用这一个码**（I-1）。分开就是枚举通道 |
| `ACCOUNT_LOCKED` | 尝试过多，请 N 分钟后重试 | 锁定期内**正确口令也返回它**（I-3） |
| `EMAIL_NOT_VERIFIED` | 请先完成邮箱验证 | |
| `INVITE_CODE_INVALID` | 邀请码无效 | **不区分「不存在」与「已被用」**——同 I-1 的理由 |
| `INVITE_CODE_REDEEMED` | —— | ⚠ **刻意不提供**。见下 |
| `RESET_TOKEN_INVALID` | 链接已失效，请重新发起 | 过期与伪造共用一个码 |
| `SESSION_EXPIRED` | 登录已过期 | |
| `SESSION_REVOKED` | 此设备已被移除 | 与过期分开：用户需要知道是「被踢了」还是「太久没用」 |

### 为什么没有 `INVITE_CODE_REDEEMED`

「这个码存在但已被用掉」会告诉攻击者**哪些码是真的**，
从而把 14 位码的爆破空间按命中率剪枝。⇒ 与「不存在」共用 `INVITE_CODE_INVALID`。

⚠ 代价是真实用户重复点击时看到的提示不够精确。这是**刻意的取舍**，不是疏漏。

---

## 用例

### `RedeemInviteAndCreateOrg`（F19）

```
in:  { code, email, password, displayName, orgName }
out: { userId, orgId, emailVerificationSent: true }
pre: —
err: INVITE_CODE_INVALID | EMAIL_TAKEN
```

**事务边界是契约的一部分**（I-4）：核销、建组织、建 owner 成员、建凭据
**在同一个事务里**。任何一步失败，整体回滚——**不留下半个组织**。

⚠ 并发两路用同一个码，必须**恰好一个成功**。落法建议：核销用
`UPDATE invite_codes SET redeemed_by=$1 WHERE code=$2 AND redeemed_by IS NULL`
并断言 `rowCount === 1`——**不要先 SELECT 再 UPDATE**，那中间有窗口。

### `Login`（F20）

```
in:  { email, password }
out: { sessionToken, userId, orgs: OrgId[] }   ← 只给 id，不给角色（I-9）
err: INVALID_CREDENTIAL | ACCOUNT_LOCKED | EMAIL_NOT_VERIFIED
```

⚠ **未找到用户时也要跑一次等价开销的假哈希**（I-1 的耗时半边）。
短路返回会让两种失败的耗时差一个数量级，响应体一样也挡不住秒表。

### `RequestPasswordReset` / `CompletePasswordReset`（F21）

```
RequestPasswordReset  in: { email }   out: { sent: true }
```
⚠ **无论邮箱是否存在都返回 `sent: true`**——否则这个端点就是免密的枚举接口。

```
CompletePasswordReset in: { token, newPassword }
                      out: { revokedSessionCount }
err: RESET_TOKEN_INVALID
```
`revokedSessionCount` 是**契约的一部分**：UC-1.1 R4 要求重置后吊销全部既有会话，
而「吊销了几个」是那条要求唯一可被断言、也是唯一能让用户看见的形式。

### `SwitchOrgAtLogin`（F22）

```
in:  { sessionToken, toOrgId }
out: { org }
err: NO_ORG_MEMBERSHIP | SESSION_EXPIRED | SESSION_REVOKED
```
⚠ **它不重新实现切换**——`identity.switchOrganization` 已经有了完整的副作用语义
（清项目上下文、清鉴权缓存、按新组织重新求值，O-12）。本用例只做会话侧的那一半，
然后**调用它**。两处各写一遍就是第八次漂移。

### `RevokeSession` / `ValidateSession`

```
ValidateSession in: { sessionToken } out: { principal } | null
```
这是 F18 的 `PrincipalResolverPort` 的**真实实现**——
它现在是 `HeaderPrincipalResolver`（测试注入，生产不可达）。

---

## 端口

| 端口 | 实现 |
|---|---|
| `CredentialRepository` | PostgreSQL |
| `SessionStore` | **Redis**（替换现有的 `InMemorySessionStore`，见 domain 第三节②） |
| `InviteCodeRepository` | PostgreSQL（核销走条件 UPDATE） |
| `PasswordHasher` | argon2id / bcrypt cost ≥ 12 |
| `Mailer` | ⚠ 发信是**出网**——本地组织路径不得使用（X-3） |

---

## 失败模式穷举（本束的「异常态」）

| 情形 | 必须 | ⚠ |
|---|---|---|
| 邮箱不存在 | `INVALID_CREDENTIAL` + 等价耗时 | 分开就是枚举通道 |
| 口令错误 | 同上，逐字段不可分辨 | |
| 连续失败达阈值 | `ACCOUNT_LOCKED`，**正确口令也拒** | 不然限速是摆设 |
| 邮箱未验证 | `EMAIL_NOT_VERIFIED` | |
| 邀请码不存在 / 已核销 | 都是 `INVITE_CODE_INVALID` | 见上 |
| 并发核销同一码 | 恰好一个成功 | 做错时**两个组织都建出来** |
| 重置令牌过期 / 伪造 | 都是 `RESET_TOKEN_INVALID` | |
| 重置成功 | **全部既有会话立即失效** | 只吊销当前会话是最常见的做错方式 |
| 会话过期 vs 被踢 | 两个不同的码 | 用户需要分辨 |
| Redis 不可用 | **拒绝，不降级放行** | 同 `AUTH_SERVICE_UNAVAILABLE`；降级放行是「鉴权层不存在」的伪装 |
