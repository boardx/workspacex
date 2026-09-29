/**
 * 回环/开发/CI 栈专用：让 run 快照里 pin 的**其它** provider 名（如官方数字人角色包的
 * `dashscope`）也路由到本进程已配置的那个 chat provider。
 *
 * 为什么需要：官方角色包钉死了生产用的 provider 名（生产**确实**配了它，不能改角色）。
 * 回环栈只配了一个回环 provider，于是这些 agent 的 run 一律 `MODEL_PROVIDER_NOT_CONFIGURED`。
 *
 * 生产隔离（两道闸，缺一不生效）：
 *   1. 必须显式设置 `KERNEL_LOOPBACK_PROVIDER_ALIASES`（逗号分隔）；缺省为空 ⇒ 什么都不加；
 *   2. 已配置 chat provider 的 `KERNEL_MODEL_BASE_URL` 的 hostname 必须是回环地址
 *      （127.0.0.1 / localhost / ::1）。指向任何真实远端 ⇒ 忽略别名，不改变生产路由。
 * 别名**不覆盖**已注册的 provider 名（例如生产真配了 dashscope 时它永远走真实端口）。
 */
export function isLoopbackBaseUrl(baseUrl: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(baseUrl).hostname;
  } catch {
    return false;
  }
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]" || hostname === "::1";
}

export function readLoopbackProviderAliases(
  env: NodeJS.ProcessEnv,
  chatConfig: { readonly provider: string; readonly baseUrl: string },
): readonly string[] {
  const raw = (env.KERNEL_LOOPBACK_PROVIDER_ALIASES ?? "").trim();
  if (raw === "" || chatConfig.provider === "" || !isLoopbackBaseUrl(chatConfig.baseUrl)) return [];
  const aliases = raw.split(",").map((s) => s.trim()).filter((s) => s !== "" && s !== chatConfig.provider);
  return [...new Set(aliases)];
}

/** 把别名追加到路由表：已存在的名字一律保留原端口。 */
export function withLoopbackProviderAliases<P>(
  entries: ReadonlyArray<readonly [string, P]>,
  aliases: readonly string[],
  loopbackPort: P,
): Array<readonly [string, P]> {
  const taken = new Set(entries.map(([name]) => name));
  return [...entries, ...aliases.filter((a) => !taken.has(a)).map((a) => [a, loopbackPort] as const)];
}
