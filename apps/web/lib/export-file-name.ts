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
 * 把一段文字转成拉丁字母（中文 → 拼音）。可注入：纯函数、测试与同步调用方都不必加载字典。
 * 返回值仍会过下面那道 ASCII 过滤——转写器漏掉的字符（日文假名、emoji）照旧被剥掉。
 */
export type Romanize = (text: string) => string;

/**
 * 2026-09-23 人类裁决：**中文名导出用拼音文件名**（「会员下单」→ `hui-yuan-xia-dan-…`），
 * 不再整名退成 `design`。
 *
 * 为什么是按需加载：`pinyin-pro` 带整本字典（~300KB），而文件名只在用户点「导出」
 * 的那一刻才需要。放进详情页首屏是让每个打开设计的人为一个多数人不会按的按钮付钱。
 * 所以这里返回一个 Promise，导出菜单在点击时 `await` 它（同 html2canvas 的先例）。
 *
 * 音节之间用 `-` 隔开，而不是连写成 `huiyuanxiadan`：连写要分词才读得出来，
 * 分词在这里做不对（「重庆」「长大」这种要看上下文），拆开至少每个音节都认得。
 *
 * 字典加载失败（离线、分块被拦）⇒ 返回 `null`，调用方退回纯 ASCII 规则：
 * 文件名差一点也比下载失败强。
 */
export async function loadRomanize(): Promise<Romanize | null> {
  try {
    const { pinyin } = await import("pinyin-pro");
    return (text) => pinyin(text, { toneType: "none", type: "array", nonZh: "consecutive", v: true }).join("-");
  } catch {
    return null;
  }
}

/**
 * 把任意一段人写的名字收成一个**能安全落盘、且浏览器不会丢掉**的文件名主干。
 * 给了 `romanize` 就先转写（中文 → 拼音），再过 ASCII 过滤；收成空时退回 `fallback`
 * ——`fallback` 自己必须是 ASCII。
 */
export function exportFileStem(name: string, fallback: string, romanize?: Romanize | null): string {
  const latin = romanize === undefined || romanize === null ? name : romanize(name);
  const safe = latin
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    // 长名字截断：各家文件系统的上限是 255 **字节**，再加上后面的日期和扩展名。
    .slice(0, 80)
    .replace(/-+$/g, "");
  if (safe === "") return fallback;
  return RESERVED.test(safe) ? `${safe}-file` : safe;
}
