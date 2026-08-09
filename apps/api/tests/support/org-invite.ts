/**
 * F10 测试的端口替身。
 *
 * ⚠ 只替换**与被测不变量无关**的端口：会话存储（Redis）与 id 工厂。
 * 数据库不替——I-1（同一事务）与 I-2（服务端为准）只在真实事务里可能失败，
 * 内存假件会把它们测成「代码形状对不对」，而那两条正好都不是形状问题。
 *
 * 口令哈希也是假的，理由与上一句相反：本 feature 里没有任何一条不变量是关于哈希强度的
 * （那是 phase-00 I-2 的事，`password-hash-invariant.test.ts` 用真 bcrypt 守着），
 * 而真 bcrypt cost-12 会给这套测试的每一次激活加几百毫秒。
 */
import type { PasswordHasher, SessionTokenStore, TokenFactory } from "../../src/application/auth/ports";
import type { SessionRecord } from "../../src/domain/auth/session-lifetime";
import type { UntrustedLinkClaims } from "../../src/domain/auth/org-invite";

/** 三个 null = 链接里什么都没带。「没说」不是「说错了」。 */
export const NO_CLAIMS: UntrustedLinkClaims = { orgId: null, orgRole: null, teamId: null };

/**
 * ⚠ `canned` 必须过 `credentials` 表上那条「口令必须是慢哈希」的 CHECK（迁移 0010），
 * 否则这里的每一次 INSERT 都会因为一条与本 feature 无关的约束而失败。
 * 值取自一个真实的 bcrypt cost-12 输出，只是不再当场算。
 */
const CANNED_HASH = "$2b$12$abcdefghijklmnopqrstuu5Q3nJ0G5x4c1oV1YyBpJ0N0m3nJ4dEa";

export const fakeHasher: PasswordHasher & { canned: string } = {
  canned: CANNED_HASH,
  hash: async () => CANNED_HASH,
  verify: async () => true,
  verifyDummy: async () => false as const,
};

export function fakeSessions(): SessionTokenStore & { issued: SessionRecord[] } {
  const issued: SessionRecord[] = [];
  return {
    issued,
    issue: async (r) => {
      issued.push(r);
      return `tok-${r.id}`;
    },
    findByToken: async () => null,
    revokeAllForUser: async () => 0,
    // #638 delta，迭代 2：同 `revokeAllForUser`，最小诚实实现（恒 0），本文件的断言
    // 不关心改密码这条路径。
    revokeAllForUserExcept: async () => 0,
    listForUser: async () => issued,
    setCurrentOrg: async () => true,
    // F03。这个 fake 只服务于「激活时签发了几条会话」这一类断言，
    // 所以两个新方法给的是**最小诚实实现**而不是 `null as any`：
    // 一个 fake 里的 `any` 会让将来某条真正依赖它的断言在假数据上变绿。
    revokeSession: async () => null,
    touch: async () => undefined,
  } as SessionTokenStore & { issued: SessionRecord[] };
}

export function fakeTokens(): TokenFactory {
  let n = 0;
  return {
    // ⚠ 递增，且**只在测试里**递增。生产实现是不是计数器由
    // phase-00 的 `TokenFactory` 自己的测试守着，不在这里重复一遍。
    sessionId: () => `sess-f10-${++n}`,
    opaqueToken: () => `opaque-f10-${++n}`,
  };
}
