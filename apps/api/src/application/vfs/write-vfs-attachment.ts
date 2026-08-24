/**
 * DA-12 —— `writeVfsAttachment`:VFS 唯一的写入口,原样委派给 `uploadAttachment`
 * (#946 F150 本仓唯一的通用文件写路径:判权/大小白名单/数量上限/先存储后落库/抽取触发,
 * 一条不少),多返回一个 `uri` 字段。
 *
 * ## 为什么 artifact domain 没有对应的 `writeVfsArtifact`
 *
 * `artifacts`/`artifact_versions` 域已经有五六个各自成熟的写入口
 * (`pinVersion`/`materializeArtifact`/`landAsArtifact`/ingestion pipeline……),每一个
 * 都带自己的业务前置条件(来源类型、物化计划、下游引用资格)。给它们外面再套一层
 * "统一写口"要么变成透传(没有意义的包装),要么开始替它们做判断(第二套业务规则,
 * 本仓五次因此漂移的教训)。VFS 对 artifact domain 只做地址投影(`vfs-tree.ts`/
 * `resolve-vfs-node.ts`),不新增写路径——这是盘点后的判断,不是遗漏。
 */
import { uploadAttachment, type UploadAttachmentDeps, type UploadAttachmentInput, type UploadedAttachment } from "../chat/upload-attachment";
import { buildVfsUri } from "../../domain/vfs/vfs-uri";

export interface WrittenVfsAttachment extends UploadedAttachment {
  readonly uri: string;
}

export async function writeVfsAttachment(
  deps: UploadAttachmentDeps,
  input: UploadAttachmentInput,
): Promise<WrittenVfsAttachment> {
  const result = await uploadAttachment(deps, input);
  return { ...result, uri: buildVfsUri("attachment", result.id) };
}
