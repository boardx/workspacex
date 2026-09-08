/**
 * 迭代 13（design-delta `design-chat-inputs` §1）—— 设计项目的**参考图**。
 *
 * ## 类型按字节判，不信 Content-Type（V51）
 *
 * 与反馈附件同一条纪律，并且**直接复用** `sniffDeclaredType`：那边已经把 magic byte 的
 * 判定写对过一次，再写一遍只会是第二处可漂的副本。区别只在两处上限——参考图单张 4MB
 * （视觉输入按张计费，比一般附件更该收紧），一个项目最多 3 张。
 *
 * ## 「已满 3 张」为什么在应用层判而不是 CHECK
 *
 * 那是跨行约束，SQL 表达它要么加触发器要么加冗余计数列，两者都比"插入前先 count"更容易
 * 出错。CHECK 只覆盖单行能判的（类型、大小），它的职责是"绕过应用层直接写库"那条路。
 *
 * ## 字节不进库
 *
 * 元信息进 PG，字节进 `ObjectStore`——与 `feedback_attachments` 同形态。
 * 契约层用「`RefImage` 不含字节」把这件事钉住（V55）：列表接口带 `refImages`，
 * 字节进库迟早有人 `SELECT *` 把它捎出去。
 */
import { randomBytes } from "node:crypto";
import { designWorkbench } from "@repo/contracts";
import type { ObjectStore } from "../artifact/ports";
import type { OrgId } from "../../domain/org-id";
import { sniffDeclaredType } from "../feedback/upload-feedback-attachment";
import { DesignProjectNotFoundError, DesignProjectNotOwnerError, loadProjectView, type DesignProjectDeps, type DesignProjectView } from "./project-shared";

/** 被拒的三种情形。合成契约里同一个 `REF_IMAGE_REJECTED`——屏上给用户的下一步是同一句话。 */
export type RefImageRejectReason = "TYPE" | "SIZE" | "TOO_MANY";

export class RefImageRejectedError extends Error {
  constructor(readonly reason: RefImageRejectReason, message: string) {
    super(message);
    this.name = "RefImageRejectedError";
  }
}

export interface RefImageRow {
  readonly id: string;
  readonly name: string;
  readonly objectKey: string;
  readonly mime: designWorkbench.ImageMime;
  readonly size: number;
  readonly createdAt: string;
}

/** 参考图的元信息仓储。字节由调用方先写进 `ObjectStore`（同 `upload-feedback-attachment`）。 */
export interface RefImageRepository {
  listByProject(projectId: string): Promise<readonly RefImageRow[]>;
  insert(row: RefImageRow & { readonly projectId: string; readonly uploadedBy: string; readonly sha256: string }): Promise<void>;
  remove(projectId: string, imageId: string): Promise<boolean>;
}

export interface RefImageDeps extends DesignProjectDeps {
  readonly store: ObjectStore;
  readonly refImages: RefImageRepository;
}

const newId = (): string => `refimg-${randomBytes(12).toString("hex")}`;
const objectKeyFor = (orgId: OrgId, projectId: string, id: string): string => `design-ref-images/${orgId}/${projectId}/${id}`;

export async function uploadRefImage(
  deps: RefImageDeps,
  input: {
    readonly orgId: OrgId;
    readonly projectId: string;
    readonly ownerId: string;
    readonly name: string;
    readonly declaredContentType: string;
    readonly bytes: Uint8Array;
  },
): Promise<{ readonly image: designWorkbench.RefImage }> {
  const project = await deps.projects.get(input.projectId);
  if (project === null) throw new DesignProjectNotFoundError();
  if (project.ownerId !== input.ownerId) throw new DesignProjectNotOwnerError();

  // ⚠ 三条判定的**顺序**是有意的：先判类型（最便宜、最常见的错），再判大小，
  // 最后才查已有张数（要一次库往返）。反过来会让"传了个 .exe"也去查一次库。
  const sniffed = sniffDeclaredType(input.declaredContentType, input.bytes);
  if (sniffed === null || !designWorkbench.isImageMime(sniffed)) {
    throw new RefImageRejectedError("TYPE", `declared ${input.declaredContentType} does not match bytes, or is not an accepted image type`);
  }
  if (input.bytes.byteLength > designWorkbench.PROTOTYPE_REF_IMAGE_MAX_BYTES) {
    throw new RefImageRejectedError("SIZE", `${input.bytes.byteLength} bytes exceeds the per-image limit`);
  }
  const existing = await deps.refImages.listByProject(input.projectId);
  if (existing.length >= designWorkbench.PROTOTYPE_MAX_REF_IMAGES) {
    throw new RefImageRejectedError("TOO_MANY", `project already has ${existing.length} reference images`);
  }

  const id = newId();
  const objectKey = objectKeyFor(input.orgId, input.projectId, id);
  // 先写字节再写元信息：反过来的话，元信息写成功而字节写失败会留下一条**指向不存在对象**
  // 的行——界面显示有这张图，点开是空的。反向的失败（有字节没元信息）只是一个没人引用的
  // 孤儿对象，不会骗人。
  await deps.store.putOnce(objectKey, input.bytes, sniffed);
  const row: RefImageRow = {
    id, name: input.name.trim().slice(0, 200) || "参考图", objectKey, mime: sniffed,
    size: input.bytes.byteLength, createdAt: new Date().toISOString(),
  };
  await deps.refImages.insert({ ...row, projectId: input.projectId, uploadedBy: input.ownerId, sha256: "" });
  return { image: { id: row.id, name: row.name, size: row.size, mime: row.mime, createdAt: row.createdAt } };
}

export async function deleteRefImage(
  deps: RefImageDeps,
  input: { readonly projectId: string; readonly ownerId: string; readonly imageId: string },
): Promise<{ readonly project: DesignProjectView }> {
  const project = await deps.projects.get(input.projectId);
  if (project === null) throw new DesignProjectNotFoundError();
  if (project.ownerId !== input.ownerId) throw new DesignProjectNotOwnerError();
  // 删不到（已经删过了）不报错：重复点删除不该变成一个错误弹窗。对象本身留着不回收——
  // 回收是另一件事（孤儿对象清理），在这里顺手删会让"删元信息成功、删对象失败"变成
  // 一个半完成的操作。
  await deps.refImages.remove(input.projectId, input.imageId);
  return { project: await loadProjectView(deps, input.projectId) };
}

/**
 * 取出要喂给模型的那几张图的**字节**。
 *
 * 只取 `refImageIds` 点名的、且确实属于这个项目的那些——前端传来的 id 不可信。
 * 读不到字节的（对象被删了）跳过而不是整轮失败：少一张参考图不该让这次对话作废。
 */
export async function loadRefImageBytes(
  deps: Pick<RefImageDeps, "store" | "refImages">,
  projectId: string,
  ids: readonly string[],
): Promise<readonly { readonly filename: string; readonly mime: designWorkbench.ImageMime; readonly bytes: Uint8Array }[]> {
  if (ids.length === 0) return [];
  const rows = await deps.refImages.listByProject(projectId);
  const wanted = rows.filter((r) => ids.includes(r.id)).slice(0, designWorkbench.PROTOTYPE_MAX_REF_IMAGES);
  const out: { filename: string; mime: designWorkbench.ImageMime; bytes: Uint8Array }[] = [];
  for (const r of wanted) {
    const bytes = await deps.store.get(r.objectKey);
    if (bytes === null) continue;
    out.push({ filename: r.name, mime: r.mime, bytes });
  }
  return out;
}
