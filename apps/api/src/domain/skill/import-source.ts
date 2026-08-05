/**
 * #595 —— 从**外部 URL** 导入 Agent/Skill 定义时，「这个地址允许被服务端请求吗」。
 *
 * ## 为什么这个文件必须存在（而不是复用 egress guard）
 *
 * 勘探阶段我曾断言「URL 导入走 `infrastructure/egress` 就能挡 SSRF」。**这是错的**，
 * 而且 `local-egress-guard.ts` 的文件头逐字预言了这次误读：
 *
 *   > Outside `runLocalOnly` the guard counts nothing and blocks nothing -- a real
 *   > organization's traffic is normal traffic. **Stated here because a reader who
 *   > assumed the broader claim would be misled by a green test.**
 *
 * 那个 guard 是**进程级承诺执行器**，作用域由 `AsyncLocalStorage` 划定：
 *   · 在 `runLocalOnly` 内 → 非 loopback 一律拒（连 LAN 也拒），这是 I-9 承诺；
 *   · 在 `runLocalOnly` 外 → **它什么都不做**。
 *
 * ⇒ 两条方向相反的结论，都落在本文件上：
 *   ① personal-local 组织：URL 导入**必然被拒**（socket 层）。与其让它掉到 socket 层
 *      变成一个看不懂的连接错误，不如在应用层**提前拒绝并给出清晰错误**
 *      （`IMPORT_URL_FORBIDDEN_FOR_LOCAL_ORG`）。
 *   ② 普通组织：guard **不提供任何 SSRF 防护** ⇒ SSRF 面是本 issue 真实新增的，
 *      今天没有任何现成东西挡它。本文件就是那个「挡它的东西」。
 *
 * ⛔ **不要把 `runLocalOnly` 拿来当 SSRF 防护用** —— 它拒绝一切非 loopback，
 *    包一层会让普通组织的 URL 导入**全部失败**。
 *
 * ## 分两阶段，因为 DNS 会在两次之间改主意
 *
 * `assertImportUrlAllowed` 只能看**字面量**：协议、凭据、以及 host 本身就是 IP 的情况。
 * 一个 `http://evil.example/` 在这一步是「看起来公网」，解析出来却可能是 `169.254.169.254`。
 * 所以必须有第二道 `assertResolvedAddressAllowed`，由 infrastructure 在 **DNS 解析之后、
 * 连接之前**对每一个候选地址调用，且**每一跳重定向都要重来一次**。
 *
 * ⚠ 只有第一道 = DNS rebinding 直接绕过；只有第二道 = `file://` / 凭据泄露绕过。
 *   两道都要，且第二道必须由**真正发起连接的那一层**调用——本文件挡不住一个
 *   不调用它的 fetch。这条限制是真实的，写在这里免得读者以为 import 了就安全。
 */
import net from "node:net";

export type ImportSourceRefusalCode =
  /** 不是一个能解析的绝对 URL */
  | "IMPORT_URL_MALFORMED"
  /** 只允许 https：http 明文、file://、ftp://、gopher://、data: 一律拒 */
  | "IMPORT_URL_SCHEME_FORBIDDEN"
  /** URL 里内嵌凭据（`https://user:pw@host/`）——会把凭据写进日志与审计 */
  | "IMPORT_URL_CREDENTIALS_FORBIDDEN"
  /** 目标地址不在公网（loopback / 私网 / link-local / 云元数据 / 组播 / 保留段） */
  | "IMPORT_URL_HOST_NOT_PUBLIC"
  /** personal-local 组织：出站承诺（I-9）不允许任何 URL 导入 */
  | "IMPORT_URL_FORBIDDEN_FOR_LOCAL_ORG";

export class ImportSourceRefusedError extends Error {
  constructor(readonly code: ImportSourceRefusalCode) {
    super(`import source refused: ${code}`);
    this.name = "ImportSourceRefusedError";
  }
}

/**
 * 地址分类的三态。
 *
 * ⚠ `not-an-ip` **不等于安全**——它只表示「字面量不是 IP，得等 DNS」。
 *   把它当放行会让每一个域名都绕过本模块，这正是第二道门存在的理由。
 */
export type AddressClass = "public" | "blocked" | "not-an-ip";

function ipv4Blocked(octets: readonly number[]): boolean {
  const [a, b] = octets as [number, number, number, number];
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // RFC1918
  if (a === 127) return true; // loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
  if (a === 169 && b === 254) return true; // link-local —— 含 169.254.169.254 云元数据
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 0) return true; // 192.0.0/24 IETF protocol assignments
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18/15 benchmarking
  if (a >= 224) return true; // 224/4 组播 + 240/4 保留 + 255.255.255.255
  return false;
}

function parseIpv4(host: string): readonly number[] | null {
  if (!net.isIPv4(host)) return null;
  return host.split(".").map((part) => Number(part));
}

/**
 * 8 个 16 位组。用元组而不是 `number[]`，是为了让 `noUncheckedIndexedAccess`
 * 下的每一次 `groups[i]` 都是 `number` 而不是 `number | undefined`——
 * 否则每个判定都要挂一个 `?? 0`，而 `?? 0` 会把「解析失败」悄悄变成「::」。
 */
type Ipv6Groups = readonly [number, number, number, number, number, number, number, number];

/** 把 IPv6 展开成 8 个 16 位组；`net.isIPv6` 已经保证了语法。 */
function expandIpv6(host: string): Ipv6Groups | null {
  if (!net.isIPv6(host)) return null;
  let text = host;

  // 尾部可能是点分 IPv4（`::ffff:127.0.0.1`），先换算成两组十六进制。
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  const dotted = tail?.[1];
  if (tail && dotted !== undefined) {
    const quad = parseIpv4(dotted);
    if (quad === null || quad.length !== 4) return null;
    const [a = 0, b = 0, c = 0, d = 0] = quad;
    text = `${text.slice(0, tail.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }

  const parts = text.split("::");
  if (parts.length > 2) return null;
  const toGroups = (segment: string | undefined): number[] =>
    segment === undefined || segment === "" ? [] : segment.split(":").map((g) => parseInt(g, 16));
  const left = toGroups(parts[0]);
  const right = parts.length === 2 ? toGroups(parts[1]) : [];

  const full = parts.length === 1 ? left : [...left, ...Array<number>(8 - left.length - right.length).fill(0), ...right];
  if (full.length !== 8 || full.some((g) => !Number.isInteger(g))) return null;
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = full;
  return [g0, g1, g2, g3, g4, g5, g6, g7];
}

/**
 * 判定一个**字面量地址**是否属于公网。
 *
 * ⚠ IPv4-mapped / IPv4-compatible / NAT64 必须**拆开看内层 IPv4**：
 *   `::ffff:127.0.0.1` 经 WHATWG URL 规范化后长成 `::ffff:7f00:1`，
 *   一个只比对字符串的实现会当它是陌生的公网 IPv6 放行。
 */
export function classifyAddress(rawHost: string): AddressClass {
  const host = rawHost.replace(/^\[|\]$/g, "").toLowerCase();

  const v4 = parseIpv4(host);
  if (v4) return ipv4Blocked(v4) ? "blocked" : "public";

  const groups = expandIpv6(host);
  if (groups === null) return "not-an-ip";
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups;

  const isZeroPrefix = (count: number): boolean =>
    groups.slice(0, count).every((group) => group === 0);

  // ::1 loopback 与 :: unspecified
  if (isZeroPrefix(7) && (g7 === 1 || g7 === 0)) return "blocked";

  const innerV4 = (hi: number, lo: number): AddressClass =>
    ipv4Blocked([hi >> 8, hi & 0xff, lo >> 8, lo & 0xff]) ? "blocked" : "public";

  // ::ffff:a.b.c.d（IPv4-mapped）与 ::a.b.c.d（IPv4-compatible，已废弃但仍会被解析）
  if (isZeroPrefix(5) && g5 === 0xffff) return innerV4(g6, g7);
  if (isZeroPrefix(6)) return innerV4(g6, g7);
  // 64:ff9b::/96 NAT64 —— 内层同样是一个 IPv4，同样要拆开看
  const nat64 = g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0;
  if (nat64) return innerV4(g6, g7);

  if ((g0 & 0xfe00) === 0xfc00) return "blocked"; // fc00::/7 ULA
  if ((g0 & 0xffc0) === 0xfe80) return "blocked"; // fe80::/10 link-local
  if ((g0 & 0xff00) === 0xff00) return "blocked"; // ff00::/8 组播
  return "public";
}

export interface ImportUrlPolicy {
  /**
   * 该组织是否处于 personal-local 出站承诺下（I-9）。
   *
   * ⚠ 为 true 时**一律拒绝**，且拒绝发生在应用层而非 socket 层——理由见文件头 ①。
   */
  readonly localOnlyOrg: boolean;
}

/**
 * 第一道门：只看字面量。返回**规范化后**的 URL，供调用方继续用。
 *
 * ⚠ 通过这道门**不代表可以连**。host 是域名时本函数返回 `not-an-ip` 那一支，
 *   真正的判定在 `assertResolvedAddressAllowed`。
 */
export function assertImportUrlAllowed(raw: string, policy: ImportUrlPolicy): URL {
  if (policy.localOnlyOrg) {
    throw new ImportSourceRefusedError("IMPORT_URL_FORBIDDEN_FOR_LOCAL_ORG");
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ImportSourceRefusedError("IMPORT_URL_MALFORMED");
  }

  if (url.protocol !== "https:") {
    throw new ImportSourceRefusedError("IMPORT_URL_SCHEME_FORBIDDEN");
  }
  if (url.username !== "" || url.password !== "") {
    throw new ImportSourceRefusedError("IMPORT_URL_CREDENTIALS_FORBIDDEN");
  }
  if (classifyAddress(url.hostname) === "blocked") {
    throw new ImportSourceRefusedError("IMPORT_URL_HOST_NOT_PUBLIC");
  }
  return url;
}

/**
 * 第二道门：DNS 解析之后、连接之前，对**每一个候选地址**调用，
 * 并且**每一跳重定向都要重来一次**。
 *
 * ⚠ 这里没有 `not-an-ip` 的宽容分支：解析结果不是 IP 就是出了别的错，一律拒。
 */
export function assertResolvedAddressAllowed(address: string): void {
  if (classifyAddress(address) !== "public") {
    throw new ImportSourceRefusedError("IMPORT_URL_HOST_NOT_PUBLIC");
  }
}
