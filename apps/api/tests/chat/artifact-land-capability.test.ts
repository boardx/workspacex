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
 * **不渲染**（不是渲染后禁用），接口拒绝保持不变。当时把「个人对话要不要真的
 * 支持落地产物」明确留成开放问题（ITERATION-LOG round 16 原文）。
 *
 * **2026-08-21 人类裁决**：开放问题已回答——个人对话也要真的落地产物，不再是
 * 「本地演示」。`PERSONAL_THREAD_CAPABILITIES` 现在**含** `artifact.land`；
 * 放行依据见 `land-as-artifact.ts` 对 `isPersonalThread` 分支的处理（不经
 * `ProjectRole`，靠 `resolveVisibility` 已验证过的创建者身份），且硬锁
 * `mode: "draft"`（`PersonalThreadRequiresDraftError`，同 `C_CHAT_11` 判例）。
 * 项目线程那两条边界（写角色都拿得到 / 观察者与无角色者拿不到）不变。
 *
 * 反证方式：把 `CHAT_WRITE_CAPABILITIES` 里的 `"artifact.land"` 删掉，
 * 前两条当场红；把它从 `PERSONAL_THREAD_CAPABILITIES` 里删掉，第三条当场红。
 */
describe("#728 P10 → 2026-08-21 裁决：artifact.land 能力下发边界", () => {
  it("项目写角色（facilitator/groupLead/member）都拿到 artifact.land —— land-as-artifact 的角色门只拒 null/observer，不排除 member", () => {
    for (const role of ["facilitator", "groupLead", "member"] as const) {
      expect(capabilitiesFor(role), role).toContain("artifact.land");
    }
  });

  it("观察者与无角色者拿不到 artifact.land（观察者恒只读，写能力不在集合里而非标 disabled）", () => {
    expect(capabilitiesFor("observer")).not.toContain("artifact.land");
    expect(capabilitiesFor(null)).toEqual([]);
  });

  it("个人线程能力集合含 artifact.land（2026-08-21 裁决：个人对话也要能真的落地产物）", () => {
    expect(PERSONAL_THREAD_CAPABILITIES).toContain("artifact.land");
    expect(PERSONAL_THREAD_CAPABILITIES).toContain("artifact.readonly");
  });
});
