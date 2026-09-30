/**
 * 通用项目邀请（#4787）的纯规则：令牌 / 邮箱 / 状态派生 / 使用判定 / 重发限频 / 发信失败归类 / 邮件正文。
 * 无 I/O，不需要 Postgres，可本地跑。
 *
 * 钉住：
 *   · 令牌是 256 位随机、落库形态是 SHA-256 十六进制，且两次不同；
 *   · 「失效」一种说法：撤销 / 过期 / 已用一律 invalid，不区分；邮箱邀请与登录邮箱不符才是 email-mismatch；
 *   · 重发：类型 → 状态 → 过期 → 上限 → 冷却 的顺序；到顶优先于冷却；
 *   · 新成员的组织角色是权限最小的一档（consultant），不是 admin / lead / compliance；
 *   · 契约的人话表覆盖每一个 reason / send error（漏一个前端就会落到兜底文案）；
 *   · 邮件正文：项目名 / 邀请人 / 接受链接（`?invite=`，不是工作坊的 `?t=`）/ 北京时间过期时间，主题不被换行注入。
 */
import { describe, expect, it } from "vitest";
import { identity, projectInvitation as C } from "@repo/contracts";
import {
  INVITATION_TTL_MS,
  INVITED_ORG_ROLE,
  LIMITS,
  RESEND_COOLDOWN_MS,
  canResendIgnoringCooldown,
  classifySendError,
  decideInvitationUse,
  decideResend,
  deriveInvitationStatus,
  expiresAtFrom,
  hashInvitationToken,
  isPlausibleEmail,
  newInvitationId,
  newInvitationToken,
  normalizeInviteEmail,
} from "../../src/domain/project/project-invitation";
import {
  buildInvitationMail,
  buildInviteUrl,
  buildMemberAddedNotice,
  formatBeijingTime,
} from "../../src/application/project/project-invitation-mail";

const NOW = new Date("2026-10-01T00:00:00Z");
const FUTURE = new Date(NOW.getTime() + 3_600_000);
const PAST = new Date(NOW.getTime() - 1);

describe("令牌", () => {
  it("256 位随机、互不相同；落库形态是 SHA-256 十六进制，与明文不同", () => {
    const a = newInvitationToken();
    const b = newInvitationToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 字节 base64url
    const h = hashInvitationToken(a);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain(a);
    expect(hashInvitationToken(a)).toBe(h);
    expect(hashInvitationToken(b)).not.toBe(h);
  });
  it("邀请 id 带前缀且不重复", () => {
    expect(newInvitationId()).toMatch(/^pinv-[0-9a-f]{24}$/);
    expect(newInvitationId()).not.toBe(newInvitationId());
  });
});

describe("邮箱", () => {
  it("规范化 = trim + 小写，不折叠 +tag", () => {
    expect(normalizeInviteEmail("  Alice+Work@Example.COM ")).toBe("alice+work@example.com");
  });
  it("形状粗判", () => {
    for (const ok of ["a@b.co", "alice+x@mail.example.com"]) expect(isPlausibleEmail(ok)).toBe(true);
    for (const bad of ["", "a", "a@b", "@b.co", "a@@b.co", "a b@c.co", "a@.co", "a@b.", `${"x".repeat(250)}@b.co`]) {
      expect(isPlausibleEmail(bad), bad).toBe(false);
    }
  });
});

describe("状态派生与使用判定", () => {
  it("pending 且过期 ⇒ expired；其余原样", () => {
    expect(deriveInvitationStatus({ status: "pending", expiresAt: PAST }, NOW)).toBe("expired");
    expect(deriveInvitationStatus({ status: "pending", expiresAt: NOW }, NOW)).toBe("expired");
    expect(deriveInvitationStatus({ status: "pending", expiresAt: FUTURE }, NOW)).toBe("pending");
    expect(deriveInvitationStatus({ status: "revoked", expiresAt: FUTURE }, NOW)).toBe("revoked");
    expect(deriveInvitationStatus({ status: "accepted", expiresAt: PAST }, NOW)).toBe("accepted");
  });

  const live = { kind: "email" as const, status: "pending" as const, expiresAt: FUTURE, email: "a@x.test", viewerEmail: null };
  it("在世的邀请可用；撤销 / 过期 / 已用一律 invalid（不区分原因）", () => {
    expect(decideInvitationUse(live, NOW)).toBe("ok");
    for (const status of ["revoked", "accepted", "expired"] as const) {
      expect(decideInvitationUse({ ...live, status }, NOW)).toBe("invalid");
    }
    expect(decideInvitationUse({ ...live, expiresAt: PAST }, NOW)).toBe("invalid");
  });
  it("邮箱邀请：登录邮箱不符 ⇒ email-mismatch（忽略大小写 / 空白）；相符放行；链接邀请不看邮箱", () => {
    expect(decideInvitationUse({ ...live, viewerEmail: "b@x.test" }, NOW)).toBe("email-mismatch");
    expect(decideInvitationUse({ ...live, viewerEmail: " A@X.test " }, NOW)).toBe("ok");
    expect(decideInvitationUse({ ...live, kind: "link", email: null, viewerEmail: "anyone@y.test" }, NOW)).toBe("ok");
  });
  it("失效优先于邮箱不符（不因邮箱不符泄露「这条邀请其实还有效」）", () => {
    expect(decideInvitationUse({ ...live, status: "revoked", viewerEmail: "b@x.test" }, NOW)).toBe("invalid");
  });
});

describe("重发限频", () => {
  const row = { kind: "email" as const, status: "pending" as const, expiresAt: FUTURE, sendAttempts: 1, lastSentAt: new Date(NOW.getTime() - RESEND_COOLDOWN_MS) };
  it("冷却刚好过去 ⇒ 放行；差一毫秒 ⇒ too-soon 且给出还要等多久", () => {
    expect(decideResend(row, NOW)).toEqual({ ok: true });
    const soon = decideResend({ ...row, lastSentAt: new Date(NOW.getTime() - RESEND_COOLDOWN_MS + 1) }, NOW);
    expect(soon).toEqual({ ok: false, reason: "too-soon", retryAfterMs: 1 });
  });
  it("最多发 N 次（含首次）；到顶优先于冷却", () => {
    expect(decideResend({ ...row, sendAttempts: LIMITS.maxSendsPerInvitation - 1 }, NOW).ok).toBe(true);
    expect(decideResend({ ...row, sendAttempts: LIMITS.maxSendsPerInvitation }, NOW)).toMatchObject({ ok: false, reason: "limit-reached" });
    expect(decideResend({ ...row, sendAttempts: LIMITS.maxSendsPerInvitation, lastSentAt: NOW }, NOW)).toMatchObject({ reason: "limit-reached" });
  });
  it("链接邀请 / 已撤销 / 已接受不可重发；过期单独给 expired", () => {
    expect(decideResend({ ...row, kind: "link" }, NOW)).toMatchObject({ reason: "not-resendable" });
    expect(decideResend({ ...row, status: "revoked" }, NOW)).toMatchObject({ reason: "not-resendable" });
    expect(decideResend({ ...row, status: "accepted" }, NOW)).toMatchObject({ reason: "not-resendable" });
    expect(decideResend({ ...row, expiresAt: PAST }, NOW)).toMatchObject({ reason: "expired" });
    expect(decideResend({ ...row, status: "expired" }, NOW)).toMatchObject({ reason: "expired" });
  });
  it("列表的 canResend 忽略冷却（冷却期内按钮仍可点，点了给限频提示）", () => {
    expect(canResendIgnoringCooldown({ ...row, lastSentAt: NOW }, NOW)).toBe(true);
    expect(canResendIgnoringCooldown({ ...row, sendAttempts: LIMITS.maxSendsPerInvitation }, NOW)).toBe(false);
    expect(canResendIgnoringCooldown({ ...row, kind: "link" }, NOW)).toBe(false);
  });
});

describe("数值与角色", () => {
  it("有效期 7 天；冷却 60 秒；每条最多 5 次；每项目每天 50；一次最多 20 个邮箱", () => {
    expect(LIMITS).toEqual({ ttlDays: 7, emailsPerRequest: 20, dailyCapPerProject: 50, resendCooldownSeconds: 60, maxSendsPerInvitation: 5 });
    expect(INVITATION_TTL_MS).toBe(7 * 86_400_000);
    expect(expiresAtFrom(NOW).getTime() - NOW.getTime()).toBe(INVITATION_TTL_MS);
  });
  it("新组织成员的角色是权限最小的一档：consultant，且属于契约的组织角色枚举", () => {
    expect(INVITED_ORG_ROLE).toBe("consultant");
    expect(identity.OrgRole.options).toContain(INVITED_ORG_ROLE);
    for (const higher of ["admin", "lead", "compliance"]) expect(INVITED_ORG_ROLE).not.toBe(higher);
  });
});

describe("发信失败归类", () => {
  it("配置类 / 凭据类 ⇒ 没配好；400 / 422 ⇒ 拒收；其余 ⇒ 没发出去", () => {
    expect(classifySendError("configuration_missing")).toBe("MAIL_NOT_CONFIGURED");
    expect(classifySendError("configuration_invalid")).toBe("MAIL_NOT_CONFIGURED");
    expect(classifySendError("provider_http_401")).toBe("MAIL_NOT_CONFIGURED");
    expect(classifySendError("provider_http_403")).toBe("MAIL_NOT_CONFIGURED");
    expect(classifySendError("provider_http_400")).toBe("MAIL_RECIPIENT_REJECTED");
    expect(classifySendError("provider_http_422")).toBe("MAIL_RECIPIENT_REJECTED");
    for (const c of ["timeout", "network", "provider_http_502", "provider_http_429", "provider_invalid_response", "weird", null]) {
      expect(classifySendError(c), String(c)).toBe("MAIL_SEND_FAILED");
    }
  });
  it("归类结果总是契约枚举的成员", () => {
    for (const c of ["configuration_missing", "provider_http_400", "network", null]) {
      expect(C.ProjectInvitationSendError.options).toContain(classifySendError(c));
    }
  });
});

describe("契约：人话表完整", () => {
  it("每个 reason / send error 都有一句非空中文，且不含内部码", () => {
    for (const r of C.ProjectInvitationReason.options) {
      const t = C.PROJECT_INVITATION_REASON_TEXT[r];
      expect(t, r).toMatch(/[一-鿿]/);
      expect(t, r).not.toMatch(/[A-Z]{3,}_[A-Z_]+/);
    }
    for (const e of C.ProjectInvitationSendError.options) {
      const t = C.PROJECT_INVITATION_SEND_ERROR_TEXT[e];
      expect(t, e).toMatch(/[一-鿿]/);
      expect(t, e).not.toMatch(/[A-Z]{3,}_[A-Z_]+/);
    }
  });
  it("限频文案里的数字取自 LIMITS，不另写一份", () => {
    expect(C.PROJECT_INVITATION_REASON_TEXT.RESEND_LIMIT_REACHED).toContain(String(LIMITS.maxSendsPerInvitation));
    expect(C.PROJECT_INVITATION_REASON_TEXT.DAILY_CAP_REACHED).toContain(String(LIMITS.dailyCapPerProject));
    expect(C.PROJECT_INVITATION_REASON_TEXT.RESEND_TOO_SOON).toContain(String(LIMITS.resendCooldownSeconds));
  });
});

describe("邀请邮件正文", () => {
  it("带项目名 / 邀请人 / 接受链接（invite 参数）/ 北京时间过期时间", () => {
    const mail = buildInvitationMail({
      projectName: "北极星项目",
      inviterName: "负责人甲",
      appPublicUrl: "https://app.test/",
      token: "abc_DEF-123",
      expiresAt: new Date("2026-10-07T10:30:00Z"),
    });
    expect(mail.subject).toBe("负责人甲 邀请你加入项目「北极星项目」");
    expect(mail.text).toContain("https://app.test/projects/join?invite=abc_DEF-123");
    expect(mail.text).not.toContain("?t=");
    expect(mail.text).toContain("2026年10月7日 18:30（北京时间）");
  });
  it("名字里的换行不能注入邮件主题", () => {
    const mail = buildInvitationMail({
      projectName: "P\r\nBcc: evil@x.test",
      inviterName: "A\nB",
      appPublicUrl: "https://app.test",
      token: "t",
      expiresAt: NOW,
    });
    expect(mail.subject).not.toMatch(/[\r\n]/);
  });
  it("接受链接：去掉站点根地址末尾的斜杠；令牌做 URL 编码", () => {
    expect(buildInviteUrl("https://a.test///", "x y")).toBe("https://a.test/projects/join?invite=x%20y");
  });
  it("北京时间跨日：UTC 17:00 ⇒ 次日 01:00", () => {
    expect(formatBeijingTime(new Date("2026-12-31T17:00:00Z"))).toBe("2027年1月1日 01:00（北京时间）");
  });
  it("被加入项目的通知文案", () => {
    expect(buildMemberAddedNotice({ projectName: "P", inviterName: "甲", role: "collaborator" })).toEqual({
      title: "你已被加入项目「P」",
      body: "甲 把你加入了项目「P」，你的身份是协作者。",
    });
    expect(buildMemberAddedNotice({ projectName: "P", inviterName: "甲", role: "owner" }).body).toContain("负责人");
  });
});
