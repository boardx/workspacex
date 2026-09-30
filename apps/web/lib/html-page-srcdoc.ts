/**
 * 把清洗过的 HTML 页片段装成 iframe 的 `srcDoc`。
 *
 * 安全边界的后两层在这里（第一层是契约的 `sanitizeHtmlPage`，见 `design-html-page.ts`）：
 *   · CSP：`default-src 'none'`，只放行内联样式、`data:` 图片与字体，脚本只认我们自己带 nonce 的那一段；
 *   · 配合渲染处的 `sandbox="allow-scripts"`（**不给** allow-same-origin / allow-forms / allow-top-navigation）：
 *     页面是不透明源，读不到 cookie / 存储 / 父页面，也不能把顶层导航走。
 *
 * ⚠ nonce 由内容派生（服务端渲染与客户端水合必须一致，随机数会水合失败）。可预测不等于可利用：
 *   清洗器已经把所有 `<script>` 拿掉，nonce 只是「清洗万一有漏」时的又一层，不是唯一一层。
 */

/** 页内点击 → 父页面的消息形状。 */
export const HTML_PAGE_MESSAGE_SOURCE = "wsx-html-page";
export type HtmlPageMessage =
  | { readonly source: typeof HTML_PAGE_MESSAGE_SOURCE; readonly type: "goto"; readonly id: string }
  | { readonly source: typeof HTML_PAGE_MESSAGE_SOURCE; readonly type: "click" };

function contentNonce(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `wsx${(h >>> 0).toString(36)}`;
}

const BASE_CSS =
  "*,*::before,*::after{box-sizing:border-box}html,body{margin:0;padding:0;min-height:100%}" +
  "body{font-family:system-ui,-apple-system,'Segoe UI','PingFang SC','Noto Sans SC',sans-serif;line-height:1.5;-webkit-font-smoothing:antialiased}" +
  "img,svg{max-width:100%}a{color:inherit}button,input,select,textarea{font:inherit}[data-goto]{cursor:pointer}";

const BRIDGE = `(function(){var S="${HTML_PAGE_MESSAGE_SOURCE}";document.addEventListener("click",function(e){var t=e.target;if(!t||!t.closest)return;var a=t.closest("a");if(a)e.preventDefault();var g=t.closest("[data-goto]");if(g&&g.getAttribute("data-link")){parent.postMessage({source:S,type:"goto",id:g.getAttribute("data-link")},"*");return}parent.postMessage({source:S,type:"click"},"*")},true)})();`;

export function buildHtmlPageSrcdoc(fragment: string, opts: { readonly dark?: boolean; readonly wireframe?: boolean } = {}): string {
  const nonce = contentNonce(fragment);
  // 没写背景与前景色的页面跟着画布主题走；模型写了的以模型为准（页面自己的 CSS 在 BASE_CSS 之后，优先级更高）。
  const scheme = opts.dark === true ? "color-scheme:dark;background:#111;color:#eee" : "color-scheme:light;background:#fff;color:#111";
  const wire = opts.wireframe === true ? "html{filter:grayscale(1)}" : "";
  return (
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; script-src 'nonce-${nonce}'">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<style>${BASE_CSS}body{${scheme}}${wire}</style></head><body>${fragment}<script nonce="${nonce}">${BRIDGE}</script></body></html>`
  );
}
