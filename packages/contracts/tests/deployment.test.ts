import { describe, expect, it } from "vitest";
import {
  CAPABILITY_AVAILABILITY_LABEL, DEPLOYMENT_EDITION_LABEL, EDITION_CAPABILITIES,
  capabilitiesMissingIn, capabilityAvailability, parseDeploymentEdition,
  skillActivityDeliveryDiscipline,
} from "../src/deployment";

describe("deployment edition", () => {
  it("parses the two editions and falls back to cloud on anything else", () => {
    expect(parseDeploymentEdition("local")).toBe("local");
    expect(parseDeploymentEdition(" cloud ")).toBe("cloud");
    // 反证：默认必须是 cloud。如果哪天默认翻成 local，一份线上部署会静默放宽故障纪律。
    for (const raw of [undefined, null, "", "LOCAL", "desktop", "on"]) {
      expect(parseDeploymentEdition(raw)).toBe("cloud");
    }
  });

  it("keeps the cloud skill-activity discipline fail-closed and only relaxes it locally", () => {
    expect(skillActivityDeliveryDiscipline("cloud")).toBe("fail-closed");
    expect(skillActivityDeliveryDiscipline("local")).toBe("best-effort");
  });

  it("gives every edition and availability value a human label", () => {
    expect(Object.keys(DEPLOYMENT_EDITION_LABEL).sort()).toEqual(["cloud", "local"]);
    expect(Object.keys(CAPABILITY_AVAILABILITY_LABEL).sort()).toEqual(["absent", "full", "limited"]);
  });

  it("has no duplicate capability id and answers per edition", () => {
    const ids = EDITION_CAPABILITIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(capabilityAvailability("local", "cloud-models")).toBe("absent");
    expect(capabilityAvailability("cloud", "cloud-models")).toBe("full");
    // 不猜：没收录的 id 不给一个看起来合理的答案
    expect(capabilityAvailability("local", "teleportation")).toBeUndefined();
  });

  it("lists what each edition is missing, and the two lists are disjoint", () => {
    const localGaps = capabilitiesMissingIn("local").map((c) => c.id);
    const cloudGaps = capabilitiesMissingIn("cloud").map((c) => c.id);
    expect(localGaps).toContain("cloud-models");
    expect(localGaps).toContain("audit-provenance");
    expect(cloudGaps).toContain("offline");
    expect(localGaps.filter((id) => cloudGaps.includes(id))).toEqual([]);
    // 每条差异都要有原因——界面直接渲染它，空字符串等于一个没解释的死按钮
    for (const row of [...capabilitiesMissingIn("local"), ...capabilitiesMissingIn("cloud")]) {
      expect(row.why.length).toBeGreaterThan(8);
    }
  });

  it("only records capabilities that actually differ between the editions", () => {
    for (const row of EDITION_CAPABILITIES) expect(row.cloud).not.toBe(row.local);
  });
});
