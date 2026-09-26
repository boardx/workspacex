/**
 * 执行过程里那些「它到底打开了哪个网页」——把工具参数里的地址挑出来，并判它能不能当链接画。
 *
 * ## 为什么需要这一层（2026-09-23）
 *
 * 人类交办里点名了「浏览网页」。现在 `fetch_url` / `browser_navigate` 抓回来的东西
 * 只剩**正文文本**：折叠行上是 `打开网页 · example.com`（只有域名，`toolObject`
 * 刻意截到 host），完整地址埋在「技术细节」里那段 JSON 的第二层折叠下，而且**不可点**。
 * 用户想核对「这段结论是从哪一页来的」，要展开两层再去 JSON 里用眼睛找。
 *
 * ## 为什么不直接把 args.url 塞进 `<a href>`
 *
 * 这个地址来自**模型写的工具参数**，不是我们的代码。`javascript:` / `data:` / `file:`
 * 都能写进去，渲染成可点链接就是一条注入路径——正文那边由 `rehype-sanitize` 挡着
 * （见 `markdown-message.tsx` 文件头），而这条路径是我新画的，没有那层清洗，
 * 必须自己判。只放行 http/https，其余一律返回 `null` 由调用方退回「不可点」。
 *
 * ⚠ 与 `packages/contracts` 的 `parseCloudUrl` **不是同一件事实**，别合并：那条判的是
 * 「这个地址能不能当部署目标」（还要拒绝带凭据的 URL），这条判的是「这个地址能不能
 * 渲染成一条给用户点的外链」。两者放行集合不同，合成一个会在其中一边判错。
 */

/** 可以渲染成外链的协议。只有这两个——其余（javascript/data/file/blob）一律不放行。 */
const RENDERABLE_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * 判一个地址能不能当外链画出来。
 *
 * @returns 规范化后的绝对地址；不是合法 http(s) 绝对地址时返回 `null`——**不猜**、
 *   不给它补 `https://` 前缀。补前缀等于替模型决定它想访问哪台主机。
 */
export function externalHttpUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  let parsed: URL;
  try { parsed = new URL(raw.trim()); } catch { return null; }
  return RENDERABLE_PROTOCOLS.has(parsed.protocol) ? parsed.toString() : null;
}

/**
 * 从工具参数里挑出这次调用访问的那个地址。
 *
 * 键名与 `toolObject` 的 `pick("url", "href")` 保持一致——折叠行上显示的域名与这里
 * 取到的完整地址必须来自**同一个字段**，否则会出现「行上写 a.com、链接指向 b.com」。
 */
export function toolUrl(args: unknown): string | null {
  if (args === null || typeof args !== "object") return null;
  const record = args as Record<string, unknown>;
  for (const key of ["url", "href"]) {
    const found = externalHttpUrl(record[key]);
    if (found !== null) return found;
  }
  return null;
}
