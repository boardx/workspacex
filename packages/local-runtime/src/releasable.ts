/**
 * 这个产物能不能拿出去发布——**在构建时就回答，而不是等用户下载后被 Gatekeeper 拦住。**
 *
 * ## 实测（2026-09-23，装在机器上的 0.2.0）
 * ```
 * codesign -dv   → Signature=adhoc（linker-signed），Identifier=Electron
 * spctl -a -vvv  → code has no resources but signature indicates they must be present
 * ```
 * 也就是说 **Gatekeeper 拒绝它**。用户从网上下载这个 9 GB 的 DMG、双击，
 * 得到的多半是「已损坏，无法打开」——一句**不对**的话（应用没坏，只是没签名），
 * 而且是全新用户见到的第一屏。
 *
 * `electron-builder.yml` 里写着 `identity: null`，注释是「Night 0: unsigned mac DMG」——
 * 在内部试用阶段这是个合理的选择，但**一旦要对外发布它就是拦路石**，
 * 而现在没有任何东西会在构建时说这句话。
 *
 * ## 签名与「模型塞进包里」是耦合的
 * 现在不公证，所以「大体积公证要 3.5–4.5 小时」那条行业经验对我们**还不成立**。
 * 但它会在签名之后立刻成立：这个 DMG 有 9 GB，模型就在里面。
 * 换句话说——**今天的阻塞是没签名；签了之后，下一个阻塞就是包体。**
 * 这两件事要一起规划，不要先解决一个再发现另一个。
 */

export interface SigningFacts {
  /** `electron-builder.yml` 里 `mac.identity` 是不是 null（即显式关掉签名）。 */
  readonly identityIsNull: boolean;
  /** `codesign -dv` 的输出；拿不到就是 null（还没构建）。 */
  readonly codesignOutput: string | null;
  /** `spctl -a -vvv -t exec` 的输出；拿不到就是 null。 */
  readonly spctlOutput: string | null;
}

export interface ReleaseVerdict {
  readonly releasable: boolean;
  /** 为什么不能发——每条都是可以照着做的事，不是诊断名词。 */
  readonly blockers: readonly string[];
  /** 已知但不阻塞的事，比如包体。 */
  readonly notes: readonly string[];
}

/** `codesign` 说这是不是 ad-hoc 签名。 */
export function isAdhoc(codesignOutput: string | null): boolean {
  return codesignOutput !== null && /Signature=adhoc|flags=[^\s]*adhoc/.test(codesignOutput);
}

/** `spctl` 接受了吗。**只有明确的 `accepted` 才算接受**，读不到就当没接受。 */
export function gatekeeperAccepted(spctlOutput: string | null): boolean {
  return spctlOutput !== null && /:\s*accepted/.test(spctlOutput);
}

export function releaseVerdict(f: SigningFacts): ReleaseVerdict {
  const blockers: string[] = [];
  const notes: string[] = [];

  if (f.identityIsNull) {
    blockers.push(
      "`electron-builder.yml` 里 mac.identity 是 null，构建出的应用没有开发者签名。"
      + "用户下载后 Gatekeeper 会拦住它，提示多半是「已损坏，无法打开」——"
      + "那句话是错的（应用没坏），但用户没有办法分辨。"
      + "要发布得先有 Apple Developer ID 证书，把它填进 mac.identity。",
    );
  }
  if (isAdhoc(f.codesignOutput)) {
    blockers.push("产物是 ad-hoc 签名（只在这台机器上成立），换一台电脑就不被信任。");
  }
  if (f.codesignOutput !== null && !gatekeeperAccepted(f.spctlOutput)) {
    blockers.push(
      "Gatekeeper 没有接受这个产物。"
      + (f.spctlOutput === null ? "（没有拿到 spctl 的判定，当作没接受。）" : `原话：${f.spctlOutput.trim().split("\n")[0] ?? ""}`),
    );
  }

  notes.push(
    "签名之后下一个要解决的是包体：公证大体积载荷要数小时，而模型就在这个包里。"
    + "两件事要一起规划——今天的阻塞是没签名，签了之后下一个阻塞就是包体。",
  );

  return { releasable: blockers.length === 0, blockers, notes };
}
