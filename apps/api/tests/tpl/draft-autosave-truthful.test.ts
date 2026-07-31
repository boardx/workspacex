import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { templates } from "@repo/contracts";
import {
  autosaveFailed,
  autosaveSucceeded,
  beginAutosave,
  draftRetainedOnFailure,
  initialAutosaveState,
  isShowingSaved,
} from "../../src/domain/templates/draft-autosave";

/**
 * F18 —— **草稿自动保存必须说真话**（`uc-2-1` R7 / E3 / V12）。
 *
 * V12 逐字：显示的最后保存时刻必须真实，**不得在保存失败时仍显示已保存**。
 * 契约 `updateDesignFacet` 逐字：`autosavedAt` 是**真实写入时刻**，
 * 写失败必须返回 `AUTOSAVE_FAILED`。
 *
 * ## 反向断言在哪
 *
 * 「保存成功后显示时刻」是**正向**断言，它在任何实现下都容易绿。会出事的是反向那条：
 * **保存失败之后**。所以本文件的重心是失败路径，且要求两件事**同时**成立——
 *   ① 失败看得见（`status: "failed"` + 错误码）；
 *   ② 草稿不丢（`pendingValue` 还在）。
 * 只满足①的实现会丢字，只满足②的实现会骗人。
 *
 * 还有一条容易被绕过的：失败态**仍然保留着一个真实的 `lastSavedAt`**（上次成功的时刻）。
 * 所以不能靠「有没有时刻」来判断能不能显示「已自动保存」——那个时刻是真的，
 * 只是把它摆在「已自动保存」四个字后面就成了假话。`isShowingSaved` 断言的正是这一点。
 */

const T0 = "2026-07-31T14:52:00+08:00";
const T1 = "2026-07-31T15:07:00+08:00";

describe("正向：成功保存后显示的是服务端报的写入时刻", () => {
  it("时刻来自响应，不是本地生成的", () => {
    const saving = beginAutosave(initialAutosaveState(T0), "改了主题");
    const saved = autosaveSucceeded(saving, { autosavedAt: T1 });
    expect(saved.status).toBe("saved");
    expect(saved.lastSavedAt).toBe(T1);
    expect(isShowingSaved(saved)).toBe(true);
    // 落盘确认后草稿不再是「待保存」
    expect(saved.pendingValue).toBeNull();
    expect(saved.failure).toBeNull();
  });

  it("从未保存过的新草稿不谎报时刻", () => {
    const fresh = initialAutosaveState(null);
    expect(fresh.status).toBe("never-saved");
    expect(fresh.lastSavedAt).toBeNull();
    expect(isShowingSaved(fresh)).toBe(false);
  });
});

describe("反向：保存失败（V12 的整条命脉）", () => {
  const failed = autosaveFailed(beginAutosave(initialAutosaveState(T0), "改了主题"), "AUTOSAVE_FAILED");

  it("① 失败看得见：状态是 failed，且带得出错误码", () => {
    expect(failed.status).toBe("failed");
    expect(failed.failure).toBe("AUTOSAVE_FAILED");
  });

  it("② 草稿不丢：未落盘的内容原样留着，重试有东西可提交", () => {
    expect(failed.pendingValue).toBe("改了主题");
    expect(draftRetainedOnFailure(failed)).toBe(true);
  });

  it("最后保存时刻**不前进**——失败不产生新的「已保存」时刻", () => {
    expect(failed.lastSavedAt).toBe(T0);
    expect(failed.lastSavedAt).not.toBe(T1);
  });

  it("失败态**不得**显示「已自动保存」，哪怕上次的真时刻还在手上", () => {
    // 这一条是本文件的核心：时刻非空 ≠ 可以显示已保存
    expect(failed.lastSavedAt).not.toBeNull();
    expect(isShowingSaved(failed)).toBe(false);
  });

  it("重试成功后恢复，且时刻换成新的服务端时刻", () => {
    const retried = autosaveSucceeded(beginAutosave(failed, failed.pendingValue!), { autosavedAt: T1 });
    expect(retried.status).toBe("saved");
    expect(retried.lastSavedAt).toBe(T1);
    expect(isShowingSaved(retried)).toBe(true);
  });

  it("保存中不算已保存（转圈时不能显示「已自动保存」）", () => {
    const saving = beginAutosave(initialAutosaveState(T0), "又改了一版");
    expect(saving.status).toBe("saving");
    expect(isShowingSaved(saving)).toBe(false);
    // 但上次成功的时刻还在，界面要显示「上次保存于」时用得上
    expect(saving.lastSavedAt).toBe(T0);
  });
});

describe("服务端没给时刻 ⇒ 按失败处理，不补一个本地时间", () => {
  it("空 `autosavedAt` 不算保存成功", () => {
    const saving = beginAutosave(initialAutosaveState(T0), "改了主题");
    const outcome = autosaveSucceeded(saving, { autosavedAt: "   " });
    expect(outcome.status).toBe("failed");
    expect(outcome.failure).toBe("AUTOSAVE_FAILED");
    expect(outcome.lastSavedAt).toBe(T0);
    expect(isShowingSaved(outcome)).toBe(false);
    // 草稿照样不丢
    expect(outcome.pendingValue).toBe("改了主题");
  });
});

describe("与契约同源", () => {
  it("`AUTOSAVE_FAILED` 是契约里的码，且确实挂在 updateDesignFacet 上", () => {
    expect(templates.TemplateError.options).toContain("AUTOSAVE_FAILED");
    expect([...templates.operations.updateDesignFacet.err]).toContain("AUTOSAVE_FAILED");
  });

  it("成功时喂进来的就是契约响应体里的那个 `autosavedAt` 字段", () => {
    const response = templates.operations.updateDesignFacet.out.parse({
      itemRevision: "rev-2",
      completed: true,
      completeness: { done: 1, denominator: 2 },
      autosavedAt: T1,
    });
    const saved = autosaveSucceeded(beginAutosave(initialAutosaveState(T0), "x"), response);
    expect(saved.lastSavedAt).toBe(response.autosavedAt);
  });

  it("反证：契约会拒绝没有 `autosavedAt` 的响应体（否则上一条在空转）", () => {
    const withoutTimestamp = {
      itemRevision: "rev-2",
      completed: true,
      completeness: { done: 1, denominator: 2 },
    };
    expect(templates.operations.updateDesignFacet.out.safeParse(withoutTimestamp).success).toBe(false);
  });
});

describe("模块里没有时钟（不能自己造时刻）", () => {
  const SOURCE = fileURLToPath(new URL("../../src/domain/templates/draft-autosave.ts", import.meta.url));
  const CLOCK = /\bDate\.now\b|\bnew Date\b|\bDate\.parse\b|\bperformance\.now\b/;

  /** 注释里写「本文件不 import 任何时间源」不该被判成用了时钟 */
  const codeOnly = (body: string) =>
    body
      .split("\n")
      .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
      .join("\n");

  it("源码里一次时钟调用都没有", () => {
    const body = readFileSync(SOURCE, "utf8");
    expect(body.length, "读不到源码 —— 这条断言会静默通过").toBeGreaterThan(0);
    expect(CLOCK.test(codeOnly(body))).toBe(false);
  });

  it("反证：这个检查真的会对时钟开火（否则它对什么都不开火）", () => {
    expect(CLOCK.test(codeOnly("const at = Date.now();"))).toBe(true);
    expect(CLOCK.test(codeOnly("const at = new Date().toISOString();"))).toBe(true);
    // 注释行确实被剥掉了，剥法本身也不是空操作
    expect(codeOnly(" * 见 Date.now 的说明")).toBe("");
  });
});
