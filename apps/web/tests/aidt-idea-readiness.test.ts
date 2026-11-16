import { expect, it } from "vitest";
import { aidtIdeaReadiness } from "@/features/aidt/lib/aidt-idea-readiness";
const ideas = () => ["入口提示", "同伴引导", "号码分区"].map((title, index) => ({ id: String(index), title, description: "学生先提出做法。再说明怎样帮助用户。", imageAttachment: { attachmentId: `a${index}`, threadId: "real-thread", name: `${index}.png` } }));
it("requires two or three complete sentences for each of the three illustrated idea sheets", () => {
  const input = ideas();
  expect(aidtIdeaReadiness(input).ready).toBe(true);
  input[1]!.description = "只有一句，尚未说清做法。";
  expect(aidtIdeaReadiness(input).ready).toBe(false);
  input[1]!.description = "一句。两句。三句。四句。";
  expect(aidtIdeaReadiness(input).ready).toBe(false);
  input[1]!.description = "First describe the action. Then explain its value. List an uncertainty.";
  expect(aidtIdeaReadiness(input).ready).toBe(true);
});
it("requires distinct named concepts and actual image references without inventing missing material", () => {
  const input = ideas(); input[1]!.title = " 入口提示 ";
  expect(aidtIdeaReadiness(input).ready).toBe(false);
  expect(aidtIdeaReadiness(ideas().slice(0, 2)).ready).toBe(false);
  const missing = ideas().map(item => ({ ...item, imageAttachment: undefined }));
  expect(aidtIdeaReadiness(missing).ready).toBe(false);
});
it.each(["duplicate", "blank"])("does not mark %s candidate identifiers ready for individual PDF export", kind => {
  const input = ideas();
  if (kind === "duplicate") input.forEach(item => { item.id = "same-candidate"; }); else input[1]!.id = " ";
  expect(aidtIdeaReadiness(input).ready).toBe(false);
  expect(input).toHaveLength(3); expect(input[1]!.title).toBe("同伴引导");
});
