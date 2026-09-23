/**
 * 「导出的这个文件叫什么名字」——唯一事实源。
 *
 * ## 为什么必须是一处
 *
 * 2026-09-23 盘点，同一件事在仓里有**三套**规则：
 *   ① `designDocFileName`：`[^A-Za-z0-9_-]` 全替成 `-`，空了退 `design`（.md / .json 走它）
 *   ② `prototypeExportHtmlFileName`：**一个字都不过滤**，而且自己往名字里塞中文「可点击原型」
 *   ③ `PrototypeExportMenu` 里的 PNG：``${project.name}-${页名}.png``，同样不过滤
 *
 * ## 为什么规则是「只留 ASCII」这么狠
 *
 * 不是审美，是浏览器的硬行为。2026-09-23 用本机 Chromium 实测 `<a download>` + blob：
 *
 * ```
 * "plain-name.md"  => "plain-name.md"
 * "对话助手.md"     => "download"      ← 整个名字连扩展名一起丢掉
 * "café.md"        => "download"
 * "a:b*c?.md"      => "a_b_c_.md"     ← 非法字符它自己会换，但那是它的规则不是我们的
 * ```
 *
 * 也就是说 ② 那条路上**每一次**导出，用户拿到的都是一个叫 `download` 的**无扩展名**文件
 * ——名字里那四个中文字「可点击原型」是我们自己塞进去的，等于我们自己把它毁了。
 * 页名是中文的项目（「首页」「我的」）走 ③ 也一样。
 *
 * 所以：**名字里不许出现非 ASCII**，包括我们自己拼进去的词。真名留在文件内容里
 * （设计文档第一行就是项目名），文件名只负责「能落地、能认出是哪一份」。
 */

/** Windows 上不能当文件名的设备名（带扩展名也算）。 */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * 把任意一段人写的名字收成一个**能安全落盘、且浏览器不会丢掉**的文件名主干。
 * 收成空（比如整名都是中文）时退回 `fallback`——`fallback` 自己必须是 ASCII。
 */
export function exportFileStem(name: string, fallback: string): string {
  const safe = name
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    // 长名字截断：各家文件系统的上限是 255 **字节**，再加上后面的日期和扩展名。
    .slice(0, 80)
    .replace(/-+$/g, "");
  if (safe === "") return fallback;
  return RESERVED.test(safe) ? `${safe}-file` : safe;
}
