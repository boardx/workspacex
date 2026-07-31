/**
 * 从传输层元数据派生「设备」与「登录地点」—— F03 / org-admin `DeviceSession` 的两个字段。
 *
 * ## 为什么这两个值不在 `login` 的请求体里
 *
 * phase-00 已签核的 `auth.operations.login.in` 是 `{ email, password }` 且 `.strict()`。
 * 往里加 `device` 就是**让客户端自报设备**——一个可以随便填的字段，写进「你的登录设备」
 * 列表后会被用户当成事实读。所以两个值都只从**服务端能看见的传输元数据**派生：
 * `User-Agent` 头与对端地址。客户端仍然可以伪造 UA，但那是它自己的会话、自己的列表，
 * 骗不到别人；而多加一个契约字段会让**任何人**在自己的行里写任意文本。
 *
 * ## ⚠ `location` 不是地理定位，而且刻意不是
 *
 * 契约把它写成 `z.string().nullable()`，`domain.md` 只说 `location`，没有说「城市/国家」。
 * 把 IP 变成城市需要一次**对外查询**——而这正是 phase-00 X-3 管着的 egress：
 * 本地组织路径承诺零出站流量，`usecases.md` 第六节的端口表里也**没有任何 geo 供应商**
 * （`SmsSender` / `MailSender` 都还标着 `[待确认]`）。
 * 凭空接一个 geo-IP 服务 = 加一条没人签核过的出站依赖。
 *
 * ⇒ 这里只回答「这次登录从哪个网络来」，用**本机能确定**的信息：回环 / 私网 / 公网地址本身。
 *    它是真话且成本为零。要真正的地理位置，得先有人签核一个 egress 供应商。
 *
 * ## 纯函数，零依赖
 *
 * `domain` 层不 import 任何外层（`lint-arch-deps`）。这里也没有理由 import：
 * 两个函数都是「字符串进、字符串出」，因此**可以逐条断言**，而不是靠跑起整个应用去观察。
 */

/** 一次登录的传输层上下文。由 `interface` 层从请求头/连接上读出，`application` 只是搬运。 */
export interface DeviceContext {
  /** 人可读的设备标签。恒非空——「说不出是什么」也要说出来，见 `UNKNOWN_DEVICE`。 */
  readonly device: string;
  /** 网络来源。null = 连对端地址都没有（不是「未知城市」）。 */
  readonly location: string | null;
}

/**
 * ⚠ 恒非空的兜底值。
 *
 * 不用空串：空串在列表里渲染成一行没有名字的设备，用户无法把它和另一行空串区分开，
 * 于是「踢哪一个」这个动作失去依据——而踢错设备是不可撤销的。
 */
export const UNKNOWN_DEVICE = "未知设备";

/**
 * 平台识别规则表。**有序**，第一条命中即返回。
 *
 * 顺序是规则的一部分，不是风格：`Edg/` 必须排在 `Chrome/` 前面（Edge 的 UA 里两者都有），
 * `Chrome/` 必须排在 `Safari/` 前面（Chrome 的 UA 里两者都有）。
 * 把它写成有序表而不是一串 if，是为了让「顺序错了」这件事在 review 时看得见。
 */
const BROWSERS: readonly (readonly [RegExp, string])[] = [
  [/Edg\//, "Edge"],
  [/OPR\/|Opera/, "Opera"],
  [/Firefox\//, "Firefox"],
  [/Chrome\/|CriOS\//, "Chrome"],
  [/Safari\//, "Safari"],
];

const PLATFORMS: readonly (readonly [RegExp, string])[] = [
  [/iPhone|iPod/, "iPhone"],
  [/iPad/, "iPad"],
  [/Android/, "Android"],
  [/Mac OS X|Macintosh/, "macOS"],
  [/Windows/, "Windows"],
  [/Linux|X11/, "Linux"],
];

function firstMatch(ua: string, table: readonly (readonly [RegExp, string])[]): string | null {
  for (const [re, label] of table) if (re.test(ua)) return label;
  return null;
}

/**
 * `User-Agent` → 「Chrome on macOS」这样的标签。
 *
 * ⚠ 刻意**不带版本号**。带上版本，同一台机器每次浏览器自动更新都会在列表里长出一行新设备，
 * 而「设备与会话」这块能力的全部用处是让用户认出**哪一台**——多出来的行只会让人无从下手。
 *
 * 认不出来时返回 `UNKNOWN_DEVICE`，**不返回原始 UA**：原始 UA 是一长串带版本号的字符串，
 * 放进界面等于把「认不出来」伪装成「这就是设备名」。
 */
export function describeDevice(userAgent: string | null | undefined): string {
  const ua = (userAgent ?? "").trim();
  if (ua.length === 0) return UNKNOWN_DEVICE;
  const browser = firstMatch(ua, BROWSERS);
  const platform = firstMatch(ua, PLATFORMS);
  if (browser !== null && platform !== null) return `${browser} on ${platform}`;
  if (platform !== null) return platform;
  if (browser !== null) return browser;
  return UNKNOWN_DEVICE;
}

/** IPv4 私网段 + IPv6 唯一本地/链路本地。判据是 RFC1918 / RFC4193 / RFC4291，不是习惯。 */
function isPrivate(ip: string): boolean {
  if (/^10\./.test(ip)) return true;
  if (/^192\.168\./.test(ip)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(ip)) return true;
  // IPv6 唯一本地地址 fc00::/7，链路本地 fe80::/10。
  if (/^f[cd][0-9a-f]{2}:/i.test(ip)) return true;
  if (/^fe[89ab][0-9a-f]:/i.test(ip)) return true;
  return false;
}

/**
 * 对端地址 → 「登录地点」。⚠ 见文件头：这是**网络来源**，不是地理位置。
 *
 * - 无地址 → `null`。契约把这一列写成 nullable 正是为了容纳「不知道」，
 *   而 `"未知"` 这种字符串会被下游当成一个真实取值去分组。
 * - 回环 → `本机`
 * - 私网 → `内网 (<ip>)`
 * - 其余 → 地址本身
 *
 * ⚠ `x-forwarded-for` 的取舍不在这里：那是 `interface` 层的协议问题（该信哪一跳取决于
 * 部署里有几层代理），这里只对「已经定下来的那个地址」下结论。
 */
export function describeLoginOrigin(ip: string | null | undefined): string | null {
  const raw = (ip ?? "").trim();
  if (raw.length === 0) return null;
  // Node 在双栈监听下会把 IPv4 写成 `::ffff:127.0.0.1`。不剥掉前缀，回环会被当成公网地址。
  const addr = raw.replace(/^::ffff:/i, "");
  if (addr === "127.0.0.1" || addr === "::1" || /^127\./.test(addr)) return "本机";
  if (isPrivate(addr)) return `内网 (${addr})`;
  return addr;
}
