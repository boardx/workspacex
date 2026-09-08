/**
 * 「起服务用通配地址、发请求用 127.0.0.1」的机械门控（issue #2992）。
 *
 * ## 这条门控在防什么（不是风格问题，是会伪装成断言失败的假红）
 *
 * Node 的 `server.listen(0)` 绑的是**通配地址**（实测 `{"address":"0.0.0.0"}`），
 * 而测试随后 `fetch('http://127.0.0.1:<port>/...')`。两者不是同一个地址：
 *
 * - 内核给通配 bind 抽签临时端口时，**不一定**避开别的进程已经占住的
 *   `127.0.0.1:<同一端口>`（macOS 允许通配与具体地址共存，具体地址优先接管回环流量）；
 * - 于是 `fetch` 打到的是**别的进程**，而不是本次测试起的那个应用。
 *
 * #2992 记录的就是这个形态：`tests/kernel/backflow-list-fields.test.ts` 四条偶发红，
 * body 是本仓**零命中**的 `Invalid CSRF token`，一条断言期望 403 也确实收到 403——
 * 只有 body 揭穿了「请求根本没到被测应用」。同 SHA 重跑与单跑 13/13 绿。
 *
 * 「没跑到」被伪装成「断言挂了」，是比普通抖动更贵的一类假红。
 *
 * ## 修法：bind 哪个地址，就 fetch 哪个地址
 *
 * `listen(0, "127.0.0.1")` 让临时端口在**回环地址上**抽签。此后端口冲突不可能静默发生：
 * 要么拿到一个真正空闲的回环端口，要么 `EADDRINUSE` 当场炸——响一声总比错一次好。
 *
 * 这不是新发明的约定：本仓已有 100+ 处写的就是 `listen(0, "127.0.0.1")`，
 * 本门控只是把剩下的 151 处收敛过去，并挡住以后再写回裸 `listen(0)`。
 */
export interface ListenSite {
  readonly file: string;
  readonly line: number;
  readonly snippet: string;
}

export interface ListenReport {
  readonly filesScanned: number;
  readonly wildcard: readonly ListenSite[];
}

/**
 * `.listen(0)` 或 `.listen(0, <非字符串字面量>` 都算通配 bind。
 *
 * 第二个参数是 host 时它必然是字符串字面量（`"127.0.0.1"`）；写成回调
 * （`listen(0, () => ...)`）时 Node 把 host 当成没传，仍然绑通配——所以这两种一起判。
 */
const WILDCARD = /\.listen\(\s*0\s*(?:\)|,(?!\s*['"`]))/;

export function analyzeListenSites(
  files: readonly { readonly file: string; readonly source: string }[],
): ListenReport {
  const wildcard: ListenSite[] = [];
  for (const { file, source } of files) {
    source.split("\n").forEach((text, index) => {
      if (!WILDCARD.test(text)) return;
      wildcard.push({ file, line: index + 1, snippet: text.trim().slice(0, 120) });
    });
  }
  return { filesScanned: files.length, wildcard };
}
