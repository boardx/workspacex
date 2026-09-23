import { describe, expect, it } from "vitest";
import { gatekeeperAccepted, isAdhoc, releaseVerdict } from "../src/releasable";

/** 2026-09-23 在装好的 0.2.0 上抓到的真实输出，逐字。 */
const REAL_CODESIGN = `Executable=/Applications/WorkspaceX.app/Contents/MacOS/WorkspaceX
Identifier=Electron
Format=app bundle with Mach-O thin (arm64)
CodeDirectory v=20400 size=513 flags=0x20002(adhoc,linker-signed) hashes=13+0 location=embedded
Signature=adhoc
Info.plist=not bound`;
const REAL_SPCTL = "/Applications/WorkspaceX.app: code has no resources but signature indicates they must be present";
const SIGNED_OK = "Signature=Developer ID Application: Example Inc (ABCDE12345)";
const SPCTL_OK = "/Applications/X.app: accepted\nsource=Notarized Developer ID";

describe("读签名事实", () => {
  it("认得出 ad-hoc——这是本仓此刻的真实状态", () => {
    expect(isAdhoc(REAL_CODESIGN)).toBe(true);
    expect(isAdhoc(SIGNED_OK)).toBe(false);
  });
  it("拿不到输出时不当成已签名", () => {
    expect(isAdhoc(null)).toBe(false);          // 没有证据说它是 adhoc
    expect(gatekeeperAccepted(null)).toBe(false); // 但也没有证据说 Gatekeeper 接受
  });
  it("**只有明确的 accepted 才算接受**", () => {
    expect(gatekeeperAccepted(SPCTL_OK)).toBe(true);
    expect(gatekeeperAccepted(REAL_SPCTL)).toBe(false);
  });
});

describe("能不能发布", () => {
  it("本仓此刻的真实状态：不能发，而且说得出三条各自的原因", () => {
    const v = releaseVerdict({ identityIsNull: true, codesignOutput: REAL_CODESIGN, spctlOutput: REAL_SPCTL });
    expect(v.releasable).toBe(false);
    expect(v.blockers).toHaveLength(3);
    expect(v.blockers.join("\n")).toContain("Developer ID");
    expect(v.blockers.join("\n")).toContain("ad-hoc");
    expect(v.blockers.join("\n")).toContain("Gatekeeper");
  });

  it("阻塞项说的是照着能做的事，不是诊断名词", () => {
    const v = releaseVerdict({ identityIsNull: true, codesignOutput: REAL_CODESIGN, spctlOutput: REAL_SPCTL });
    expect(v.blockers[0]).toMatch(/要发布得先有.*证书/);
  });

  it("并且说清那句「已损坏」是错的——用户没办法自己分辨", () => {
    const v = releaseVerdict({ identityIsNull: true, codesignOutput: null, spctlOutput: null });
    expect(v.blockers.join("")).toContain("那句话是错的");
  });

  it("签好名并被 Gatekeeper 接受时，判可发布", () => {
    const v = releaseVerdict({ identityIsNull: false, codesignOutput: SIGNED_OK, spctlOutput: SPCTL_OK });
    expect(v.releasable).toBe(true);
    expect(v.blockers).toEqual([]);
  });

  it("签了名但 Gatekeeper 没接受，仍然不能发——「签过」不等于「能装」", () => {
    const v = releaseVerdict({ identityIsNull: false, codesignOutput: SIGNED_OK, spctlOutput: REAL_SPCTL });
    expect(v.releasable).toBe(false);
  });

  it("包体这条是提醒不是阻塞，而且点明它与签名耦合", () => {
    const v = releaseVerdict({ identityIsNull: false, codesignOutput: SIGNED_OK, spctlOutput: SPCTL_OK });
    expect(v.releasable).toBe(true);                 // 不阻塞
    expect(v.notes.join("")).toMatch(/公证|包体/);
    expect(v.notes.join("")).toMatch(/一起规划|下一个阻塞/);
  });
});
