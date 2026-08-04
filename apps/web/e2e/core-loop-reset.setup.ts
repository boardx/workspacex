/**
 * #492：`core-loop-empty-db` project 的 setup —— 把库清成**零用户**。
 *
 * ## 它为什么存在，以及为什么是一个 project 而不是一个新 config
 *
 * 步骤 1 要验「注册**第一个**用户」，前提是库里零用户；而这套 `webServer` 的启动命令里
 * 写死了 `seed-fullstack-smoke.ts`，其余 spec（步骤 2/5/6a、#387、#458）全都依赖那批种子。
 * `webServer` 是 **config 级**的，改不出「某个 project 不跑 seed」。
 *
 * 于是用 Playwright 的 project `dependencies` 排出顺序：
 *
 *     seeded  ──▶  core-loop-reset（本文件）  ──▶  core-loop-empty-db
 *   （吃种子的全部 spec）      （清库）              （只有步骤 1）
 *
 * 清库发生在**所有吃种子的 spec 跑完之后**，所以谁也不会被它打红。
 * 这是 coord-main 的裁决：不新建 playwright config、不新建 docker 栈、不新建 CI job。
 *
 * ⚠ 已知代价，如实记：`dependencies` 会让上游 project 失败时下游被 **skip**。也就是说
 *   #387/#458 红的那一轮里，进度板会消失。可以接受的理由是——那一轮 CI 本来就是红的，
 *   不存在「skip 掉一片绿」的错觉；而顺序反过来（先清库再跑种子 spec）是直接把别人打红。
 *
 * ## 这里**刻意不断言**「零用户」
 *
 * 那条断言只住在 `core-loop.spec.ts` 步骤 1 里，一处。在这里再抄一份的后果很具体：
 * 反证（`CORE_LOOP_COUNTERPROOF=1`）就会红在 setup 上，于是步骤 1 被 **skip** 而不是变红——
 * 而 #492 要看的红证据恰恰是**步骤 1 自己变红**。skip 不是红。
 */
import { test } from "@playwright/test";
import { EMPTY_DB_TAG, resetToEmptyDatabase } from "./core-loop-fixture";

// 标题也带上 `@empty-db`：`--grep=@empty-db` 才能把「清库 + 步骤 1」当成一个整体单独跑，
// 这正是取反证红证据时用的命令。少了它，setup 会被 grep 过滤掉，步骤 1 于是跑在一个
// 没清过的库上——那就成了另一种空转。
test(`${EMPTY_DB_TAG} 清库：让 first-user bootstrap 门重新打开`, () => {
  const after = resetToEmptyDatabase();
  // 只报告，不判决。判决在步骤 1。
  process.stdout.write(`[core-loop-reset] ${JSON.stringify(after)}\n`);
});
