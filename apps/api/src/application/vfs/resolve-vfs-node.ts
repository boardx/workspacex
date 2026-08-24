/**
 * DA-12 —— `resolveVfsNode`：按 `vfs://` URI 在一个线程的可见集合内查一个节点。
 *
 * 刻意不做"给一个 URI，跨线程/跨项目全局定位"这件事:那需要为 attachment/artifact
 * 两个 domain 各自补一条不依赖 threadId 的判权路径,而 `chat_message_attachments` 目前
 * 唯一的读权限规则就是"这个线程你能不能看"(`resolve-visibility.ts`),脱离 threadId 单独
 * 判权是本文件没有事实依据凭空发明的第二套规则。所以 resolve 复用
 * `listVfsTree`——同一个线程范围内"找到就是找到,找不到与不可见同一个空",不比
 * `listThreadAttachments.findById` 语义更强,也不比它弱。
 */
import { listVfsTree, type VfsNode, type VfsTreeDeps, type VfsTreeInput } from "./vfs-tree";
import { parseVfsUri } from "../../domain/vfs/vfs-uri";

export interface ResolveVfsNodeInput extends VfsTreeInput {
  readonly uri: string;
}

export async function resolveVfsNode(
  deps: VfsTreeDeps,
  input: ResolveVfsNodeInput,
): Promise<VfsNode | null> {
  // 格式不对直接判"找不到"——不比对哪个 domain,不提前抛错泄露"格式对/不对"的区分,
  // 与本仓 I-3(不可见与不存在同一出口)同一纪律的延伸。
  if (parseVfsUri(input.uri) === null) return null;

  const { nodes } = await listVfsTree(deps, input);
  return nodes.find((n) => n.uri === input.uri) ?? null;
}
