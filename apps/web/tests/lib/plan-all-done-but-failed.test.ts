/**
 * 2026-09-22 —— 「3/3 步已标记完成」与「这次任务执行失败」同屏那一幕。
 *
 * 人类那张截图就是它：三条绿勾 + 一条失败横幅。两句话都没说错（勾是模型调 `write_todos`
 * 自己写的声明，失败是执行器对这一轮的判定），但界面把「模型说它做完了」渲染得和
 * 「东西真的产出来了」一模一样，用户唯一能得到的结论是「这软件自相矛盾」。
 */
import { expect, it } from "vitest";
import { PLAN_ALL_DONE_BUT_FAILED_NOTE, planAllDoneButFailedNote } from "@/lib/chat-workbench/plan-failure-shape";

const done = { status: "completed" };
const doing = { status: "in_progress" };
const todo = { status: "pending" };

it("explains the contradiction only when every step is marked done and the run failed", () => {
  expect(planAllDoneButFailedNote([done, done, done], true)).toBe(PLAN_ALL_DONE_BUT_FAILED_NOTE);
  // 说清楚那些勾是谁打的，以及它不等于什么——否则这句话只是又一句安慰
  expect(PLAN_ALL_DONE_BUT_FAILED_NOTE).toContain("模型自己打的");
  expect(PLAN_ALL_DONE_BUT_FAILED_NOTE).toContain("不代表产物");
});

it("stays silent in the three cases where there is no contradiction to explain", () => {
  // run 没失败：成功时这句话只会让人怀疑自己的产物
  expect(planAllDoneButFailedNote([done, done], false)).toBeNull();
  // 一步都没有：屏幕上没有任何勾
  expect(planAllDoneButFailedNote([], true)).toBeNull();
  // 还有没完成的步骤：那一幕本来就自洽，界面已经指出失败在哪一步
  expect(planAllDoneButFailedNote([done, doing], true)).toBeNull();
  expect(planAllDoneButFailedNote([done, todo], true)).toBeNull();
});

it("returns null rather than an empty string -- an empty string renders as a blank line", () => {
  expect(planAllDoneButFailedNote([done], false)).not.toBe("");
});
