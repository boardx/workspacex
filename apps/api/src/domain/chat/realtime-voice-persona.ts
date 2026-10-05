/**
 * Chat 语音模式（实时数字人）的角色人设——纯函数，无 I/O。
 *
 * ADR-121 决策 1：只有一个共享实时运行时，角色只贡献配置。这里就是「角色 → 实时会话配置」的
 * 唯一映射：指令（instructions）与音色（voice）都由服务端按已发布角色推导，客户端不能指定。
 *
 * 音色绑定遵循 CONTRACT.md §15「Role voice semantics are resolved to provider voice bindings by
 * deployment policy」：部署侧用一份 JSON 映射（`KERNEL_OMNI_REALTIME_VOICE_MAP`）把角色绑到供应商
 * 音色，键按 agentId → 头像 key（dh-*）→ roleCategory 的优先级匹配，未命中回落默认音色。
 */

export const DEFAULT_REALTIME_VOICE = "Maia";
export const GENERIC_ASSISTANT_NAME = "通用助手";

export interface RealtimeVoiceRole {
  readonly agentId: string | null;
  readonly name: string;
  readonly duty: string | null;
  readonly tags: readonly string[];
  readonly avatarKey: string | null;
  readonly roleCategory: string | null;
}

export type RealtimeVoiceMap = Readonly<Record<string, string>>;

/** 供应商音色名只允许字母数字、空格与 `-_`（官方音色含 Theo Calm 等名称），非法条目整条忽略（不让一条坏配置拖垮所有会话）。 */
const VOICE_NAME = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/;

export function parseRealtimeVoiceMap(raw: string | undefined): RealtimeVoiceMap {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === "string" && VOICE_NAME.test(value)) out[key] = value;
  }
  return out;
}

export function resolveRealtimeVoice(role: RealtimeVoiceRole, map: RealtimeVoiceMap, fallback: string = DEFAULT_REALTIME_VOICE): string {
  for (const key of [role.agentId, role.avatarKey, role.roleCategory]) {
    if (key && Object.prototype.hasOwnProperty.call(map, key)) return map[key]!;
  }
  return fallback;
}

export function genericRealtimeVoiceRole(): RealtimeVoiceRole {
  return { agentId: null, name: GENERIC_ASSISTANT_NAME, duty: null, tags: [], avatarKey: null, roleCategory: null };
}

export function buildRealtimeVoiceInstructions(role: RealtimeVoiceRole): string {
  const lines = [
    `你是 WorkspaceX 的数字人「${role.name}」，正在和用户进行实时语音对话。`,
  ];
  if (role.duty) lines.push(`你的职责：${role.duty}。`);
  if (role.tags.length > 0) lines.push(`你擅长：${role.tags.join("、")}。`);
  lines.push(
    "像真人面对面交流一样自然、温和、简洁地回答，使用口语化短句和自然停顿，避免播音腔，也不要朗读 Markdown 符号或列表编号。",
    "语音模式下你不能调用工具、技能或工作流，也不能读写文件。用户要求执行这类任务时，简短说明语音模式暂不支持，并建议挂断后切换到文字对话继续。",
    "遵循前面的已发布角色画像、专业方法和能力边界；不要用通用助手身份替代所选数字人，也不要声称真实大学任职或机构背书。",
    "先用一两句直接回应，再按需要展开；不要每轮重复自我介绍。",
    "不要编造你没有的信息；不确定时直接说明。",
  );
  return lines.join("\n");
}
