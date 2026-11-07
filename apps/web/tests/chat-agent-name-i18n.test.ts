import { expect, it } from "vitest";
import { agentDisplayName, agentDisplayNameByAvatar } from "@/lib/agent-directory";
const avatar = { kind:"illustration" as const,key:"dh-03-product-manager" as const,alt:"" };
it("uses the existing authored English name only for a recognized official role", () => {
  const source={ name:"产品经理",catalogSource:"official" as const,avatar };
  expect(agentDisplayName(source,"en")).toBe("Product Manager");
  expect(source.name).toBe("产品经理");
  expect(agentDisplayName(source)).toBe("产品经理");
});
it("preserves an organization-authored name even with an official-looking avatar", () => {
  expect(agentDisplayName({name:"用户自己的产品经理 🌍",catalogSource:"org" as const,avatar},"en")).toBe("用户自己的产品经理 🌍");
});
it("localizes recognized authored message identities without rewriting an unknown avatar's source name", () => {
  expect(agentDisplayNameByAvatar(avatar.key,"原始系统名",undefined,"en","official")).toBe("Product Manager");
  expect(agentDisplayNameByAvatar("custom-avatar","用户原名 🌍",undefined,"en")).toBe("用户原名 🌍");
});
it("does not infer official provenance from an avatar when a name belongs to an organization", () => {
  expect(agentDisplayNameByAvatar(avatar.key,"用户原名 🌍",undefined,"en","org")).toBe("用户原名 🌍");
  expect(agentDisplayNameByAvatar(avatar.key,"用户原名 🌍",undefined,"en")).toBe("用户原名 🌍");
});
