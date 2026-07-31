/**
 * F03：从一个 HTTP 请求里读出「设备」与「登录地点」。
 *
 * 协议适配，仅此而已——**判断在 `domain/auth/device-fingerprint.ts`**，
 * 这里只负责决定「拿哪个头、哪个地址」交给它。分开是因为这两件事的
 * 变化理由不同：UA 怎么归类是产品判断，该信哪一跳是部署事实。
 */
import {
  describeDevice,
  describeLoginOrigin,
  type DeviceContext,
} from "../domain/auth/device-fingerprint";

/**
 * 结构化最小面，而不是 `express.Request`。
 *
 * 这三样是本文件用到的**全部**。写成结构类型让这个函数可以被一个字面量对象直接测——
 * 不用起 Nest、不用造 express 请求，于是「XFF 不被信任」这条能被逐条断言而不是靠观察。
 */
export interface RequestLike {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly ip?: string;
  readonly socket?: { readonly remoteAddress?: string | null };
}

function firstHeader(v: string | string[] | undefined): string | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

/**
 * ⚠ **`X-Forwarded-For` 被刻意忽略。**
 *
 * 它是**客户端可写的头**。信它，任何人都能让自己的登录记录显示成任意地址——
 * 而这一列的全部用处是让用户认出「这次登录不是我」。一个可以由攻击者填写的
 * 「登录地点」比没有这一列更糟：它会让人放心。
 *
 * 要正确地信它，需要先定下「前面有几层代理、哪一跳可信」，那是部署事实，
 * 本仓没有任何地方声明过（`main.ts` 也没有开 express 的 `trust proxy`）。
 * ⇒ 在有人把这件事写下来并签核之前，只用连接的对端地址。
 *   代价是**上线到反向代理后面时这一列会全变成代理的内网地址**——
 *   这是可见的、可被发现的错，而不是可被伪造的假数据。登记在 issue #55 上。
 */
export function deviceContextOf(req: RequestLike): DeviceContext {
  const ua = firstHeader(req.headers["user-agent"]);
  const addr = req.ip ?? req.socket?.remoteAddress ?? null;
  return { device: describeDevice(ua), location: describeLoginOrigin(addr) };
}
