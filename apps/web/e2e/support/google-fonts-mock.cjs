/**
 * #951 —— `next/font/google` 的 hermetic mock，喂给 next 官方逃生口
 * `NEXT_FONT_GOOGLE_MOCKED_RESPONSES`（next 自己的测试套件就用它避开 Google Fonts，
 * 见 next@14.2.15 `dist/compiled/@next/font/dist/google/fetch-css-from-google-fonts.js`）。
 *
 * 为什么必须有它：fullstack-smoke 的 web 格是 `next build && next start`，`next build`
 * 期间 next 要联网到 fonts.googleapis.com 拉 CSS、再逐片下载字体。Google 边缘节点偶发
 * 返回不带扩展名的字体 URL 时，loader.js:112 的
 * `/\.(woff|woff2|eot|ttf|otf)$/.exec(url)[1]` 对 null 取 `[1]`，整个 build 崩掉——
 * 2026-08-11 一天三次打红与被测改动无关的 PR。mock 命中后 CSS 与字体二进制都不联网
 * （二进制走 `Buffer.from(url)`），build 完全确定性。
 *
 * ⚠ 键必须与 loader 按 `app/layout.tsx` 字体配置拼出的 URL **逐字符相等**
 *   （拼装规则见 next 的 `get-google-fonts-url.js`：`family=<名字空格换+>:wght@<权重;分号连接>&display=<display>`）。
 *   改了 layout.tsx 的字体/权重/display 而没同步这里，build 会以
 *   `Missing mocked response for URL: <新URL>` 确定性变红——那不是本 mock 坏了，
 *   是在告诉你把新 URL 按同样式样补进来。
 *
 * ⚠ CSS 里的 `src: url(...)` 必须以 .woff2 结尾（loader 要从扩展名定 ext），
 *   且不是绝对路径（相对/https 形态在 mock 模式下直接 `Buffer.from(url)`，不读盘不联网）。
 *   浏览器拿到的自托管“字体”不是合法 woff2，会静默回退系统字体——smoke 断言全部
 *   基于 data-testid 与文本，不依赖字形渲染。
 */

function fontFace(family, weight, subset, slug) {
  return `/* ${subset} */
@font-face {
  font-family: '${family}';
  font-style: normal;
  font-weight: ${weight};
  font-display: swap;
  src: url(https://fonts.gstatic.com/mocked/${slug}-${subset}-${weight}.woff2) format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}
`;
}

function css(family, weights, slug) {
  return weights.map((w) => fontFace(family, w, "latin", slug)).join("\n");
}

module.exports = {
  // app/layout.tsx: Noto_Sans_SC({ subsets:["latin"], weight:["400","500","600","700"], display:"swap" })
  // F19（契约束 visual-identity-refresh）新增 700，键必须同步改，否则 build 期
  // `Missing mocked response for URL: ...wght@400;500;600;700...` 确定性变红。
  "https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;600;700&display=swap": css(
    "Noto Sans SC",
    [400, 500, 600, 700],
    "noto-sans-sc",
  ),
  // app/layout.tsx: JetBrains_Mono({ subsets:["latin"], weight:["400","500"], display:"swap" })
  "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap": css(
    "JetBrains Mono",
    [400, 500],
    "jetbrains-mono",
  ),
  // app/layout.tsx: Bitter({ subsets:["latin"], weight:["600","700"], display:"swap" })
  // F19（契约束 visual-identity-refresh）新增字体，品牌 wordmark 专用，只这一处消费。
  "https://fonts.googleapis.com/css2?family=Bitter:wght@600;700&display=swap": css(
    "Bitter",
    [600, 700],
    "bitter",
  ),
};
