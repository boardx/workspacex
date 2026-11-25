import { expect, it } from "vitest";
import { readAidtPrototypeTextCandidates } from "@/features/aidt/components/aidt-prototype-text-candidates";

const fence = String.fromCharCode(96).repeat(3);
const reply = (value: unknown, format = "aidt-prototype") => `${fence}${format}\n${JSON.stringify(value)}\n${fence}`;

it("combines multiple returned ideas into one editable text draft", () => {
  const [draft] = readAidtPrototypeTextCandidates(reply({ candidates: [
    { ideaTitle: "情绪暂停键", operations: "暂停计时并显示呼吸引导" },
    { ideaTitle: "任务自选超市", task: "挑选今天的任务" },
  ] }));
  expect(draft?.text).toContain("点子：情绪暂停键");
  expect(draft?.text).toContain("暂停计时并显示呼吸引导");
  expect(draft?.text).toContain("点子：任务自选超市");
  expect(draft?.text).toContain("挑选今天的任务");
  expect(draft?.fields).toEqual({});
});

it("reads a flat JSON draft without projecting unsupported fields", () => {
  const [draft] = readAidtPrototypeTextCandidates(reply({ task: "比较两个入口", confirmed: true }, "json"));
  expect(draft?.fields).toEqual({ task: "比较两个入口" });
});
