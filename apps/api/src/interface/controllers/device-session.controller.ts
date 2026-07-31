/**
 * F03 的两条路由（org-admin UC-1.1 第五节）。协议适配，判断全在 `application`。
 *
 *   GET  /me/sessions                          设置 → 设备与会话
 *   POST /me/sessions/:targetSessionId/revoke  踢下线
 *
 * ## 为什么路径里没有 userId
 *
 * `usecases.md` 的 `pre` 逐字：「只能列/踢**自己**的会话」。路径里出现 userId 就等于
 * 承认「可以指定别人」，然后正确性全靠一句 `if (param !== principal.userId)`——
 * 而那句 if 是可以被后来的人「顺手支持管理员视图」删掉的。`/me/` 让越权在**路由层面**
 * 无法表达。管理员踢别人是 `removeOrgMember` 的事，不是这里。
 *
 * ## 为什么是 `POST …/revoke` 而不是 `DELETE …`
 *
 * 吊销**不是删除**（I-7：写标记，记录仍在）。用 `DELETE` 会让 HTTP 动词说出与语义相反的话，
 * 而这条语义正是本 feature 的全部——「被踢了」和「从来没有过」必须可分辨。
 * 与本束 `removeOrgMember` 写成 `POST …/remove` 是同一条理由。
 *
 * ## ⚠ 依据等级
 *
 * 整块能力在原型中是「原型确认缺失」（`KNOWN_CONTRACT_GAPS.OA1`）：30 天、设备指纹、
 * 踢下线三项全部出自 `[Backlog]`，两个操作的形状**是提案不是裁决**。
 * 这里逐字实现那个提案，没有自创任何字段，也没有把它当成已确认需求。
 */
import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import { orgAdmin as C } from "@repo/contracts";
import {
  DeviceSessionError,
  kickDeviceSession,
  listDeviceSessions,
  type DeviceSessionDeps,
} from "../../application/auth/device-sessions";
import {
  CLOCK,
  SESSION_TOKEN_STORE,
  type Clock,
  type SessionTokenStore,
} from "../../application/auth/ports";
import { IDENTITY_REPOSITORY, type IdentityRepository } from "../../application/identity/ports";
import { toOrgId } from "../../domain/org-id";
import { assertPrincipal, type Principal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";
import type { RequestLike } from "../device-context";

/** 导出，供 `contract-single-source.test.ts` 断言与契约是**同一个对象**而非长得像。 */
export const KICK_DEVICE_SESSION_SCHEMA = C.operations.kickDeviceSession.in;

type KickBody = { targetSessionId: string; confirmed: true };

/** `Authorization: Bearer <token>`。与 `SessionTokenPrincipalResolver` 同一条规则。 */
function bearerToken(req: RequestLike): string | null {
  const raw = req.headers.authorization ?? req.headers.Authorization;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  return /^Bearer\s+(.+)$/i.exec(value.trim())?.[1] ?? null;
}

@Controller()
export class DeviceSessionController {
  constructor(
    @Inject(SESSION_TOKEN_STORE) private readonly sessions: SessionTokenStore,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(IDENTITY_REPOSITORY) private readonly identity: IdentityRepository,
  ) {}

  private get deps(): DeviceSessionDeps {
    return { sessions: this.sessions, clock: this.clock };
  }

  /**
   * 契约两个操作的 `err` 里都有 `NO_ORG_MEMBERSHIP`，所以它必须真的能被抛出——
   * 「一个不会被任何路径抛出的错误码读起来像覆盖，而它什么都没覆盖」（`OrgAdminError` 头注）。
   *
   * ⚠ 从库里读，不从 principal 读。`principal.orgId` 是会话记录里的值，
   *   而成员资格可能在这条会话签发之后被撤销——那时会话还在，成员资格已经没了。
   */
  private async assertMember(principal: Principal): Promise<void> {
    const membership = await this.identity.findOrgMembership(
      principal.userId,
      toOrgId(principal.orgId),
    );
    if (membership === null) throw new ForbiddenException({ reasonCode: "NO_ORG_MEMBERSHIP" });
  }

  /**
   * ⚠ `current` 由**服务端**解析，不由客户端声明。
   *
   * 客户端当然知道自己手里的 token，但让它自报「哪一行是我」意味着界面可以把
   * 「当前设备」标错——而「当前设备」这一行通常是唯一不该被踢的那一行。
   *
   * 解析不出来（例如走的是测试注入 principal 而非 bearer token）时**每行都是 false**，
   * 不是随便挑一行。
   */
  @Get("/me/sessions")
  async list(@CurrentPrincipal() principal: Principal, @Req() req: RequestLike) {
    assertPrincipal(principal);
    await this.assertMember(principal);
    const token = bearerToken(req);
    const current = token === null ? null : await this.sessions.findByToken(token);
    return listDeviceSessions(this.deps, {
      userId: principal.userId,
      currentSessionId: current?.id ?? null,
    });
  }

  /**
   * 200，不是 Nest 对 POST 默认的 201：没有任何东西被创建，一条已存在的会话被打上标记。
   */
  @HttpCode(HttpStatus.OK)
  @Post("/me/sessions/:targetSessionId/revoke")
  async kick(
    @Param("targetSessionId") targetSessionId: string,
    // ⚠ 契约的 `in` 同时含 `targetSessionId` 与 `confirmed`，所以 body 里也有一份
    // 路径参数的回声（与 `inviteOrgMember` 同一形态）。**路径参数赢**——
    // 两处不一致时以 URL 为准，因为那是这条请求真正指向的资源。
    @Body(new ZodBodyPipe(KICK_DEVICE_SESSION_SCHEMA)) body: KickBody,
    @CurrentPrincipal() principal: Principal,
  ) {
    assertPrincipal(principal);
    await this.assertMember(principal);
    try {
      return await kickDeviceSession(this.deps, {
        // userId 恒来自 principal。没有任何入参能指定「替谁踢」。
        userId: principal.userId,
        targetSessionId,
        confirmed: body.confirmed,
      });
    } catch (e) {
      if (e instanceof DeviceSessionError) {
        // 409：目标已经不是你看到的那个状态（不存在 / 不是你的 / 已过期出存储）。
        // 三种情况同码同状态，见 `kickDeviceSession` 的说明与登记的契约缺口。
        throw new ConflictException({ reasonCode: e.reasonCode });
      }
      throw e;
    }
  }
}
