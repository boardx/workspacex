import { describe, expect, it } from "vitest";
import { operations } from "../src/feedback-loop";
import * as fl from "../src/feedback-loop";
import { FeedbackTags, feedbackGithubLabels } from "../src/feedback-tags";
describe("feedback classification tags", () => {
  it("normalizes whitespace and case, and accepts legacy input", () => {
    expect(FeedbackTags.parse([" Mobile ", "mobile", "体验"])).toEqual(["Mobile", "体验"]);
    expect(operations.createFeedbackDraft.in.parse({kind:"需求", target:{kind:"product"}, detail:"", occurredRoute:null, appVersion:null})).not.toHaveProperty("tags");
  });
  it("keeps system labels and isolates workflow namespaces", () => {
    expect(FeedbackTags.safeParse(["review:code-ok"]).success).toBe(false);
    expect(feedbackGithubLabels("缺陷", ["BUG", "界面", "status:merged"], ["界面", "体验", "agent:dev"]))
      .toEqual(["user-feedback", "BUG", "界面", "体验"]);
  });
});

describe("迭代 34 附件类型的中文标签（覆盖率门控）", () => {
  it("每个 MIME 取值都有中文——漏一个就判失败", () => {
    /*
     * ⭐ 反证锚点：给 `FeedbackAttachmentMime` 加一个取值而不补标签 ⇒ TS 当场编译不过
     * （Record 穷举）；真绕过去让它落到运行期，这条也会红。
     *
     * 为什么这张表非有不可：`FeedbackAttachment` 只有 id/url/mime，**没有文件名**——
     * 屏上唯一能告诉用户"这是什么"的信息就是类型，那它就不能是 `image/png`。
     */
    for (const mime of fl.FeedbackAttachmentMime.options) {
      const label = fl.FEEDBACK_ATTACHMENT_LABEL[mime];
      expect(label, `${mime} 没有中文标签`).toBeTruthy();
      expect(label, `${mime} 的"中文标签"就是 MIME 本身`).not.toBe(mime);
      expect(label).not.toContain("/");
    }
  });
});
