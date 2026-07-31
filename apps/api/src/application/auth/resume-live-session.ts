/**
 * `ResumeLiveSession`（F13 / UC-1.2 R4，「三种意外」之三）—— 掉线 / 换设备重开链接。
 *
 * ⚠ **不依赖浏览器 Cookie**（I-23）：恢复凭据是「已验证手机号 + 名单条目」，与 F12
 *   `joinByGroupLink` 判定同一份数据（令牌有效 ∧ 手机号在名单）——这里额外要求
 *   该名单条目**此前已经进过场**（存在一条未结束的 `live_sessions`），否则谈不上「重开」，
 *   而是走 `JoinByGroupLink` 的初次进场路径。
 * ⚠ 换设备接管后**旧设备会话立即失效并提示**：output 的 `takeoverOf` 就是那台旧设备的
 *   `deviceId`，interface 层拿它渲染「你的账号在另一台设备登录」的提示。
 * ⚠ 回到**同一组、同一环节**、本组产出不丢：仓储对**同一条** `live_sessions` 行做
 *   `UPDATE device_id`，不新建行、不改 `group_id` / `entered_at_stage_id`——那正是
 *   「产出不丢」在数据层的意思：产出（便签等）挂在 `participant_id` / `group_id` 上，
 *   而这两者原封不动。
 */
import { normalizePhone } from "./upsert-participant-roster";
import { OrgAdminError } from "./org-invite-errors";
import type { JoinRepository } from "./join-ports";

export interface ResumeLiveSessionDeps {
  readonly repo: JoinRepository;
  readonly now?: () => Date;
}

export interface ResumeLiveSessionUseCaseInput {
  /** ⚠ 同 F12 的 I-10：不带令牌一律拒。 */
  readonly linkToken: string | null;
  readonly phone: string | null;
  /** 短信验证码。本轮不接验证码校验服务（`RequestJoinCode` 不在 F13 范围内），
   *  仅要求非空——真正的校验留给验证码服务接入时补上，不在这里假装验证过。 */
  readonly code: string | null;
  readonly deviceId: string | null;
}

const STUB_STAGE = { id: "stage-pending", index: 0, total: 1 } as const;

export interface ResumeLiveSessionOutput {
  readonly guestIdentityId: string;
  readonly groupId: string;
  readonly stage: typeof STUB_STAGE;
  /** 被接管的旧设备 id；null = 未发生接管。 */
  readonly takeoverOf: string | null;
}

export async function resumeLiveSession(
  deps: ResumeLiveSessionDeps,
  input: ResumeLiveSessionUseCaseInput,
): Promise<ResumeLiveSessionOutput> {
  if (input.linkToken === null || input.linkToken === "") {
    throw new OrgAdminError("LINK_TOKEN_REQUIRED");
  }
  if (input.phone === null || input.phone.trim() === "") {
    throw new OrgAdminError("PHONE_NOT_ON_ROSTER");
  }
  if (input.code === null || input.code.trim() === "") {
    // 契约要求 code min(1)；ValidationPipe 应已在此之前拦下，这里防御性判一次。
    throw new Error("resumeLiveSession: code 为空——契约校验应已在此之前拦下。");
  }
  if (input.deviceId === null || input.deviceId.trim() === "") {
    throw new Error("resumeLiveSession: deviceId 为空——契约校验应已在此之前拦下。");
  }

  const result = await deps.repo.resumeLiveSession({
    token: input.linkToken,
    phone: normalizePhone(input.phone),
    deviceId: input.deviceId,
    now: (deps.now ?? (() => new Date()))(),
  });

  if (!result.ok) {
    if (result.reason === "not-found") throw new OrgAdminError("LINK_REVOKED");
    if (result.reason === "phone-not-on-roster") throw new OrgAdminError("PHONE_NOT_ON_ROSTER");
    if (result.reason === "no-active-session") throw new OrgAdminError("PHONE_NOT_ON_ROSTER");
    const CODE = {
      revoked: "LINK_REVOKED",
      expired: "LINK_EXPIRED",
      used: "LINK_ALREADY_USED",
    } as const;
    throw new OrgAdminError(CODE[result.reason]);
  }

  const r = result.resumed;
  return {
    guestIdentityId: r.guestIdentityId,
    groupId: r.groupId,
    stage: STUB_STAGE,
    takeoverOf: r.takeoverOf,
  };
}
