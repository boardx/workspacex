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
  /** 编辑态：点了哪个元素（`ref` = 清洗时补的 `data-ref`；点在空白处 ⇒ `null`，表示选中整页）。 */
  | { readonly source: typeof HTML_PAGE_MESSAGE_SOURCE; readonly type: "select"; readonly ref: string | null };

/** 父页面 → iframe：当前选中的元素，桥据此画出选中框。 */
export const HTML_PAGE_PARENT_SOURCE = "wsx-parent";

function contentNonce(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `wsx${(h >>> 0).toString(36)}`;
}

const BASE_CSS =
  "*,*::before,*::after{box-sizing:border-box}html,body{margin:0;padding:0;min-height:100%}" +
  "body{font-family:system-ui,-apple-system,'Segoe UI','PingFang SC','Noto Sans SC',sans-serif;line-height:1.5;-webkit-font-smoothing:antialiased}" +
  "img,svg{max-width:100%}a{color:inherit}button,input,select,textarea{font:inherit;color:inherit}[data-goto]{cursor:pointer}";

/**
 * 页内桥（我们自己写的、带 nonce 的唯一一段脚本）。
 *   · 预览态：点带 `data-goto` 的元素 ⇒ 告诉父页面跳转；
 *   · 编辑态：悬停画框、点击 ⇒ 告诉父页面选中了哪个 `data-ref` 元素（精确到元素，不是整块区域），
 *     父页面回传当前选中的编号，桥把选中框画在它上面。点击一律 preventDefault：编辑时不让链接/按钮真的生效。
 */
const BRIDGE = `(function(){var S="${HTML_PAGE_MESSAGE_SOURCE}",P="${HTML_PAGE_PARENT_SOURCE}",edit=document.documentElement.getAttribute("data-mode")==="edit";` +
  `if(!edit){document.addEventListener("click",function(e){var t=e.target;if(!t||!t.closest)return;var a=t.closest("a");if(a)e.preventDefault();var g=t.closest("[data-goto]");if(g&&g.getAttribute("data-link"))parent.postMessage({source:S,type:"goto",id:g.getAttribute("data-link")},"*")},true);return}` +
  `var hl=document.createElement("div");hl.setAttribute("style","position:absolute;pointer-events:none;z-index:2147483647;outline:2px solid #3b82f6;outline-offset:1px;background:rgba(59,130,246,.08);display:none");document.body.appendChild(hl);` +
  `var sel=null;function box(el){var r=el.getBoundingClientRect();hl.style.display="block";hl.style.left=(r.left+window.scrollX)+"px";hl.style.top=(r.top+window.scrollY)+"px";hl.style.width=r.width+"px";hl.style.height=r.height+"px"}` +
  `function rest(){if(sel)box(sel);else hl.style.display="none"}` +
  `function ref(e){var t=e.target;return t&&t.closest?t.closest("[data-ref]"):null}` +
  `document.addEventListener("mouseover",function(e){var t=ref(e);if(t)box(t)});document.addEventListener("mouseout",rest);` +
  `document.addEventListener("click",function(e){e.preventDefault();var t=ref(e);parent.postMessage({source:S,type:"select",ref:t?t.getAttribute("data-ref"):null},"*")},true);` +
  `window.addEventListener("message",function(e){var d=e.data;if(e.source!==parent||!d||d.source!==P)return;sel=d.ref&&/^r\\d{1,5}$/.test(d.ref)?document.querySelector('[data-ref="'+d.ref+'"]'):null;rest()});` +
  `window.addEventListener("resize",rest);})();`;

export function buildHtmlPageSrcdoc(fragment: string, opts: { readonly wireframe?: boolean; readonly mode?: "edit" | "preview" } = {}): string {
  const nonce = contentNonce(fragment);
  // 页面自己拥有颜色：不跟画布的深浅主题走（像设计稿的画板，深色界面里放一张白底稿是对的）。
  // 跟着走的话，模型没给表单控件写前景色时会得到「浅色字落在浅色底上」——深色主题下的下拉框就是这么消失的。
  const scheme = "color-scheme:light;background:#fff;color:#111";
  const wire = opts.wireframe === true ? "html{filter:grayscale(1)}" : "";
  return (
    `<!doctype html><html data-mode="${opts.mode === "edit" ? "edit" : "preview"}"><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; script-src 'nonce-${nonce}'">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<style>${BASE_CSS}body{${scheme}}${wire}</style></head><body>${fragment}<script nonce="${nonce}">${BRIDGE}</script></body></html>`
  );
}
