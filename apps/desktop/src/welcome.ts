/**
 * 桌面外壳在「起来了」与「打开工作区」之间的那一屏。
 *
 * ## 为什么必须有这一屏
 *
 * Night 0 的外壳起完栈就直接 `loadURL(web)`，于是装完的人看到的第一样东西是**登录页**
 * ——而本地账号的密码是首启随机生成、只写进数据目录 `secrets.json`（0600）的。CLI 会把它
 * 打印在终端里；双击安装包的人没有终端。也就是说：**装完了登不进去**，且界面上没有任何
 * 线索指向那个文件。这不是缺个便利功能，这是首启链路在最后一步断了。
 *
 * 所以这一屏只做三件事：把账号密码给人看见、把本次启动里**没起来的能力**如实列出来、
 * 给一个进工作区的入口。
 *
 * ⚠ 这个页面以 `data:` URL 加载，是**不透明源**（opaque origin）：`navigator.clipboard`
 *   在那里不可用（要求 secure context）。所以复制走 `input.select()` +
 *   `document.execCommand("copy")`，并在失败时如实告诉用户「请手动选中复制」——
 *   而不是给一个按下去毫无反应的按钮。
 * ⚠ 页面里不放任何本地文件路径之外的链接，也不引外部资源：本地版承诺零出网，首启这一屏
 *   自己先做到。
 */
export interface WelcomeView {
  readonly webUrl: string;
  readonly email: string;
  readonly password: string;
  readonly warnings: readonly string[];
  /** 数据目录，出问题时用户/支持需要知道去哪儿看日志。 */
  readonly dataDir: string;
}

export function escapeHtml(raw: string): string {
  return raw.replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch] ?? ch));
}

export function welcomeHtml(view: WelcomeView): string {
  const e = escapeHtml;
  const warnings = view.warnings.length === 0
    ? ""
    : `<section class="warn"><h2>本次启动里没起来的能力</h2><ul>${
      view.warnings.map((w) => `<li>${e(w)}</li>`).join("")
    }</ul></section>`;
  return `<!doctype html><html lang="zh"><meta charset="utf-8"><title>WorkspaceX Local</title>
<style>
:root{color-scheme:dark}
body{font:14px -apple-system,system-ui,"PingFang SC",sans-serif;margin:0;padding:40px;background:#0f1115;color:#e6e6e6}
main{max-width:620px;margin:0 auto}
h1{font-size:22px;margin:0 0 4px}
p.sub{color:#9aa4b2;margin:0 0 28px}
section{background:#161a21;border:1px solid #232937;border-radius:10px;padding:18px 20px;margin-bottom:16px}
h2{font-size:13px;margin:0 0 12px;color:#9aa4b2;font-weight:600}
label{display:block;font-size:12px;color:#9aa4b2;margin:10px 0 4px}
input{width:100%;box-sizing:border-box;background:#0f1115;border:1px solid #2b3240;border-radius:6px;
 color:#e6e6e6;padding:9px 10px;font:13px ui-monospace,SFMono-Regular,monospace}
button{border:0;border-radius:6px;padding:10px 18px;font:13px inherit;cursor:pointer}
.copy{background:#232937;color:#e6e6e6;margin-top:12px}
.open{background:#3b82f6;color:#fff;font-weight:600;padding:12px 26px}
.row{display:flex;align-items:center;gap:12px;margin-top:22px}
.hint{color:#9aa4b2;font-size:12px}
.warn{border-color:#4a3a1d;background:#1d1a12}
.warn ul{margin:0;padding-left:18px}.warn li{margin:4px 0;color:#d7c9a4}
code{color:#9aa4b2;font-size:12px}
</style>
<main>
<h1>WorkspaceX Local 已就绪</h1>
<p class="sub">全部服务都跑在这台电脑上，只监听回环地址。</p>
<section>
  <h2>用这个账号登录</h2>
  <label for="email">账号</label>
  <input id="email" readonly value="${e(view.email)}">
  <label for="password">密码（首启随机生成，存在 <code>${e(view.dataDir)}/secrets.json</code>）</label>
  <input id="password" readonly value="${e(view.password)}">
  <button class="copy" type="button" id="copy">复制密码</button>
  <span class="hint" id="copy-hint"></span>
</section>
${warnings}
<div class="row">
  <button class="open" type="button" id="open">打开工作区</button>
  <span class="hint">这一屏随时可以从「帮助 → 显示本地账号」再打开。</span>
</div>
</main>
<script>
const password = document.getElementById("password");
const hint = document.getElementById("copy-hint");
document.getElementById("copy").addEventListener("click", () => {
  password.select();
  // data: URL 是不透明源，navigator.clipboard 在这里不可用；execCommand 是唯一可行的一条，
  // 它也可能被策略挡掉——挡掉时如实说，不假装复制成功。
  const ok = document.execCommand("copy");
  hint.textContent = ok ? "已复制" : "复制被浏览器拒绝，请手动选中上面的密码复制";
});
document.getElementById("open").addEventListener("click", () => {
  window.location.href = ${JSON.stringify(view.webUrl)};
});
</script>
</html>`;
}

export function welcomeDataUrl(view: WelcomeView): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(welcomeHtml(view))}`;
}
