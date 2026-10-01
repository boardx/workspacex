const VITEST_BANNER = /^\s*(?:RUN|DEV)\s+v\d+\.\d+\.\d+(?:[-+][\w.-]+)?(?:\s+.*)?$/;

/** Bounded streaming diagnostics; the child output itself is still forwarded. */
class TestRunSummary {
  private zeroTests = false;
  private executedTests = false;
  private selectedFiles: number | null = null;
  private vitestSeen = false;
  private emptyAnnouncement = false;
  private webServerFailed = false;

  clone(): TestRunSummary {
    return Object.assign(new TestRunSummary(), this);
  }

  observe(text: string): void {
    this.vitestSeen ||= VITEST_BANNER.test(text);
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

/** Only the current invocation and the first rejected completed one are retained. */
class TestTaskSummary {
  private current = new TestRunSummary();
  private rejected: TestRunSummary | null = null;

  clone(): TestTaskSummary {
    const copy = new TestTaskSummary();
    copy.current = this.current.clone();
    // Finalized summaries are never observed again.
    copy.rejected = this.rejected;
    return copy;
  }

  observe(line: string): void {
    if (VITEST_BANNER.test(line)) {
      if (this.rejected === null && this.current.classify(0).diagnostic !== null) {
        this.rejected = this.current;
      }
      this.current = new TestRunSummary();
    }
    this.current.observe(line);
  }

  classify(code: number): { code: number; diagnostic: string | null } {
    return (this.rejected ?? this.current).classify(code);
  }
}

/** Turbo prefixes identify independent runners; one passing task cannot hide another empty task. */
export class TestRunOutput {
  private readonly tails = new Map<string, string>();
  private readonly tasks = new Map<string, TestTaskSummary>();
  private observeLine(tasks: Map<string, TestTaskSummary>, raw: string): void {
    const line = raw.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
    const prefixed = /^([@\w./-]+(?::[\w.-]+)+):\s+(.*)$/.exec(line);
    const task = prefixed?.[1] ?? "";
    const summary = tasks.get(task) ?? new TestTaskSummary();
    summary.observe(prefixed?.[2] ?? line);
    tasks.set(task, summary);
  }

  observe(stream: string, chunk: string): void {
    let pending = this.tails.get(stream) ?? "";
    let start = 0;
    while (start < chunk.length) {
      const newline = chunk.indexOf("\n", start);
      const end = newline === -1 ? chunk.length : newline;
      // Keep the line's beginning, including its runner identity. Never promote
      // an arbitrary suffix of an oversized log line into a new runner.
      pending += chunk.slice(start, Math.min(end, start + 4096 - pending.length));
      if (newline === -1) break;
      this.observeLine(this.tasks, pending);
      pending = "";
      start = newline + 1;
    }
    this.tails.set(stream, pending);
  }

  classify(code: number): { code: number; diagnostic: string | null } {
    // A final summary need not end in a newline. Preview pending lines without
    // committing them: callers may continue observing after classification.
    const tasks = new Map([...this.tasks].map(([task, summary]) => [task, summary.clone()]));
    for (const pending of this.tails.values()) {
      if (pending) this.observeLine(tasks, pending);
    }
    for (const summary of tasks.values()) {
      const outcome = summary.classify(code);
      if (outcome.diagnostic !== null) return outcome;
    }
    return { code, diagnostic: null };
  }
}
