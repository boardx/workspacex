/**
 * #1182 —— 活动流的类型标签必须对契约枚举**穷尽**。
 *
 * 为什么单靠 `Record<ProvenanceEventType, string>` 的类型约束不够：一个 `as` 就绕过去了，
 * 而 CI 只跑 tsc 不跑人眼。更要紧的是**漏掉的后果是静默的**——那一行渲染成空白，
 * 而空白在审计流里读作「这条没事发生」，不是「这条我们不认识」。
 */
import { describe, expect, it } from "vitest";
import { provenance } from "@repo/contracts";
import { PROVENANCE_EVENT_LABEL } from "@/lib/provenance-labels";

describe("审计事件标签", () => {
  const values = provenance.ProvenanceEventType.options;

  it("每一个契约枚举值都有一句非空的中文", () => {
    expect(values.length).toBeGreaterThan(0);   // 反空转：枚举读不到时上面的循环会平凡通过
    for (const v of values) {
      expect(PROVENANCE_EVENT_LABEL[v], `缺 ${v} 的标签`).toBeTruthy();
      expect(PROVENANCE_EVENT_LABEL[v].trim().length, `${v} 的标签是空白`).toBeGreaterThan(0);
    }
  });

  it("标签表里没有契约之外的键——多出来的键说明契约删过值而这里没跟上", () => {
    expect(Object.keys(PROVENANCE_EVENT_LABEL).sort()).toEqual([...values].sort());
  });
});
