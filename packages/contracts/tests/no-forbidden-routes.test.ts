import { describe, it, expect } from "vitest";
import * as identity from "../src/identity";
import * as artifact from "../src/artifact";
import * as contextPack from "../src/context-pack";
import * as provenance from "../src/provenance";

/**
 * 「不存在」也是一种契约（一致性复核 N-5）
 *
 * ## 为什么用架构测试而不是「提供但恒拒」
 * UC-0.5 V9 要求「尝试删除/退出本地组织被拒」。两种实现方式：
 *   ① **不提供该 API** —— 攻击面为零，不存在「拒绝逻辑写错了」这种失效
 *   ② 提供但恒返回拒绝 —— 多一份必须永远正确的代码
 *
 * 裁决取 ①。但 ① 有个弱点：**「没有」这件事没人会去验**——
 * 某天有人为了别的需求加了 `DELETE /organizations/:id`，没有任何东西会报警。
 * 本测试就是补上那个警报：**把「路由表里不该有它」写成断言。**
 *
 * ⚠ 这类断言是**方向性**的：它证明不了「所有危险路由都没有」，
 *   只能证明「这几条明确禁止的没有」。新增禁止项要手动加进 FORBIDDEN。
 */

const ALL_OPERATIONS = {
  identity: identity.operations,
  artifact: artifact.operations,
  "context-pack": contextPack.operations,
  provenance: provenance.operations,
} as Record<string, Record<string, { method?: string; path?: string }>>;

/** 明确禁止存在的路由。每条都要写清「为什么不能有」——否则后人会以为是漏了 */
const FORBIDDEN: { pattern: RegExp; why: string }[] = [
  {
    pattern: /^DELETE\s+\/organizations/i,
    why:
      "UC-0.5 I-2/I-3：个人本地组织恒定存在、不可删除、不可退出、不可转让。" +
      "裁决（N-5）取「不提供该 API」而非「提供但恒拒」——攻击面为零，" +
      "且不存在「拒绝逻辑写错了」这种失效。",
  },
  {
    pattern: /^DELETE\s+\/artifacts\/[^/]+\/versions/i,
    why:
      "artifact I-11：固定快照不可删、不可改、不可降级。" +
      "唯一豁口是合规撤回（X-4），它走 markEvidenceWithdrawn 与撤回链，" +
      "**不是**一个通用的版本删除接口。",
  },
  {
    pattern: /^(PUT|PATCH|DELETE)\s+\/provenance/i,
    why:
      "provenance_events 是 append-only：无 UPDATE、无 DELETE。" +
      "审计日志可改等于审计不成立——「被拒绝的动作有没有留痕」将不可回答。",
  },
];

describe("禁止存在的路由", () => {
  const routes: { key: string; route: string }[] = [];
  for (const [bundle, ops] of Object.entries(ALL_OPERATIONS)) {
    for (const [opName, op] of Object.entries(ops)) {
      routes.push({ key: `${bundle}.${opName}`, route: `${op.method} ${op.path}` });
    }
  }

  it.each(FORBIDDEN)("路由表里不得出现 $pattern", ({ pattern, why }) => {
    const hits = routes.filter((r) => pattern.test(r.route));
    expect(
      hits,
      hits.length
        ? `发现被禁止的路由：${hits.map((h) => `${h.route}（${h.key}）`).join("、")}\n原因：${why}`
        : "",
    ).toEqual([]);
  });

  it("契约里至少有一条路由（防止测试因扫描不到而假通过）", () => {
    // ⚠ 上面的断言在「一条路由都没扫到」时也会通过——那是假绿。
    //   这条兜底断言让「扫描器坏了」与「确实没有违禁路由」区分开。
    expect(routes.length).toBeGreaterThan(10);
  });
});
