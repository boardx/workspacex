/**
 * 关闭窗口之后，数据库还在收尾——**必须让人看见**（#3872 R10）。
 *
 * ## 这不是打磨，这是那 6 次事故的根因
 *
 * 原来的 `before-quit` 是：`e.preventDefault()` → `await stack.stop()` → `app.quit()`。
 * 主窗口此时已经销毁，于是用户看到的是：窗口消失了，但应用还在 Dock 里转着圈。
 * 一个合理的人这时会去「强制退出」——而 `stack.stop()` 那几秒里正在关的是 PGlite。
 *
 * 这台机器上安装版自己的 `desktop.log` 里，**「上次被硬杀导致数据库打不开」出现了 6 次**，
 * 而且 2026-09-20 一个晚上连着 3 次。那 6 次不是假设出来的风险，是已经发生过的事。
 * 关机路径上没有任何可见反馈，是用户会去硬杀的直接原因。
 *
 * 所以这一页做两件事，一件都不能省：
 * 1. **说正在做什么、以及不要强制退出**——给出停手的理由，而不只是一个转圈动画。
 * 2. **有上限**。一个永远转圈的「正在安全关闭」比没有更糟：它会训练用户在下一次
 *    直接硬杀。超时之后如实说「收尾超时」并放行退出，而不是假装还在进行。
 */

/** 收尾最多等多久。超过就放行——挂住不退会让用户学会硬杀，那才是我们要避免的。 */
export const SHUTDOWN_TIMEOUT_MS = 20_000;

export function shutdownNoticeHtml(): string {
  return `<!doctype html><meta charset="utf-8"><title>正在安全关闭</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; height:100vh; display:flex; align-items:center; justify-content:center;
         font: 13px/1.7 -apple-system, "PingFang SC", sans-serif;
         background:#fff; color:#111; }
  @media (prefers-color-scheme: dark) { body { background:#16181c; color:#e8eaed; } }
  .box { text-align:center; padding:0 28px; }
  .t { font-size:15px; font-weight:600; }
  .d { margin-top:8px; opacity:.72; }
  .w { margin-top:14px; font-weight:600; }
  .bar { margin:18px auto 0; width:190px; height:3px; border-radius:2px;
         background:currentColor; opacity:.14; overflow:hidden; }
  .bar i { display:block; width:40%; height:100%; border-radius:2px; background:currentColor;
           opacity:.55; animation:s 1.1s ease-in-out infinite; }
  @keyframes s { 0%{transform:translateX(-100%)} 100%{transform:translateX(250%)} }
</style>
<div class="box">
  <div class="t">正在安全关闭</div>
  <div class="d">正在把还没写完的内容存进数据库。通常只要几秒。</div>
  <div class="w">这几秒里请不要强制退出。</div>
  <div class="bar"><i></i></div>
</div>`;
}

export function shutdownNoticeDataUrl(): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(shutdownNoticeHtml())}`;
}
