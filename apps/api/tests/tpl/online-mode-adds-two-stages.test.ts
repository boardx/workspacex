import { describe, expect, it } from "vitest";
import { templates } from "@repo/contracts";
import {
  ONLINE_AUTO_SEGMENTS,
  planFormatChange,
  type SessionFormat,
} from "../../src/domain/templates/format-language";
import {
  setFormatAndLanguage,
  type SetFormatAndLanguageParams,
} from "../../src/application/templates/set-format-and-language";
import { agendaSegmentCountForTier } from "../../src/domain/templates/agenda-segment-table";

/**
 * F19 —— 「全线上」自动加两个议程环节，切回对称移除（`uc-2-1` R3 步骤 2 / A2 / I-16 / V5，
 * 契约 `setFormatAndLanguage`）。
 *
 * 「对称」是可断言的：加过什么就移除什么，**不是「移除所有 optional 的」**——本文件
 * 专门用一个「同时存在因升档而 optional 的环节」的场景证明这一点（那批环节必须原样保留）。
 */

const baseTwoDay = agendaSegmentCountForTier("two-day"); // 14

const call = (previousFormat: SessionFormat, nextFormat: SessionFormat, baseAgendaSegmentCount = baseTwoDay) =>
  planFormatChange({ baseAgendaSegmentCount, previousFormat, nextFormat });

describe("切「全线上」：固定追加破冰 + 举手排队两个环节", () => {
  it("混合 → 全线上：自动追加恰好两个，且标记来源为 format-setting", () => {
    const result = call("hybrid", "online");
    expect(result.autoAdded).toEqual(ONLINE_AUTO_SEGMENTS);
    expect(result.autoAdded).toHaveLength(2);
    for (const seg of result.autoAdded) {
      expect(seg.addedBy).toBe("format-setting");
      expect(seg.optional).toBe(true);
    }
    expect(result.autoRemoved).toEqual([]);
    expect(result.agendaSegmentCount).toBe(baseTwoDay + 2);
  });

  it("纯线下 → 全线上：同样追加两个（三种非线上形式都一样触发）", () => {
    const result = call("onsite", "online");
    expect(result.autoAdded).toEqual(ONLINE_AUTO_SEGMENTS);
    expect(result.agendaSegmentCount).toBe(baseTwoDay + 2);
  });

  it("追加的两个环节确实是「破冰」与「举手排队」", () => {
    const result = call("hybrid", "online");
    const titles = result.autoAdded.map((s) => s.title);
    expect(titles).toEqual(["破冰", "举手排队"]);
  });
});

describe("切回混合/线下：对称移除，且不影响其余可选环节", () => {
  it("全线上 → 混合：恰好移除那两个，没有新增", () => {
    const result = call("online", "hybrid");
    expect(result.autoRemoved).toEqual(ONLINE_AUTO_SEGMENTS);
    expect(result.autoAdded).toEqual([]);
    expect(result.agendaSegmentCount).toBe(baseTwoDay);
  });

  it("全线上 → 纯线下：同样对称移除", () => {
    const result = call("online", "onsite");
    expect(result.autoRemoved).toEqual(ONLINE_AUTO_SEGMENTS);
    expect(result.agendaSegmentCount).toBe(baseTwoDay);
  });

  it("『对称』不是『移除所有 optional 的』：因升档而 optional 的环节不受影响", () => {
    // 三天档比两天档多了 5 个「迭代与落地计划」环节，它们的 optional 都是 true——
    // 这条证明切回非线上形式时，format-setting 的对称移除只认自己加的那两个 key，
    // 不会把这些无关的 optional 环节也带着移除。
    const threeDay = agendaSegmentCountForTier("three-day");
    const online = call("hybrid", "online", threeDay);
    expect(online.agendaSegmentCount).toBe(threeDay + 2);
    const back = call("online", "hybrid", threeDay);
    expect(back.autoRemoved).toEqual(ONLINE_AUTO_SEGMENTS);
    expect(back.agendaSegmentCount).toBe(threeDay);
  });
});

describe("形式不变（含线上到线上）：不触发任何自动增删", () => {
  it("混合 → 线下：不涉及线上，不增删", () => {
    const result = call("hybrid", "onsite");
    expect(result.autoAdded).toEqual([]);
    expect(result.autoRemoved).toEqual([]);
    expect(result.agendaSegmentCount).toBe(baseTwoDay);
  });

  it("全线上 → 全线上：形式没变，不重复追加", () => {
    const result = call("online", "online");
    expect(result.autoAdded).toEqual([]);
    expect(result.autoRemoved).toEqual([]);
    expect(result.agendaSegmentCount).toBe(baseTwoDay + 2);
  });
});

describe("应用层：响应体通过契约 out 校验，自动追加的环节通过契约 AgendaSegmentRef 校验", () => {
  const params: SetFormatAndLanguageParams = {
    baseAgendaSegmentCount: baseTwoDay,
    previousFormat: "hybrid",
    nextFormat: "online",
  };

  it("响应体整体能被契约 out 校验通过", () => {
    const out = setFormatAndLanguage(params);
    const parsed = templates.operations.setFormatAndLanguage.out.safeParse(out);
    expect(parsed.success, JSON.stringify(parsed.success ? {} : parsed.error.issues)).toBe(true);
  });

  it("反向断言：契约会拒绝漂移的响应体", () => {
    const out = setFormatAndLanguage(params);
    expect(
      templates.operations.setFormatAndLanguage.out.safeParse({ ...out, agendaSegmentCount: "14" }).success,
    ).toBe(false);
  });

  it("autoAdded 里的每一项都能被契约 AgendaSegmentRef 解析", () => {
    const out = setFormatAndLanguage(params);
    for (const ref of out.autoAdded) {
      expect(templates.AgendaSegmentRef.safeParse(ref).success, JSON.stringify(ref)).toBe(true);
    }
  });

  it("SessionFormat / SessionLanguage 三选一都是契约里已声明的值（不多不少）", () => {
    for (const f of ["hybrid", "onsite", "online"] as const) {
      expect(templates.SessionFormat.safeParse(f).success).toBe(true);
    }
    expect(templates.SessionFormat.safeParse("remote").success).toBe(false);
    for (const l of ["zh", "en", "bilingual"] as const) {
      expect(templates.SessionLanguage.safeParse(l).success).toBe(true);
    }
  });
});
