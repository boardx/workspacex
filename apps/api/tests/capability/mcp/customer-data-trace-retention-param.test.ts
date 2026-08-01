import { describe, expect, it } from "vitest";
import {
  computeRetentionExpiry,
  retentionCopy,
} from "../../../src/domain/mcp/customer-data-trace";
import { recordCustomerDataCall } from "../../../src/application/mcp/record-customer-data-call";
import type { ProvenanceWriter } from "../../../src/application/provenance/ports";
import { toOrgId } from "../../../src/domain/org-id";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * F54 (UC-21.2 R3 步骤 6-7 / R12 V6 / V6a / V7) -- 涉客户数据全量留痕 + 保留期读参数
 * + 留痕失败则调用失败。
 *
 * V6a 的验收动作逐字："把组织的留痕保留期参数从 180 改为 30，断言留痕到期时间与界面文案
 * 随之变化；代码中不存在硬编码 180"。这份文件既做行为断言，也做一条静态扫描断言，
 * 直接读本 feature 新增的源文件文本，确保没有裸的 `180` 字面量代表天数。
 */

function fakeProvenance(): ProvenanceWriter & { events: unknown[] } {
  const events: unknown[] = [];
  return {
    events,
    async append(input) {
      events.push(input);
      return `ev-${events.length}`;
    },
    async appendWithin(_s, input) {
      events.push(input);
      return `ev-${events.length}`;
    },
  };
}

const baseCall = {
  serverId: "mcp-crm",
  toolFullName: "mcp:crm.lookup",
  callerId: "u-consultant",
  agentId: "a-scout",
  projectId: "proj-1",
  requestParams: { customerId: "cust-42" },
  responseSummary: "返回 1 条客户记录",
  at: new Date("2026-08-01T00:00:00Z"),
};

describe("F54 · computeRetentionExpiry -- 到期时刻 = 记录时刻 + 参数天数（不是常量）", () => {
  it("180 天参数：到期时刻是记录时刻之后整整 180 天", () => {
    const expiry = computeRetentionExpiry(new Date("2026-08-01T00:00:00Z"), 180);
    expect(expiry.toISOString()).toBe("2027-01-28T00:00:00.000Z");
  });

  it("V6a：把参数从 180 改成 30，到期时刻随之变化——不是恒定输出", () => {
    const at = new Date("2026-08-01T00:00:00Z");
    const with180 = computeRetentionExpiry(at, 180);
    const with30 = computeRetentionExpiry(at, 30);
    expect(with180.getTime()).not.toBe(with30.getTime());
    expect(with30.toISOString()).toBe("2026-08-31T00:00:00.000Z");
  });

  it("反证：非正整数天数必须显式报错，不能悄悄算出一个负的到期时刻", () => {
    expect(() => computeRetentionExpiry(new Date(), 0)).toThrow();
    expect(() => computeRetentionExpiry(new Date(), -1)).toThrow();
    expect(() => computeRetentionExpiry(new Date(), 1.5)).toThrow();
  });
});

describe("F54 · retentionCopy -- 界面文案动态渲染，随参数变化", () => {
  it("30 天参数产出含 30 的文案，180 天参数产出含 180 的文案——不是同一句写死的话", () => {
    expect(retentionCopy(30)).toContain("30");
    expect(retentionCopy(180)).toContain("180");
    expect(retentionCopy(30)).not.toBe(retentionCopy(180));
  });
});

describe("F54 · recordCustomerDataCall -- V6 全量留痕六要素 + V7 留痕失败则调用失败", () => {
  it("全量留痕：留痕内容含请求参数/返回摘要/调用者/agent/时间/项目，六要素一个不少", async () => {
    const provenance = fakeProvenance();
    const result = await recordCustomerDataCall(
      { provenance },
      { ...baseCall, orgId: toOrgId("org-f54"), retentionDays: 180 },
    );
    expect(result.provenanceEventId.length).toBeGreaterThan(0);
    expect(provenance.events).toHaveLength(1);
    const detail = (provenance.events[0] as { detail: Record<string, unknown> }).detail;
    expect(detail.requestParams).toEqual({ customerId: "cust-42" });
    expect(detail.responseSummary).toBe("返回 1 条客户记录");
    expect(detail.callerId).toBe("u-consultant");
    expect(detail.agentId).toBe("a-scout");
    expect(detail.projectId).toBe("proj-1");
    expect(detail.at).toBe("2026-08-01T00:00:00.000Z");
  });

  it("V6a：改保留期天数 ⇒ 留痕里的 retentionUntil 随之变化", async () => {
    const provenance180 = fakeProvenance();
    const provenance30 = fakeProvenance();
    await recordCustomerDataCall({ provenance: provenance180 }, { ...baseCall, orgId: toOrgId("org-f54"), retentionDays: 180 });
    await recordCustomerDataCall({ provenance: provenance30 }, { ...baseCall, orgId: toOrgId("org-f54"), retentionDays: 30 });

    const detail180 = (provenance180.events[0] as { detail: { retentionUntil: string } }).detail;
    const detail30 = (provenance30.events[0] as { detail: { retentionUntil: string } }).detail;
    expect(detail180.retentionUntil).not.toBe(detail30.retentionUntil);
  });

  it("V7 硬前置：留痕存储不可用 ⇒ 该次调用必须失败（错误原样向上传播，不吞不重试）", async () => {
    const failingProvenance: ProvenanceWriter = {
      async append() {
        throw new Error("provenance store down");
      },
      async appendWithin() {
        throw new Error("provenance store down");
      },
    };
    await expect(
      recordCustomerDataCall(
        { provenance: failingProvenance },
        { ...baseCall, orgId: toOrgId("org-f54"), retentionDays: 180 },
      ),
    ).rejects.toThrow(/provenance store down/);
  });
});

describe("F54 · 静态断言：代码中不存在硬编码 180 代表留痕天数", () => {
  const filesToScan = [
    "src/domain/mcp/customer-data-trace.ts",
    "src/domain/mcp/security-policy.ts",
    "src/application/mcp/record-customer-data-call.ts",
    "src/application/mcp/set-security-policy.ts",
  ];

  it("这些源文件里没有裸的数字 180（只允许出现在注释里引用 O-01 裁决值时）", () => {
    for (const rel of filesToScan) {
      const abs = join(__dirname, "../../../", rel);
      const text = readFileSync(abs, "utf8");
      const codeOnly = text
        .split("\n")
        .filter((line) => !/^\s*\*/.test(line) && !line.trim().startsWith("//"))
        .join("\n")
        // 剥掉块注释内容（/** ... */ 跨行部分已被上面按行过滤，这里再兜一层同行内的 /* ... */）
        .replace(/\/\*[\s\S]*?\*\//g, "");
      expect(codeOnly, `${rel} 的可执行代码部分不应包含裸字面量 180`).not.toMatch(/\b180\b/);
    }
  });
});
