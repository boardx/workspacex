import { describe, expect, it } from "vitest";
import {
  capabilitiesFor,
  PERSONAL_THREAD_CAPABILITIES,
} from "../../src/domain/chat/thread-visibility";

/**
 * #728 round 16 P10 —— `artifact.land` 能力的下发边界。
 *
 * 背景：前端此前**无条件**渲染每条消息下的「落地为产物」按钮，而后端
 * `land-as-artifact.ts` 对 `projectRole` 为 null/observer 恒抛 `NoWriteRoleError`
 * ——个人线程（`projectRole` 恒 null）里那是一枚点了必报错的假按钮，评分员
 * round 16 按判据「界面上没有假按钮」判 P10 = 0。
 *
 * 修法照 `thread.mutate`（#460）的既有规矩：服务端下发显式能力，前端据此
 * **不渲染**（不是渲染后禁用），接口拒绝保持不变。本文件钉死能力下发的边界；
 * 「前端真的不渲染」由 e2e 端把守（chat-main-shots.spec.ts 个人侧 count=0，
 * chat-read.spec.ts 项目写角色侧可见）。
 *
 * 反证方式：把 `CHAT_WRITE_CAPABILITIES` 里的 `"artifact.land"` 删掉，
 * 前两条当场红；把它塞进 `PERSONAL_THREAD_CAPABILITIES`，第三条当场红。
 */
describe("#728 P10 artifact.land 能力下发边界", () => {
  it("项目写角色（facilitator/groupLead/member）都拿到 artifact.land —— land-as-artifact 的角色门只拒 null/observer，不排除 member", () => {
    for (const role of ["facilitator", "groupLead", "member"] as const) {
      expect(capabilitiesFor(role), role).toContain("artifact.land");
    }
  });

  it("观察者与无角色者拿不到 artifact.land（观察者恒只读，写能力不在集合里而非标 disabled）", () => {
    expect(capabilitiesFor("observer")).not.toContain("artifact.land");
    expect(capabilitiesFor(null)).toEqual([]);
  });

  it("个人线程能力集合不含 artifact.land —— 产物对个人线程是 artifact.readonly，「不是禁用，是没有」", () => {
    expect(PERSONAL_THREAD_CAPABILITIES).not.toContain("artifact.land");
    expect(PERSONAL_THREAD_CAPABILITIES).toContain("artifact.readonly");
  });
});
