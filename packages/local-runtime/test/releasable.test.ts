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

/**
 * 由准备脚本生成、不入库的目录缺了，也是不能发布（#3872 R16）。
 *
 * 实测：干净 worktree 打出来的包没有 `apps/skill-sandbox/preinstalled`，
 * 于是 pptx / docx / xlsx / pdf 那一类 skill 全部以 MODULE_NOT_FOUND 失败，
 * 而**唯一的症状要等用户真去生成一个文档才出现**。
 */
describe("准备脚本的产物缺失", () => {
  // spctl 真实输出的形状是「<路径>: accepted」——判据要的是那个冒号（我第一版夹具写成
  // 裸 "accepted"，测试红了，是夹具错不是代码错）。
  const signed = {
    identityIsNull: false,
    codesignOutput: "Signature=Developer ID Application: Example (ABCDE12345)",
    spctlOutput: "/Applications/WorkspaceX.app: accepted\nsource=Developer ID",
  };

  it("缺一个就不能发布，并指名是哪个目录", () => {
    const v = releaseVerdict({ ...signed, missingPreparedDirs: ["Contents/Resources/bundle/apps/skill-sandbox/preinstalled"] });
    expect(v.releasable).toBe(false);
    expect(v.blockers.join("\n")).toContain("skill-sandbox/preinstalled");
  });

  it("**说的是对用户的后果，不是内部名词**", () => {
    const v = releaseVerdict({ ...signed, missingPreparedDirs: ["Contents/Resources/python"] });
    const text = v.blockers.join("\n");
    expect(text).toContain("静默失效");
    expect(text).not.toMatch(/MODULE_NOT_FOUND|ENOENT|exit code/);
  });

  it("缺多个就每个各说一条——合成一句「有些东西缺了」等于没说", () => {
    const v = releaseVerdict({ ...signed, missingPreparedDirs: ["a", "b", "c"] });
    expect(v.blockers.filter((b) => b.includes("准备脚本")).length).toBe(3);
  });

  it("都在时这一项不拦路", () => {
    expect(releaseVerdict({ ...signed, missingPreparedDirs: [] }).releasable).toBe(true);
    expect(releaseVerdict(signed).releasable).toBe(true);   // 字段不传也不能变成阻塞
  });
});
