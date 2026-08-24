/**
 * DA-12 应用层虚拟文件系统（VFS）—— URI 寻址方案。
 *
 * ## 先盘点，后定契约（issue 正文逐条记录了盘点结果）
 *
 * 本仓已有至少三套互不相通的"文件"存储：
 *   · `artifacts` / `artifact_versions`（F04 六表模型）—— 业务域物化产出的canonical存储
 *     （survey/interview/canvas/conversation transcript/ai-generated 等，经
 *     `pin-version.ts` 写入，`chat_artifact_landings` 是对话侧到它的指针表）。
 *   · `chat_message_attachments`（#946 F150）—— 对话里用户直接上传的原始文件，自己的行，
 *     `storage_ref` 复用同一个对象存储桶，但**不**在 `artifacts` 表里开一行。
 *   · `agent_runs.model_output_files`（#1624）—— agent 沙箱脚本产出的文件，写回事务前的
 *     瞬态 jsonb 清单，落地那一刻会变成 (a) 一行 `chat_message_attachments`。
 *
 * 三套里，第一套已经有自己的读入口（`files` 契约束的 `listProjectArtifacts` /
 * `getArtifactTree`，`browse-artifacts.ts` 头注写明"列表/树的唯一读入口"）；对话侧还有
 * 两个各自成熟的读用例——`listThreadAttachments`（材料）与 `listThreadArtifacts`（产物）
 * ——各自判权、各自分页、各自是某个右栏 tab 的唯一数据源。
 *
 * `apps/api/tests/kernel/reference-eligibility-gate.test.ts`（F07 "the door is the only
 * door"）把"谁可以指向一个 artifact_version"锁成一张机械核对的白名单：新增一张指向
 * `artifact_versions` 的表是签核动作，不是这个 feature 能单方面做的决定。
 *
 * ⇒ VFS **不建新表、不新增指向 artifact_versions 的外键**。它是一层纯地址转换 +
 * 聚合门面：把已经分别可读的两个对话侧列表（`listThreadAttachments` /
 * `listThreadArtifacts`）投影成同一棵树，每个节点带一个稳定 URI；写路径同理，只是给
 * `uploadAttachment` 这唯一一条通用写入口套一层，返回值多一个 URI 字段，不代替它、
 * 不重复它的任何判断。
 *
 * ## Scheme
 *
 * `vfs://<domain>/<id>`——`domain` 是闭合枚举，`id` 是该 domain 在**它自己的权威表**里
 * 的主键（`chat_message_attachments.id` 或 `artifacts.id`），VFS 自己不发号、不落库。
 * 因此这个 URI 天然"跨会话持久化"：它是已持久化的主键的确定性投影，不是需要额外写
 * 一行才存在的新事实。
 */

export const VFS_DOMAINS = ["attachment", "artifact"] as const;
export type VfsDomain = (typeof VFS_DOMAINS)[number];

export interface VfsUri {
  readonly domain: VfsDomain;
  readonly id: string;
}

const SCHEME = "vfs";
// id 允许字母数字、连字符、下划线——本仓 id 工厂（`ID_FACTORY`/`DECISION_ID_FACTORY`等）
// 产出的 id 形状；不放行 "/"，因为那会让 URI 的第三段起产生歧义。
const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export function buildVfsUri(domain: VfsDomain, id: string): string {
  if (!VFS_DOMAINS.includes(domain)) {
    throw new Error(`buildVfsUri: unknown domain ${domain}`);
  }
  if (!ID_PATTERN.test(id)) {
    throw new Error(`buildVfsUri: id "${id}" is not URI-safe`);
  }
  return `${SCHEME}://${domain}/${id}`;
}

/** 解析失败一律返回 `null`，不抛——调用方（尤其是 resolve 路径）把"格式不对"和
 *  "格式对但查不到"同等对待成"找不到"，与本仓 I-3（不可见与不存在同一出口）同一套纪律。 */
export function parseVfsUri(uri: string): VfsUri | null {
  const m = /^vfs:\/\/([a-z-]+)\/([A-Za-z0-9_-]+)$/.exec(uri);
  if (!m) return null;
  const domain = m[1]!;
  const id = m[2]!;
  if (!VFS_DOMAINS.includes(domain as VfsDomain)) return null;
  return { domain: domain as VfsDomain, id };
}
