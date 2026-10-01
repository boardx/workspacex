/** Bounded streaming diagnostics; the child output itself is still forwarded. */
class TestRunSummary {
  private zeroTests = false;
  private executedTests = false;
  private selectedFiles: number | null = null;
  private vitestSeen = false;
  private emptyAnnouncement = false;
  private webServerFailed = false;

  observe(text: string): void {
    this.vitestSeen ||= /(?:^|\n)\s*(?:RUN|DEV)\s+v\d+\./.test(text);
    this.emptyAnnouncement ||= /(?:^|\n)\s*No test files found\b/.test(text);
    for (const summary of text.matchAll(/(?:^|\n)\s*Test Files\s+(no tests\b|\d+\s+(?:passed|failed|skipped|todo)\b)/g)) {
      this.zeroTests = summary[1] === "no tests";
      this.selectedFiles = this.zeroTests ? 0 : Number.parseInt(summary[1]!, 10);
    }
    const summaries = text.match(/^\s*Tests\s+(?:\d+ (?:passed|failed)\s*\|\s*)*\d+ (?:passed|failed)(?:\s*\|\s*\d+ (?:skipped|todo))*\s*\(\d+\)\s*$/gm) ?? [];
    this.executedTests ||= summaries.some((line) => [...line.matchAll(/\b(\d+) (?:passed|failed)\b/g)].some((count) => Number(count[1]) > 0));
    this.webServerFailed ||= /Process from config\.webServer was not able to start|Timed out waiting[^\n]*config\.webServer/.test(text);
  }

  classify(code: number): { code: number; diagnostic: string | null } {
    if (!this.executedTests && (this.zeroTests || (this.selectedFiles === null && this.vitestSeen && this.emptyAnnouncement))) {
      return {
        code: code === 0 ? 1 : code,
        diagnostic: code === 0
          ? "[test-isolation] 零测试执行：子进程退0但没有选中测试。核对 cwd 和位置过滤器；Vitest 过滤器按 cwd 解析，不按 --root。"
          : "[test-isolation] 零测试执行且子进程失败：检查原始 globalSetup/依赖错误及 cwd/过滤器；这不是已执行测试的断言失败。",
      };
    }
    if (this.webServerFailed) {
      return { code: code === 0 ? 1 : code, diagnostic: "[test-isolation] 零测试执行：Playwright webServer 启动失败。检查端口占用/服务就绪；这不是测试断言失败。" };
    }
    return { code, diagnostic: null };
  }
}

/** Turbo prefixes identify independent runners; one passing task cannot hide another empty task. */
export class TestRunOutput {
  private readonly tails = new Map<string, string>();
  private readonly tasks = new Map<string, TestRunSummary>();
  observe(stream: string, chunk: string): void {
    const text = ((this.tails.get(stream) ?? "") + chunk).replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
    const grouped = new Map<string, string[]>();
    for (const line of text.split("\n")) {
      const prefixed = /^([@\w./-]+(?::[\w.-]+)+):\s+(.*)$/.exec(line);
      const task = prefixed?.[1] ?? "";
      const lines = grouped.get(task) ?? [];
      lines.push(prefixed?.[2] ?? line);
      grouped.set(task, lines);
    }
    for (const [task, lines] of grouped) {
      const summary = this.tasks.get(task) ?? new TestRunSummary();
      summary.observe(lines.join("\n"));
      this.tasks.set(task, summary);
    }
    this.tails.set(stream, text.slice(-4096));
  }
  classify(code: number): { code: number; diagnostic: string | null } {
    for (const summary of this.tasks.values()) {
      const outcome = summary.classify(code);
      if (outcome.diagnostic !== null) return outcome;
    }
    return { code, diagnostic: null };
  }
}
