# 取消注册邀请码，降低注册门槛（自助建组织）—— contract delta

Status: 五条决策已在 2026-08-24 会话内由人类逐条拍板（见下），
[design-signoff.md](./design-signoff.md) 已据此写入 `status: confirmed`——
仍需人类在签核 PR 上点一次 review/merge 作为可追溯记录，之后才开工实现。

本文件是本 delta 的**唯一规范来源**。五条决策全部出自**人类 2026-08-24 会话内
拍板**（两轮：方向性决策 + 三点技术裁决，coord-main 转达）：

1. **注册后的组织归属**：自助建新组织（同 `redeemInviteAndCreateOrg` 的建组织语义，
   只是去掉 `code` 必填）。
2. **防滥用手段**：邮箱验证——未验证不能登录。
3. **登录闸门覆盖范围**：实现时先核实现状，不假设自动成立，补一条反证。
4. **旧邀请码路径去留**：彻底移除，只留开放注册。
5. **防滥用边界**：本轮不做频率限流/人机验证，只邮箱验证。

基线：`origin/main`。

## 现状（已核实，非推测）

- `redeemInviteAndCreateOrg`（`POST /auth/register`，`packages/contracts/src/auth.ts:347`）
  是唯一的注册入口，`in.code`（14 位邀请码）**非 optional**——zod 在缺字段时直接判
  invalid，这一点被 `apps/api/tests/auth/register-http-contract.test.ts` 与
  `apps/api/tests/auth/bootstrap-first-user-usecase.test.ts` 显式反证钉住
  （"不带 code 不能注册"）。
- **邮箱验证机制已经存在、且已经接在这条注册路径上**——不是要新建的能力：
  `register-with-invite.ts` 注册成功后即把用户置于「待验证」态（`out.verificationDelivery:
  "queued"`），`pending-verification-cookie.ts` 设置未验证态 cookie，
  `EmailVerificationController`（`/auth/email-verifications/confirm`、
  `.../resend`）+ `cloudflare-email-transport.ts`（真实发信，Cloudflare Email Service）
  +  `mail-outbox-worker.ts`（真实投递）构成完整闭环。**登录闸门本身在哪一层拦截
  未验证用户是本 delta 唯一需要确认的实现细节**（见下方「待人类确认点」）。
- `bootstrapFirstUser`（`POST /auth/bootstrap`）是**永久一次性**的冷启动种子账号入口
  （`credentials` 表全空时才可用，消费后经 `auth_bootstrap_state` 单例表永久关闭），
  与本 delta 语义不同，不受影响、不复用。

## 契约形状（auth 束：新增一个操作，移除一个操作）

新增 `registerNewAccount`；**移除 `redeemInviteAndCreateOrg`**（人类已裁②：彻底
移除，只留开放注册——见下方「三点已裁」②的完整说明与需要一并改写的测试清单）。

```ts
// packages/contracts/src/auth.ts —— auth 束追加
registerNewAccount: {
  method: "POST",
  path: "/auth/register-open",   // 与 /auth/register 分开，不共用路径分支判断 code 有无
  in: z.object({
    email: z.string().email(),
    password: PasswordPolicy,
    displayName: z.string().min(1),
    orgName: z.string().min(1),
  }).strict(),
  out: z.object({
    userId: z.string(),
    orgId: z.string(),
    verificationDelivery: z.literal("queued"),
  }).strict(),
  err: ["EMAIL_TAKEN"] as const,   // 没有 INVITE_CODE_INVALID —— 没有码可判
},
```

## 已裁两点（人类拍板，逐条照录）

1. **组织归属**【已裁】：`registerNewAccount` 直接建一个新组织，调用者即该组织的
   owner——与 `redeemInviteAndCreateOrg` 建组织那一段完全同构（复用
   `register-with-invite.ts` 里"建组织 + 建 owner membership + 建 credential"那个
   事务，只是不再校验/消费邀请码那一步）。
2. **防滥用**【已裁】：复用既有邮箱验证闭环，未验证用户不能登录——即
   `registerNewAccount` 的行为与 `redeemInviteAndCreateOrg` 在"验证前不能登录"这一点
   上完全一致，只是不再要求邀请码。

## 三点已裁（人类 2026-08-24 signoff 会话拍板，逐字照录）

①**登录闸门覆盖范围**【已裁：实现时先核实，补一条反证】：不假设"抄了同一段登录
use case 就自动成立"。实现开工时先实测核实"未验证不能登录"今天具体在哪一层拦截
（`SessionTokenPrincipalResolver`？登录 use case 里的显式检查？还是只是前端不显示
主界面、后端其实放行了？），新路径接线后必须新增一条反证测试钉住"未验证 + 走
`registerNewAccount` 注册 → 登录仍被拒"——不能凭"新路径复用了同一个 use case"就
当作已证明。

②**`redeemInviteAndCreateOrg`（旧邀请码注册）去留**【已裁：**彻底移除，只留开放
注册】**——`/register` 页面只保留 `registerNewAccount` 一种入口，`redeemInviteAndCreateOrg`
连同其契约操作、controller、use case、`INVITE_CODE_INVALID` 错误码一并移除
（若仓库其他地方仍引用该错误码需一并核实清理，不留死引用）。这**推翻**了上一版草案
"纯加法、旧路径保留"的默认方案——两处已钉住的安全反证测试需要被有意识地改写，
不是放任它们变红：
  - `apps/api/tests/auth/register-http-contract.test.ts` 第 138-282 行"code 缺失/
    已用/过期/撤销四种原因归并为 INVITE_CODE_INVALID"这组断言，随 `redeemInviteAndCreateOrg`
    一并删除（该操作已不存在，断言的对象消失），改为对 `registerNewAccount` 补一组
    对称的反证（不合规邮箱/弱密码/空组织名各自被拒 + 拒绝时不建任何行）。
  - `apps/api/tests/auth/bootstrap-first-user-usecase.test.ts` 第 33 行
    `redeemInviteAndCreateOrg.in.safeParse(不带 code 的 body).success === false`
    这条断言的对象（`redeemInviteAndCreateOrg`）本身被移除，需要改写为断言
    `registerNewAccount.in` 的 schema 形状（没有 `code` 字段本就是设计如此，不是
    需要反证"拒绝"的东西）；`bootstrap-first-user-concurrency.test.ts` 等其余
    bootstrap 反证不受影响（`bootstrapFirstUser` 是独立契约，本 delta 不动它）。
  - `invite-code-redeem-atomic.test.ts`（钉住"redeem+建组织+建owner+建credential
    是一个事务"的原子性反证）随 `redeemInviteAndCreateOrg` 一并移除；`registerNewAccount`
    需要一份对称的原子性反证（"建组织失败时不留半个组织"），复用同一套故障注入手法。
  - 邀请码相关的数据面（`invite_codes` 表、`InviteCodeValue` 类型等）**不在本 delta
    移除范围**——那些是否还有其他消费方（如运营后台批量生成邀请码的界面）需要实现
    时单独核实，本 delta 只移除"用邀请码注册"这一条契约路径。

③**防滥用边界**【已裁：不需要，只邮箱验证】——本轮不做频率限流/人机验证/邮箱域名
限制。如果上线后出现真实滥用（批量注册占用组织名额等），按 AGENTS.md「实测优先」
原则回来加，不在本 delta 预先设计。

## 影响面（现状盘点，供①③做技术判断参照）

- `apps/web` 的注册页面/`/register`（若存在，需人类实测确认当前 UI 现状——本 delta
  未附截图，UI 签核仍需按 ADR-023 走 ui-prototyper 补材料）。
- `apps/api/src/application/auth/register-with-invite.ts`：新操作复用其"建组织+
  建owner+建credential+入队验证邮件"这套编排，只是跳过邀请码校验/消费两步。
- `apps/api/src/infrastructure/auth/pg-registration-repository.ts`：`REDEEM_SQL`
  消费邀请码的那条 UPDATE 语句不再是新路径的必经步骤；新路径直接建组织（同
  `bootstrap-first-user` 的建组织语句形状，但不受"仅首个用户"限制）。
