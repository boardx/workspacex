import { describe, expect, it } from "vitest";
import {
  instantiateForSegment,
  type GroupInstance,
  type SegmentTemplateBinding,
} from "../../src/domain/canvas/segment-binding";
import { publishNewVersion, type TemplateVersionRecord } from "../../src/domain/canvas/template-lifecycle";

/**
 * F102 — 「现场实例化」的反向断言。
 *
 * 正向测试只会问「绑定时状态对不对」；本文件刻意反过来问：
 * **先实例化，后改模板（发布新版本 / 归档），已实例化的产物是否纹丝不动？**
 * 这是本 feature notes 里逐字写的核对方式，也是 F101 I-4「实例固化版本」模式
 * 在「议程环节绑定」这一层的重复出现——绑定本身在建立时冻结 `boundTemplateVersion`，
 * `instantiateForSegment` 只读这个冻结值，从不重新查询模板注册表。
 *
 * 另外覆盖 `instantiateForSegment` 契约里明写的幂等重放：同一 `idempotencyKey`
 * 重放必须返回同一批 `instanceId`，不产生第二批画布。
 */

function makeMap(entries: readonly (readonly [string, readonly GroupInstance[]])[]) {
  return new Map(entries);
}

describe("F102 · 现场实例化（instantiateForSegment）", () => {
  describe("反向断言：实例化之后改模板，已实例化的环节不跟着变", () => {
    it("绑定时冻结 v1；实例化产出 v1；随后模板发布 v2（旧版自动归档）；同一绑定再次触发实例化仍是 v1", () => {
      // 1) 议程环节在模板 v1 published 时绑定 —— boundTemplateVersion 在这一刻冻结。
      const binding: SegmentTemplateBinding = {
        bindingId: "bind-1",
        agendaSegmentId: "segment-1",
        templateKey: "empathy",
        boundTemplateVersion: 1,
      };

      // 2) 现场切到该环节，为两个分组各实例化一张画布。
      const firstBatch = instantiateForSegment({
        binding,
        groupIds: ["group-a", "group-b"],
        idempotencyKey: "switch-1",
        existingByIdempotencyKey: makeMap([]),
        makeInstanceId: (groupId) => `inst-${groupId}-1`,
      });

      expect(firstBatch).toEqual([
        { instanceId: "inst-group-a-1", groupId: "group-a", templateKey: "empathy", templateVersion: 1 },
        { instanceId: "inst-group-b-1", groupId: "group-b", templateKey: "empathy", templateVersion: 1 },
      ]);

      // 3) 之后模板发布 v2 —— 注册表侧 v1 自动归档、v2 变 published。
      //    这一步纯粹操作模板注册表，完全不touch 上面已建出的 firstBatch 或 binding 本身。
      let registry: TemplateVersionRecord[] = [{ key: "empathy", version: 1, status: "published" }];
      const { updated } = publishNewVersion(registry, "empathy", 2);
      registry = [...updated];
      expect(registry).toContainEqual({ key: "empathy", version: 1, status: "archived" });
      expect(registry).toContainEqual({ key: "empathy", version: 2, status: "published" });

      // 4) 反向断言核心：firstBatch 里的实例是纯值对象，模板注册表变化不可能反向改写它们
      //    ——逐字段重新断言，证明没有任何隐藏的可变共享状态。
      for (const inst of firstBatch) {
        expect(inst.templateKey).toBe("empathy");
        expect(inst.templateVersion).toBe(1);
      }

      // 5) 同一条绑定（未重新绑定，`boundTemplateVersion` 仍是 1）在另一次现场触发
      //    （新的 idempotencyKey，代表另一次真实的"切环节"事件）时，实例化仍然只读
      //    binding 冻结的版本号，产出的新实例版本依旧是 1 —— 不会因为注册表现在
      //    是 v2 而"自动升级"。这正是本 feature 要防的反直觉实现。
      const secondBatch = instantiateForSegment({
        binding, // 同一个 binding 对象，boundTemplateVersion 未变
        groupIds: ["group-c"],
        idempotencyKey: "switch-2",
        existingByIdempotencyKey: makeMap([]),
        makeInstanceId: (groupId) => `inst-${groupId}-2`,
      });

      expect(secondBatch).toEqual([
        { instanceId: "inst-group-c-2", groupId: "group-c", templateKey: "empathy", templateVersion: 1 },
      ]);
    });

    it("模板被归档后，存量绑定的现场实例化仍然成功且版本不变（O-10 ②，不因归档而阻断）", () => {
      const binding: SegmentTemplateBinding = {
        bindingId: "bind-2",
        agendaSegmentId: "segment-2",
        templateKey: "swot",
        boundTemplateVersion: 3,
      };

      // instantiateForSegment 本身根本不接受/查询模板状态参数——它只认 binding 冻结的版本，
      // 这一点由函数签名本身保证：不存在会导致它去查"模板现在是不是 archived"的入参。
      const batch = instantiateForSegment({
        binding,
        groupIds: ["group-x"],
        idempotencyKey: "switch-after-archive",
        existingByIdempotencyKey: makeMap([]),
        makeInstanceId: (groupId) => `inst-${groupId}`,
      });

      expect(batch).toEqual([
        { instanceId: "inst-group-x", groupId: "group-x", templateKey: "swot", templateVersion: 3 },
      ]);
    });
  });

  describe("幂等重放：同一 idempotencyKey 重放返回同一批 instanceId，不产生第二批画布", () => {
    it("命中既有 idempotencyKey 时直接返回既有批次，makeInstanceId 不会被用来再造一批", () => {
      const binding: SegmentTemplateBinding = {
        bindingId: "bind-3",
        agendaSegmentId: "segment-3",
        templateKey: "jtbd",
        boundTemplateVersion: 1,
      };

      const existingBatch: readonly GroupInstance[] = [
        { instanceId: "inst-group-a-existing", groupId: "group-a", templateKey: "jtbd", templateVersion: 1 },
        { instanceId: "inst-group-b-existing", groupId: "group-b", templateKey: "jtbd", templateVersion: 1 },
      ];

      let makeInstanceIdCallCount = 0;
      const replayed = instantiateForSegment({
        binding,
        groupIds: ["group-a", "group-b"],
        idempotencyKey: "switch-1",
        existingByIdempotencyKey: makeMap([["switch-1", existingBatch]]),
        makeInstanceId: (groupId) => {
          makeInstanceIdCallCount += 1;
          return `should-not-be-used-${groupId}`;
        },
      });

      expect(replayed).toBe(existingBatch); // 同一批，不是内容相等的新数组
      expect(makeInstanceIdCallCount).toBe(0); // 没有尝试再造一批
    });

    it("不同 idempotencyKey 各自产出独立批次，互不覆盖", () => {
      const binding: SegmentTemplateBinding = {
        bindingId: "bind-4",
        agendaSegmentId: "segment-4",
        templateKey: "mvp",
        boundTemplateVersion: 1,
      };

      const batch1 = instantiateForSegment({
        binding,
        groupIds: ["group-a"],
        idempotencyKey: "key-1",
        existingByIdempotencyKey: makeMap([]),
        makeInstanceId: (groupId) => `${groupId}-batch1`,
      });
      const batch2 = instantiateForSegment({
        binding,
        groupIds: ["group-a"],
        idempotencyKey: "key-2",
        existingByIdempotencyKey: makeMap([]),
        makeInstanceId: (groupId) => `${groupId}-batch2`,
      });

      expect(batch1).not.toEqual(batch2);
      expect(batch1[0]?.instanceId).toBe("group-a-batch1");
      expect(batch2[0]?.instanceId).toBe("group-a-batch2");
    });
  });

  describe("每个分组各出一张画布", () => {
    it("N 个 groupId 产出 N 条实例，一一对应，顺序保持", () => {
      const binding: SegmentTemplateBinding = {
        bindingId: "bind-5",
        agendaSegmentId: "segment-5",
        templateKey: "persona",
        boundTemplateVersion: 1,
      };

      const batch = instantiateForSegment({
        binding,
        groupIds: ["g1", "g2", "g3"],
        idempotencyKey: "k",
        existingByIdempotencyKey: makeMap([]),
        makeInstanceId: (groupId) => `inst-${groupId}`,
      });

      expect(batch.map((i) => i.groupId)).toEqual(["g1", "g2", "g3"]);
      expect(batch.map((i) => i.instanceId)).toEqual(["inst-g1", "inst-g2", "inst-g3"]);
      expect(new Set(batch.map((i) => i.instanceId)).size).toBe(3); // 无重复
    });
  });
});
