import { describe, expect, it } from "vitest";
import { authoredTranslations } from "../../src/domain/localization/authored-display-metadata";
const fields = { name: "S003", summary: null, duty: null, roleLabel: null, avatarAlt: null };
describe("authored display updates preserve user originals", () => {
  it("authors only titles for the known opaque Work identity without guessing its source locale", () => {
    expect(authoredTranslations("skill","S003",fields)).toEqual({ en: { name: "Enterprise Search" }, "zh-CN": { name: "企业内部检索" } });
  });
  it("does not translate a custom original just because it shares a known stable ID", () => {
    expect(authoredTranslations("skill","S003",{ ...fields, name: "Our custom search" })).toBeNull();
  });
  it("authors canonical official names, role labels and published alt text together", () => {
    expect(authoredTranslations("agent","D003",{ ...fields, name: "产品经理", roleLabel: "产品经理", avatarAlt: "产品经理" }))
      .toMatchObject({ en: { name: "Product Manager", roleLabel: "Product Manager", avatarAlt: "Product Manager" } });
  });
  it("preserves independently edited names/labels and never invents an avatar for a published null", () => {
    expect(authoredTranslations("agent","D003",{ ...fields, name: "My role", roleLabel: "产品经理" }))
      .toEqual({ en: { roleLabel: "Product Manager" }, "zh-CN": { roleLabel: "产品经理" } });
  });
  it("does not accept an unknown authored identity", () => {
    expect(authoredTranslations("agent","D999",fields)).toBeNull();
    expect(authoredTranslations("skill","S999",fields)).toBeNull();
  });
});
