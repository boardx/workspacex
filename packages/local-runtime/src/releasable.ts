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
  /**
   * 产物里**应该有、但由准备脚本生成且不入库**的目录，缺哪些。
   *
   * ⚠ 这一条是 2026-09-23 实测踩出来的（#3872 R16）：我在一个干净 worktree 里打包，
   *   `apps/skill-sandbox/preinstalled` 不在包里——它由
   *   `scripts/local-bundle/prepare-sandbox-modules.sh` 生成、不入库，而 `dist:mac`
   *   **不跑那个脚本**。于是打出来的包，pptx / docx / xlsx / pdf 那一类 skill
   *   会以 MODULE_NOT_FOUND 失败，而**唯一的症状要等用户真去生成一个文档才出现**。
   *
   *   同一个家族：R15 的 web 产物（`dist:mac` 不跑 `next build`，于是静默发布 dev 模式界面）。
   *   发布脚本依赖「开发者手工跑过某些脚本」，就一定会有人漏跑——那不该是发布失败的
   *   发现方式。运行时的告警已经把它说清了（那个设计是对的），但告警拦不住发布。
   */
  readonly missingPreparedDirs?: readonly string[];
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

  for (const d of f.missingPreparedDirs ?? []) {
    blockers.push(
      `产物里没有 ${d} —— 它由 scripts/local-bundle/ 下的准备脚本生成、不入仓库，`
      + "而打包脚本不会替你跑。缺了它，依赖这部分的能力会在用户手上静默失效："
      + "用户点下去、等一会儿、然后拿到一个内部错误，而不是一句「这个功能这一版没有」。"
      + "发布前先跑对应的准备脚本，或者把它接进 dist 脚本里。",
    );
  }

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
