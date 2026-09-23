import { describe, expect, it } from "vitest";
import {
  DEFAULT_RESTART_WINDOW, decideRestart, describeServiceFailure,
  SERVICE_IMPACT, SERVICE_LABELS, type ExitRecord,
} from "../src/supervisor-policy";

const at = (...times: number[]): ExitRecord[] => times.map((t) => ({ at: t, code: 1 }));

describe("重启决策", () => {
  it("第一次挂掉就重启，而且等一下再试", () => {
    const d = decideRestart(at(1000), 1000);
    expect(d.action).toBe("restart");
    if (d.action === "restart") { expect(d.attempt).toBe(1); expect(d.delayMs).toBe(1000); }
  });

  it("退避是递增的，不是每次都立刻重试", () => {
    const d2 = decideRestart(at(0, 1000), 1000);
    const d3 = decideRestart(at(0, 1000, 2000), 2000);
    expect(d2.action === "restart" && d2.delayMs).toBe(3000);
    expect(d3.action === "restart" && d3.delayMs).toBe(8000);
  });

  it("窗口内超过上限就停手——一直重启只会从「卡住」变成「一边卡住一边烧 CPU」", () => {
    const d = decideRestart(at(0, 1000, 2000, 3000), 3000);
    expect(d.action).toBe("give-up");
    if (d.action === "give-up") expect(d.reason).toMatch(/不再自动重启/);
  });

  it("老的退出滑出窗口后重新计数——偶发一次不该永久拉黑一个服务", () => {
    const old = DEFAULT_RESTART_WINDOW.windowMs + 10_000;
    const d = decideRestart(at(0, 1000, 2000, old), old);
    expect(d.action).toBe("restart");
    if (d.action === "restart") expect(d.attempt).toBe(1);
  });
});

describe("说给用户听的话", () => {
  it("不出现 exit code / ECONNREFUSED 这类词", () => {
    for (const svc of Object.keys(SERVICE_LABELS)) {
      for (const d of [decideRestart(at(0), 0), decideRestart(at(0, 1, 2, 3), 3)]) {
        const m = describeServiceFailure(svc, d, SERVICE_IMPACT[svc] ?? "");
        const text = `${m.title}\n${m.body}`;
        expect(text).not.toMatch(/exit code|ECONNREFUSED|EOF|ENOENT|errno|stack|undefined/i);
      }
    }
  });

  it("三段都在：发生了什么、对你意味着什么、你现在能做什么", () => {
    const m = describeServiceFailure("deep-agent", decideRestart(at(0, 1, 2, 3), 3), SERVICE_IMPACT["deep-agent"]!);
    expect(m.title).toContain("智能体运行时");        // 发生了什么，且说人话
    expect(m.body).toContain("不会有回复");            // 对你意味着什么
    expect(m.body).toMatch(/重开一次应用|日志/);      // 你现在能做什么
    expect(m.transient).toBe(false);
  });

  it("还在重试时标成临时的，不要吓人", () => {
    const m = describeServiceFailure("api", decideRestart(at(0), 0), SERVICE_IMPACT.api!);
    expect(m.transient).toBe(true);
    expect(m.body).toContain("重试");
  });

  it("每个服务都有人话名字和影响说明，没有漏的", () => {
    for (const svc of Object.keys(SERVICE_LABELS)) {
      expect(SERVICE_IMPACT[svc], `${svc} 缺影响说明`).toBeTruthy();
      expect(SERVICE_LABELS[svc]).not.toBe(svc);       // 不能拿内部名字糊弄
    }
  });
});
