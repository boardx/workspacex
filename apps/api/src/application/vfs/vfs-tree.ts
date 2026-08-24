/**
 * DA-12 —— `listVfsTree`：一个线程下「材料 + 产物」两个既有列表的统一寻址投影。
 *
 * 不是第三个判权实现：`listThreadAttachments` 与 `listThreadArtifacts` 各自先
 * `resolveVisibility`（同一函数），本文件只是把它们的返回值并成一棵树、每个节点挂一个
 * `vfs://` URI。任何一边的判权/过滤规则改了，这里自动跟着改——没有第二份可见性逻辑
 * 需要保持同步。
 *
 * 线程不可见时，两个用例都会抛 `ThreadNotVisibleError`；本文件不 catch，原样冒泡给
 * 调用方（controller 或调用方测试）按既有约定映射成 404。
 */
import { listThreadAttachments, type ListThreadAttachmentsDeps } from "../chat/list-thread-attachments";
import { listThreadArtifacts, type ListThreadArtifactsDeps } from "../chat/list-thread-artifacts";
import { buildVfsUri, type VfsDomain } from "../../domain/vfs/vfs-uri";

export interface VfsNode {
  readonly uri: string;
  readonly domain: VfsDomain;
  /** 展示名——附件是文件名，产物是落地标题。 */
  readonly name: string;
  readonly mime: string | null;
  readonly bytes: number | null;
  /**
   * 排序键。附件恒有 `createdAt`；产物只有 pinned 态才有 `pinnedAt`（draft/live 没有
   * "定版时间"这件事，见 `ThreadArtifactItem` 本身的形状）——这不是本文件能补的信息，
   * 缺失时排在同名候选之后，如实反映"这类节点没有这个维度"，不是伪造一个时间戳。
   */
  readonly sortKey: string | null;
  readonly messageId: string;
}

export interface VfsTreeDeps extends ListThreadAttachmentsDeps, ListThreadArtifactsDeps {}

export interface VfsTreeInput {
  readonly userId: string;
  readonly orgId: import("../../domain/org-id").OrgId;
  readonly projectId: string | null;
  readonly threadId: string;
}

export interface VfsTreeResult {
  readonly nodes: readonly VfsNode[];
}

export async function listVfsTree(deps: VfsTreeDeps, input: VfsTreeInput): Promise<VfsTreeResult> {
  const [attachments, artifacts] = await Promise.all([
    listThreadAttachments(deps, input),
    listThreadArtifacts(deps, input),
  ]);

  const attachmentNodes: VfsNode[] = attachments.items.map((a) => ({
    uri: buildVfsUri("attachment", a.id),
    domain: "attachment",
    name: a.filename,
    mime: a.mime,
    bytes: a.bytes,
    sortKey: a.createdAt,
    messageId: a.messageId,
  }));

  const artifactNodes: VfsNode[] = artifacts.items.map((a) => ({
    uri: buildVfsUri("artifact", a.artifactId),
    domain: "artifact",
    name: a.title,
    mime: null,
    bytes: null,
    sortKey: a.pinnedAt,
    messageId: a.messageId,
  }));

  // 新的在前；无 sortKey 的节点排最后（信息缺失不是 0，不该排到最前）。
  const nodes = [...attachmentNodes, ...artifactNodes].sort((x, y) => {
    if (x.sortKey === null && y.sortKey === null) return 0;
    if (x.sortKey === null) return 1;
    if (y.sortKey === null) return -1;
    return x.sortKey < y.sortKey ? 1 : x.sortKey > y.sortKey ? -1 : 0;
  });

  return { nodes };
}
