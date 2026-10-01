/** Bounded streaming diagnostics; the child output itself is still forwarded. */
export class TestRunOutput {
  private readonly tails = new Map<string, string>();
  private zeroTests = false;
  private selectedFiles: number | null = null;
  private vitestSeen = false;
  private emptyAnnouncement = false;
  private webServerFailed = false;

  observe(stream: string, chunk: string): void {
    const text = ((this.tails.get(stream) ?? "") + chunk)
      .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
    this.vitestSeen ||= /(?:^|\n)\s*(?:RUN|DEV)\s+v\d+\./.test(text);
    this.emptyAnnouncement ||= /(?:^|\n)\s*No test files found\b/.test(text);
    for (const summary of text.matchAll(/(?:^|\n)\s*Test Files\s+(no tests\b|\d+\s+(?:passed|failed|skipped|todo)\b)/g)) {
      this.zeroTests = summary[1] === "no tests";
      this.selectedFiles = this.zeroTests ? 0 : Number.parseInt(summary[1]!, 10);
    }
    this.webServerFailed ||= /Process from config\.webServer was not able to start|Timed out waiting[^\n]*config\.webServer/.test(text);
    this.tails.set(stream, text.slice(-4096));
  }

  classify(code: number): { code: number; diagnostic: string | null } {
    if (this.zeroTests || (this.selectedFiles === null && this.vitestSeen && this.emptyAnnouncement)) {
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
