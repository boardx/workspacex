/**
 * F12 反向断言面：**I-10 的另一半 —— 去掉 `?t=` 直接访问被拒（V6a ①）**。
 *
 * ⚠ 这条断言刻意**不碰仓储/数据库**：`linkToken` 是否存在是 `joinByGroupLink`
 *   用例函数在触碰任何存储之前就能下结论的检查（见其实现的第一段），所以这里
 *   注入一个「一旦被调用就抛」的假仓储——如果这条检查被移到仓储之后，
 *   本测试会因为「假仓储被调用」而失败，而不是含糊地通过。
 */
import { describe, expect, it, vi } from "vitest";
import { joinByGroupLink } from "../../src/application/auth/join-by-group-link";
import type { JoinRepository } from "../../src/application/auth/join-ports";

function unreachableRepo(): JoinRepository {
  return {
    joinByGroupLink: vi.fn(async () => {
      throw new Error("不应该被调用：LINK_TOKEN_REQUIRED 必须在触碰仓储之前短路。");
    }),
  };
}

describe("I-10：不带令牌的进场请求一律被拒，且不触碰仓储", () => {
  it("linkToken = null ⇒ LINK_TOKEN_REQUIRED", async () => {
    const repo = unreachableRepo();
    await expect(
      joinByGroupLink(
        { repo, newGuestIdentityId: () => "gi-unused" },
        { linkToken: null, phone: "13800000000", existingSessionId: null },
      ),
    ).rejects.toMatchObject({ reasonCode: "LINK_TOKEN_REQUIRED" });
    expect(repo.joinByGroupLink).not.toHaveBeenCalled();
  });

  it("linkToken = '' ⇒ LINK_TOKEN_REQUIRED", async () => {
    const repo = unreachableRepo();
    await expect(
      joinByGroupLink(
        { repo, newGuestIdentityId: () => "gi-unused" },
        { linkToken: "", phone: "13800000000", existingSessionId: null },
      ),
    ).rejects.toMatchObject({ reasonCode: "LINK_TOKEN_REQUIRED" });
    expect(repo.joinByGroupLink).not.toHaveBeenCalled();
  });
});
