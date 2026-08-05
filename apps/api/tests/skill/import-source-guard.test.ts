/**
 * #595 —— URL 导入的两道门：**字面量门**与**解析后门**。
 *
 * ## 这个文件挡的是一个今天完全没有防护的面
 *
 * 勘探时我曾断言「走 `infrastructure/egress` 就能挡 SSRF」。实测推翻：
 * `local-egress-guard.ts` 只在 `runLocalOnly` 的 `AsyncLocalStorage` 作用域内生效，
 * **作用域外它什么都不做**（该文件头逐字写着，并预言了「读者会被一个绿测试误导」）。
 * ⇒ URL 导入的 SSRF 面是本 issue **真实新增**的，没有任何现成东西挡它。
 *
 * ## 每条「拒」都配一条「放」——否则恒拒实现全绿
 *
 * 一个 `throw new Error()` 开头的实现会让只有负样本的文件全绿。所以每一组负样本
 * 旁边都有**同一个函数、同一条调用路径**、只换输入的正样本，且正样本断言到
 * **真的返回了规范化结果**（不是「没抛」而已）。
 *
 * ⚠ 特别提防两种今天本来就绿的假门：
 *   · 只断言「抛了个错」——恒拒实现照样绿。这里一律断言到 **`code` 的具体取值**。
 *   · 只断言「不是 public」——`not-an-ip` 也不是 public。第二道门那组因此
 *     断言到 `blocked` / 抛错，而不是 `!== "public"`。
 *
 * ## 反证（做法与结果见 PR 正文）
 *
 * ① `classifyAddress` 的 `ipv4Blocked` 改成 `return false`（恒放行）
 *    ⇒「私网/元数据/loopback 必须拒」那几条当场红，且红在 `toThrow` / `toBe("blocked")`，
 *      而正样本（公网 IPv4、公网域名）保持绿。
 * ② 删掉 IPv4-mapped 拆包那一支
 *    ⇒ 只有 `::ffff:127.0.0.1` 那条红——这正是最容易漏的一条，单独可证。
 * ③ `normalizedPath` 改成 `return path`（恒放行）
 *    ⇒ 穿越那组红，而合法路径那条保持绿。
 */
import { describe, expect, it } from "vitest";
import {
  ImportSourceRefusedError,
  assertImportUrlAllowed,
  assertResolvedAddressAllowed,
  classifyAddress,
} from "../../src/domain/skill/import-source";
import { InvalidSkillStarterPackError, normalizedPath } from "../../src/domain/skill/starter-pack";

const OPEN: { readonly localOnlyOrg: boolean } = { localOnlyOrg: false };

/** 断言到**具体错误码**，而不是「抛了个错」。 */
function refusalCode(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof ImportSourceRefusedError) return error.code;
    throw error;
  }
  throw new Error("expected ImportSourceRefusedError, nothing was thrown");
}

describe("第一道门：URL 字面量", () => {
  it("正样本：普通 https 公网地址放行，并返回规范化 URL", () => {
    const url = assertImportUrlAllowed("https://example.com/skills/pack.zip", OPEN);
    expect(url.hostname).toBe("example.com");
    expect(url.protocol).toBe("https:");
  });

  it("只允许 https —— http/file/data/ftp 全拒", () => {
    for (const raw of [
      "http://example.com/p.zip",
      "file:///etc/passwd",
      "ftp://example.com/p.zip",
      "data:text/plain,hi",
    ]) {
      expect(refusalCode(() => assertImportUrlAllowed(raw, OPEN))).toBe(
        "IMPORT_URL_SCHEME_FORBIDDEN",
      );
    }
  });

  it("URL 内嵌凭据一律拒（否则凭据会进日志与审计）", () => {
    expect(refusalCode(() => assertImportUrlAllowed("https://u:pw@example.com/p", OPEN))).toBe(
      "IMPORT_URL_CREDENTIALS_FORBIDDEN",
    );
  });

  it("不是绝对 URL ⇒ MALFORMED（与「被策略拒绝」区分开）", () => {
    expect(refusalCode(() => assertImportUrlAllowed("not a url", OPEN))).toBe(
      "IMPORT_URL_MALFORMED",
    );
  });

  /**
   * personal-local 组织：拒绝必须发生在**应用层**。
   * 让它掉到 socket 层会变成一个看不懂的连接错误——这条断言锁的就是「错误可读」。
   */
  it("personal-local 组织：提前拒绝，且错误码指明原因", () => {
    expect(refusalCode(() => assertImportUrlAllowed("https://example.com/p", { localOnlyOrg: true })))
      .toBe("IMPORT_URL_FORBIDDEN_FOR_LOCAL_ORG");
    // 正样本：同一个 URL，非 local 组织 ⇒ 放行。证明拒绝来自组织策略而非 URL 本身。
    expect(assertImportUrlAllowed("https://example.com/p", OPEN).hostname).toBe("example.com");
  });

  /**
   * WHATWG URL 会把十进制/八进制/十六进制/短式 IPv4 规范化成点分四段
   * （实测：`http://2130706433/` ⇒ hostname `127.0.0.1`）。
   * 这条锁住「混淆写法不能绕过」——依赖的是规范化行为，所以值得单独证。
   */
  it("混淆写法的 loopback 仍被拒", () => {
    for (const host of ["2130706433", "0x7f000001", "017700000001", "127.1", "127.0.0.1."]) {
      expect(refusalCode(() => assertImportUrlAllowed(`https://${host}/p`, OPEN))).toBe(
        "IMPORT_URL_HOST_NOT_PUBLIC",
      );
    }
  });
});

describe("地址分类", () => {
  it("正样本：公网地址判 public", () => {
    for (const address of ["1.1.1.1", "93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"]) {
      expect(classifyAddress(address)).toBe("public");
    }
  });

  it("云元数据地址判 blocked（169.254.169.254 是最常被利用的一个）", () => {
    expect(classifyAddress("169.254.169.254")).toBe("blocked");
  });

  it("loopback / 私网 / CGNAT / link-local / 组播 / 保留段判 blocked", () => {
    for (const address of [
      "127.0.0.1", "0.0.0.0", "10.1.2.3", "172.16.0.1", "172.31.255.255",
      "192.168.1.1", "100.64.0.1", "169.254.1.1", "198.18.0.1",
      "224.0.0.1", "255.255.255.255",
    ]) {
      expect(classifyAddress(address)).toBe("blocked");
    }
  });

  it("172.32/172.15 不在 RFC1918 内 ⇒ public（证明边界没有多拒）", () => {
    expect(classifyAddress("172.15.0.1")).toBe("public");
    expect(classifyAddress("172.32.0.1")).toBe("public");
  });

  it("IPv6 loopback / ULA / link-local / 组播判 blocked", () => {
    for (const address of ["::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1"]) {
      expect(classifyAddress(address)).toBe("blocked");
    }
  });

  /**
   * 最容易漏的一条：WHATWG URL 把 `::ffff:127.0.0.1` 规范化成 `::ffff:7f00:1`。
   * 一个只比对字符串的实现会当它是陌生的公网 IPv6 **放行**。
   */
  it("IPv4-mapped IPv6 必须拆开看内层 —— 含 URL 规范化后的十六进制形态", () => {
    expect(classifyAddress("::ffff:127.0.0.1")).toBe("blocked");
    expect(classifyAddress("::ffff:7f00:1")).toBe("blocked");
    expect(classifyAddress("[::ffff:a9fe:a9fe]")).toBe("blocked"); // 169.254.169.254
    // 正样本：映射的是公网地址 ⇒ public。证明不是「凡 mapped 皆拒」。
    expect(classifyAddress("::ffff:1.1.1.1")).toBe("public");
  });

  it("域名判 not-an-ip —— ⚠ 这不等于安全，只表示要等第二道门", () => {
    expect(classifyAddress("example.com")).toBe("not-an-ip");
  });
});

describe("第二道门：DNS 解析之后", () => {
  it("正样本：解析到公网地址 ⇒ 放行", () => {
    expect(() => assertResolvedAddressAllowed("1.1.1.1")).not.toThrow();
  });

  /**
   * DNS rebinding：字面量是域名（第一道门放行），解析结果却是元数据地址。
   * 这一组证明第二道门确实拦得住第一道门放行的东西。
   */
  it("第一道门放行的域名，解析到内网时被第二道门拒", () => {
    expect(assertImportUrlAllowed("https://evil.example/p", OPEN).hostname).toBe("evil.example");
    expect(refusalCode(() => assertResolvedAddressAllowed("169.254.169.254"))).toBe(
      "IMPORT_URL_HOST_NOT_PUBLIC",
    );
  });

  it("解析结果不是 IP ⇒ 拒（这里没有 not-an-ip 的宽容分支）", () => {
    expect(refusalCode(() => assertResolvedAddressAllowed("example.com"))).toBe(
      "IMPORT_URL_HOST_NOT_PUBLIC",
    );
  });
});

describe("上传/编辑的路径穿越 —— 复用 starter-pack 的同一份判定", () => {
  it("正样本：合法包内路径原样返回", () => {
    expect(normalizedPath("SKILL.md")).toBe("SKILL.md");
    expect(normalizedPath("scripts/run.py")).toBe("scripts/run.py");
  });

  it("穿越 / 绝对路径 / 反斜杠 / NUL 一律拒", () => {
    for (const path of [
      "../etc/passwd", "a/../../b", "/etc/passwd",
      "a\\b", "a\0b", ".", "./a",
    ]) {
      expect(() => normalizedPath(path)).toThrow(InvalidSkillStarterPackError);
    }
  });
});
