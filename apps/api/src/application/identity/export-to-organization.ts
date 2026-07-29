/**
 * `PreviewExport` + `ExportToOrganization` (F17) —— **隐私承诺的唯一豁口**。
 *
 * ## 这两个用例要证明的不是「导出能成功」
 *
 * 成功路径是最不值得担心的部分。F16 刚刚把「最隐私的数据不出本机」做成了网络层的
 * 可断言性质，而本文件是唯一被允许打开它的地方，所以要证明的是四件**关于豁口本身**的事：
 *
 *   ① 只在人显式发起时打开，且**只对被选中的那几件**
 *   ② 关得上——导出结束后守卫恢复原状
 *   ③ 留痕，且**审计写失败则整个导出失败**
 *   ④ 谁能导、导什么，判定只有一处
 *
 * ①②不在这个文件里实现，它们在 `infrastructure/egress/local-egress-guard.ts` 的
 * aperture 里——因为它们是网络层的性质，一个应用层函数说自己没出网是没有意义的
 * （identity/domain.md「为什么 I-9 必须在网络层断言」）。本文件的责任是**把字节搬运
 * 放进 aperture 里**，而不是放在它旁边。
 *
 * ③ 在 `LocalExportRepository.commitExport` 的单事务里。
 * ④ 在这里：方向、成员资格、令牌，三道判定各自只有一处。
 *
 * ## 顺序是刻意的，且顺序本身是一条安全性质
 *
 *   1. 两侧成员资格          —— 先答「你是谁」，再答别的（否则会泄漏组织存在与否）
 *   2. 方向                  —— 反向请求在读取任何内容之前就结束
 *   3. 令牌（原子核销）      —— 「人确认过」变成一次性的、已花掉的事实
 *   4. 请求集合 == 令牌集合  —— 确认过的清单不能被事后裁剪或替换
 *   5. 字节搬运（在 aperture 内，逐件）
 *   6. 单事务：副本行 + 两侧审计
 *
 * ⚠ 5 在 6 之前。反过来（先写行、再搬字节）会让「行已存在但字节没到」成为可达状态，
 *   而那正是最难发现的一种损坏：目标组织里出现一条指向空对象的成果，
 *   所有查询都正常，只有真的去下载的人才会知道。
 *   代价照实说：6 失败时目标键空间里会留下**孤儿字节**——没有任何行指向它们，
 *   因此不可寻址、不可读、不构成泄漏，且这是两害中较轻的一个。
 */
import { randomUUID } from "node:crypto";
import {
  isExportDirectionAllowed,
  isPreviewFresh,
  sameSelection,
  targetObjectKey,
} from "../../domain/identity/local-export";
import type { OrgId } from "../../domain/org-id";
import {
  ExportDirectionForbiddenError,
  ExportPreviewRequiredError,
  NoOrgMembershipError,
} from "./errors";
import type {
  ExportPlanItem,
  LocalExportRepository,
} from "./local-export-ports";
import type { EgressGuard, ExportTransport } from "./local-org-ports";
import type { AuthorizeDeps } from "./authorize";
import { disclose } from "../security/permission-filter";
import type { ExportableArtifact } from "./local-export-ports";
import type { IdentityRepository } from "./ports";

/**
 * ⚠ Extends `AuthorizeDeps` because the export READS tenant content and hands titles back.
 * That is a guarded read like any other (UC-0.3 R7), so the use case needs what a decision
 * needs. In a single-member local organization the verdict is always "allowed" -- which is
 * precisely why the wiring must exist rather than be assumed: it is the shape that makes
 * "somebody reused the export reader for a shared organization" a compile-time problem
 * instead of a silent one.
 */
export interface ExportDeps extends AuthorizeDeps {
  readonly repo: IdentityRepository;
  readonly exports: LocalExportRepository;
  readonly egress: EgressGuard;
  readonly transport: ExportTransport;
  /** Injected so the freshness rule is assertable without waiting fifteen minutes. */
  readonly now: () => number;
}

/**
 * 两侧成员资格 + 方向，一次答完。
 *
 * ⚠ 成员资格先于方向。反过来的话，一个不属于任何一边的调用方能通过错误码分辨出
 *   「那个组织是本地组织」——而本地组织的存在本身就是它要隐藏的东西之一（F16）。
 */
async function requireBothSidesAndDirection(
  repo: IdentityRepository,
  input: { readonly userId: string; readonly fromLocalOrgId: OrgId; readonly toOrgId: OrgId },
): Promise<void> {
  const fromMembership = await repo.findOrgMembership(input.userId, input.fromLocalOrgId);
  if (fromMembership === null) throw new NoOrgMembershipError();
  const toMembership = await repo.findOrgMembership(input.userId, input.toOrgId);
  // 导出是**一个人**把自己的东西放进一个他也在的组织。不是一次投递给陌生组织的推送。
  if (toMembership === null) throw new NoOrgMembershipError();

  const from = await repo.findOrganization(input.fromLocalOrgId);
  const to = await repo.findOrganization(input.toOrgId);
  if (from === null || to === null) throw new NoOrgMembershipError();

  if (!isExportDirectionAllowed(from.kind, to.kind)) {
    // 反向导入走到这里就结束了。⚠ 契约里**没有**反向操作，这条错误码是给
    // 「把参数填反了」准备的，不是给一个未实现的功能占位——那两者的区别在于
    // 后者会让人以为将来会实现。
    throw new ExportDirectionForbiddenError();
  }
}


/**
 * The guarded read behind both operations.
 *
 * ⚠ `path: "file-browser"` is not decoration: `disclose` refuses any id that is not in
 * `PROPAGATION_PATHS`, so a new read path cannot be built without appearing in the registry
 * where R7's coverage claim is made. An EXISTING path is used rather than a new one on
 * purpose -- picking items out of your own local files to export IS browsing files, and a
 * made-up path id would read as covered while covering nothing new.
 *
 * ⚠ `withheld` items are simply not exportable. That is not an error, for the same reason a
 * missing id is not: the contract has no code for either (`KNOWN_CONTRACT_GAPS.C_F17_1`),
 * the preview lists what the person may actually send, and an export naming anything else
 * fails the selection check.
 */
async function readExportable(
  deps: ExportDeps,
  userId: string,
  fromLocalOrgId: OrgId,
  artifactIds: readonly string[],
): Promise<readonly ExportableArtifact[]> {
  const guarded = await deps.exports.findExportable(fromLocalOrgId, artifactIds);
  const d = await disclose<ExportableArtifact>(deps, {
    userId, orgId: fromLocalOrgId, action: "read", path: "file-browser", items: guarded,
  });
  return d.visible.map((v) => v.payload);
}

export interface PreviewExportInput {
  readonly userId: string;
  readonly fromLocalOrgId: OrgId;
  readonly toOrgId: OrgId;
  readonly artifactIds: readonly string[];
}

export interface PreviewExportResult {
  readonly items: readonly {
    readonly artifactId: string;
    readonly title: string;
    readonly willBeVisibleTo: readonly { kind: string; id: string; name: string }[];
  }[];
  readonly token: string;
}

/**
 * 逐项预览：**哪些材料会离开本机，以及它们进去之后谁会看到**。
 *
 * ⚠ 第二句是重点，也是这个操作存在的全部理由。一个只列出「你要导 3 件东西」的预览，
 *   用户点确认时并不知道自己在同意什么——「导给公司」和「导给公司里 40 个人都能读」
 *   是两个不同的决定，而后者才是真实发生的那个。
 */
export async function previewExport(
  deps: ExportDeps,
  input: PreviewExportInput,
): Promise<PreviewExportResult> {
  await requireBothSidesAndDirection(deps.repo, input);

  const exportable = await readExportable(deps, input.userId, input.fromLocalOrgId, input.artifactIds);
  if (exportable.length === 0) {
    // 一件都没有 ⇒ 没有可确认的清单，也就没有令牌可发。
    // 迁移 0016 的 CHECK 同样拒绝空清单——一次「导出零件东西」不是一次导出。
    throw new ExportPreviewRequiredError();
  }

  const willBeVisibleTo = await deps.exports.previewVisibility(input.toOrgId);
  const { token } = await deps.exports.createPreview({
    fromLocalOrgId: input.fromLocalOrgId,
    toOrgId: input.toOrgId,
    actorId: input.userId,
    // 冻结的是**真实存在的那一组**，不是调用方给的那一组。
    artifactIds: exportable.map((a) => a.artifactId),
  });

  return {
    items: exportable.map((a) => ({
      artifactId: a.artifactId,
      title: a.title,
      // 同一份可见性给每一条——副本到达时都是未绑定的，因而都是组织级可见
      // （F04 记的读模型：unbound => org-wide）。逐条算一遍会得到同一个答案，
      // 但会让人以为它们可能不同。
      willBeVisibleTo: willBeVisibleTo.map((s) => ({ kind: s.kind, id: s.id, name: s.name })),
    })),
    token,
  };
}

export interface ExportToOrganizationInput {
  readonly userId: string;
  readonly fromLocalOrgId: OrgId;
  readonly toOrgId: OrgId;
  readonly artifactIds: readonly string[];
  readonly confirmedPreviewToken: string;
}

export interface ExportToOrganizationResult {
  readonly copiedArtifactIds: readonly string[];
  readonly localProvenanceEventId: string;
  readonly targetProvenanceEventId: string;
}

export async function exportToOrganization(
  deps: ExportDeps,
  input: ExportToOrganizationInput,
): Promise<ExportToOrganizationResult> {
  await requireBothSidesAndDirection(deps.repo, input);

  /* ── 3. 令牌：原子核销。这一步之后，「人确认过」这件事已经被花掉了 ── */
  const consumed = await deps.exports.consumePreview(
    input.fromLocalOrgId,
    input.confirmedPreviewToken,
    input.userId,
  );
  if (consumed === null) throw new ExportPreviewRequiredError();
  if (!isPreviewFresh(consumed.issuedAtMs, deps.now())) {
    // 已经核销掉了，且**不退回**——迁移 0016 的触发器连退回都不允许。
    // 一个「过期就还给你」的令牌等于没有过期。
    throw new ExportPreviewRequiredError();
  }
  if (consumed.toOrgId !== input.toOrgId) throw new ExportPreviewRequiredError();
  /* ── 4. 确认过的清单不能被事后裁剪或替换 ── */
  if (!sameSelection(input.artifactIds, consumed.artifactIds)) {
    throw new ExportPreviewRequiredError();
  }

  const exportable = await readExportable(deps, input.userId, input.fromLocalOrgId, consumed.artifactIds);
  if (exportable.length !== consumed.artifactIds.length) {
    // 预览之后、导出之前，有东西消失了。令牌已花掉，用户要重新看一眼清单。
    throw new ExportPreviewRequiredError();
  }

  /* ── 计划先定，字节后搬：目标键要在搬运之前就确定下来 ── */
  const plan: ExportPlanItem[] = exportable.map((a) => {
    const targetArtifactId = `art-imp-${randomUUID()}`;
    return {
      sourceArtifactId: a.artifactId,
      targetArtifactId,
      title: a.title,
      source: a.source,
      synthesized: a.synthesized,
      versions: a.versions.map((v) => {
        const targetVersionId = `ver-imp-${randomUUID()}`;
        return {
          sourceVersionId: v.versionId,
          targetVersionId,
          versionNumber: v.versionNumber,
          sourceObjectKey: v.objectStorageKey,
          // ⚠ 必须换前缀：`local/<orgId>/` 是「不许出本机」的可指认集合，
          // 迁移 0015 的触发器两个方向都挡，正式组织的行写进 local/ 会被拒。
          targetObjectKey: targetObjectKey({
            toOrgId: input.toOrgId,
            targetArtifactId,
            targetVersionId,
          }),
          contentHash: v.contentHash,
          mime: v.mime,
          sizeBytes: v.sizeBytes,
        };
      }),
    };
  });

  /* ── 5. 字节搬运：在 aperture 内，**逐件**打开 ── */
  //
  // ⚠ 这一段的形状就是本 feature 的全部要害。`runExport` 不放宽任何东西——它内部
  //   与 `runLocalOnly` 一样封闭；只有 `send(artifactId, ...)` 会为**那一件**打开，
  //   且只在那一次调用的时长内。于是：
  //     · 导出期间任何**其他**出网（依赖的遥测、重试助手、无关的 await）仍被拒
  //     · 没被选中的成果**搬不出去**——`send` 在任何字节移动之前就抛
  //   「导出期间守卫整个关掉」在成功路径上与此完全一样，区别只在上面这两条路径上。
  await deps.egress.runExport(
    input.fromLocalOrgId,
    plan.map((p) => p.sourceArtifactId),
    async (aperture) => {
      for (const item of plan) {
        await aperture.send(item.sourceArtifactId, async () => {
          for (const v of item.versions) {
            await deps.transport.push({
              artifactId: item.sourceArtifactId,
              toOrgId: input.toOrgId,
              sourceObjectKey: v.sourceObjectKey,
              targetObjectKey: v.targetObjectKey,
              mime: v.mime,
            });
          }
        });
      }
    },
  );

  /* ── 6. 副本行 + 两侧审计，一个事务。审计写不下去，这次导出就没有发生过 ── */
  const committed = await deps.exports.commitExport({
    fromLocalOrgId: input.fromLocalOrgId,
    toOrgId: input.toOrgId,
    actorId: input.userId,
    ownerDisplayId: input.userId,
    items: plan,
  });

  return {
    // ⚠ 源 id，不是副本 id。契约的 `copiedArtifactIds` 表达不了这个映射
    // （`KNOWN_CONTRACT_GAPS.C_F17_2`），映射写在两侧事件的 `detail.copies` 里。
    copiedArtifactIds: plan.map((p) => p.sourceArtifactId),
    localProvenanceEventId: committed.localProvenanceEventId,
    targetProvenanceEventId: committed.targetProvenanceEventId,
  };
}
