/**
 * `POST /auth/register` -- protocol adaptation only (F19 / UC-1.5).
 *
 * Every judgement is in `application`; this file turns a body into a call and an exception
 * into a status code.
 *
 * ## Why it is `@Public()`
 *
 * The whole point of registration is that the caller has no account yet. `PrincipalGuard` is
 * registered globally precisely so that "forgot to protect a route" is impossible, which
 * means opening one has to be an explicit, greppable act -- and this is the first route in
 * the kernel that needs it.
 *
 * ⚠ Public does NOT mean unauthenticated-and-therefore-unrestricted: the invite code IS the
 * authorization for this endpoint. That is the whole reason the product is invite-only
 * ("只能被邀请入组织") and the whole reason the code's failure mode is anti-enumeration
 * rather than helpful.
 */
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Inject,
  Post,
  Res,
} from "@nestjs/common";
import { auth as C } from "@repo/contracts";
import { registerWithInvite } from "../../application/auth/register-with-invite";
import { bootstrapFirstUser } from "../../application/auth/bootstrap-first-user";
import {
  ensureDefaultAgent,
  ENSURE_DEFAULT_AGENT_REPOSITORY,
  type EnsureDefaultAgentRepository,
} from "../../application/agent/ensure-default-agent";
import {
  ensureDeepResearchAgent,
  ENSURE_DEEP_RESEARCH_AGENT_REPOSITORY,
  type EnsureDeepResearchAgentRepository,
} from "../../application/agent/ensure-deep-research-agent";
import {
  ensureImageGenAgent,
  ENSURE_IMAGE_GEN_AGENT_REPOSITORY,
  type EnsureImageGenAgentRepository,
} from "../../application/agent/ensure-image-gen-agent";
import {
  BootstrapUnavailableError,
  EmailTakenError,
  InviteCodeInvalidError,
} from "../../application/auth/errors";
import {
  PASSWORD_HASHER,
  REGISTRATION_REPOSITORY,
  type PasswordHasher,
  type RegistrationRepository,
} from "../../application/auth/ports";
import {
  EMAIL_VERIFICATION_TOKEN_CODEC,
  type EmailVerificationTokenCodec,
} from "../../application/auth/email-verification-ports";
import { Public } from "../public.decorator";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";
import { pendingVerificationSetCookie } from "../pending-verification-cookie";

/** Exported so `contract-single-source.test.ts` can assert reference identity with the contract. */
export const REGISTER_SCHEMA = C.operations.redeemInviteAndCreateOrg.in;
export const BOOTSTRAP_SCHEMA = C.operations.bootstrapFirstUser.in;

type RegisterBody = {
  code: string;
  email: string;
  password: string;
  displayName: string;
  orgName: string;
};

type BootstrapBody = Omit<RegisterBody, "code">;

@Controller()
export class AuthRegistrationController {
  constructor(
    @Inject(REGISTRATION_REPOSITORY) private readonly repo: RegistrationRepository,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(EMAIL_VERIFICATION_TOKEN_CODEC) private readonly verificationTokens: EmailVerificationTokenCodec,
    @Inject(ENSURE_DEFAULT_AGENT_REPOSITORY) private readonly defaultAgents: EnsureDefaultAgentRepository,
    @Inject(ENSURE_DEEP_RESEARCH_AGENT_REPOSITORY) private readonly deepResearchAgents: EnsureDeepResearchAgentRepository,
    @Inject(ENSURE_IMAGE_GEN_AGENT_REPOSITORY) private readonly imageGenAgents: EnsureImageGenAgentRepository,
  ) {}

  @Public()
  @Post("/auth/bootstrap")
  async bootstrap(@Body(new ZodBodyPipe(BOOTSTRAP_SCHEMA)) body: BootstrapBody) {
    try {
      const result = await bootstrapFirstUser(
        { repo: this.repo, hasher: this.hasher },
        body,
      );
      // 产品裁决（#661 之下）：新组织一落地就要有一个真实、已发布、可直接发消息的默认
      // Agent，用户不需要先自己建/发布一个 agent 才能开始聊。故意在 bootstrap 事务
      // 之外、bootstrap 成功之后调用——`ensureDefaultAgent` 幂等（按 stable_name 去重），
      // 失败就让整个 `/auth/bootstrap` 请求失败并让调用方重试，而不是吞掉错误留一个
      // "组织建成了但没有默认 agent"的半成品状态（不做静默 fallback）。
      await ensureDefaultAgent({ repo: this.defaultAgents }, { orgId: result.orgId, actorId: result.userId });
      // 同一条裁决延伸到 deep-research agent（2026-08-07）：新组织落地就该看到两个可
      // 直接用的 agent，不是"通用助手能聊，deep research 还要自己去后台开一个"。
      await ensureDeepResearchAgent({ repo: this.deepResearchAgents }, { orgId: result.orgId, actorId: result.userId });
      // 同一条裁决第三次延伸（2026-08-07）：图片生成 agent，人类原话"这里要可以直接看到
      // 图片，不是只是文字"——新组织落地即有三个可直接用的系统 agent。
      await ensureImageGenAgent({ repo: this.imageGenAgents }, { orgId: result.orgId, actorId: result.userId });
      return result;
    } catch (e) {
      if (e instanceof BootstrapUnavailableError || e instanceof EmailTakenError) {
        throw new ConflictException({ reasonCode: e.reasonCode });
      }
      throw e;
    }
  }

  /**
   * 201 (Nest's default for POST) -- a resource really is created here, two of them.
   *
   * ## The two failures, and why their statuses differ
   *
   *   400 + `INVITE_CODE_INVALID`  the code is absent, spent, expired or revoked. **All
   *                                four produce this exact response**: same status, same
   *                                error code, same reasonCode, same body shape. Anything
   *                                that distinguished them would prune the 14-character
   *                                search space by hit rate (usecases.md).
   *   409 + `EMAIL_TAKEN`          the address already has an account. This one is
   *                                deliberately informative: UC-1.5 A2 requires the user be
   *                                told to sign in and use the code from there, and a vague
   *                                failure would strand them. Email enumeration is defended
   *                                at `Login` and `RequestPasswordReset`, which are F20's
   *                                and F21's.
   *
   * ⚠ The pipe is attached to the PARAMETER, not the method. A method-level `@UsePipes`
   * runs against EVERY parameter including custom decorators, so the contract schema would
   * be applied to things that are not the body and every request would 400 -- with a symptom
   * that reads as a malformed body and sends you to debug the client.
   */
  @Public()
  @Post("/auth/register")
  async register(
    @Body(new ZodBodyPipe(REGISTER_SCHEMA)) body: RegisterBody,
    @Res({ passthrough: true }) response: { setHeader(name: string, value: string): void },
  ) {
    try {
      const result = await registerWithInvite(
        { repo: this.repo, hasher: this.hasher, verificationTokens: this.verificationTokens },
        {
          code: body.code,
          email: body.email,
          password: body.password,
          displayName: body.displayName,
          orgName: body.orgName,
        },
      );
      // 同一条产品裁决（#662，见 `bootstrap()` 里那段注释）：这条路径同样"落地一个新
      // 组织"（见本方法上方文档"a resource really is created here, two of them"），且是
      // devapp 这类已有首位管理员的实例上，往后创建任何新组织的**唯一**可达路径——
      // `bootstrap()` 那条是实例级仅一次的冷启动路径，用过就不能再用。故意在邮箱验证
      // 完成**之前**调用：组织行已经真实落库（`registerWithInvite` 内部事务已提交），
      // 这个新用户就是这个新组织唯一的成员和唯一的 admin，权限论证与 bootstrap 分支
      // 完全一致（见 `ensure-default-agent.ts` 文件头）。同样不做静默 fallback——失败
      // 就让整个 `/auth/register` 请求失败。
      await ensureDefaultAgent({ repo: this.defaultAgents }, { orgId: result.orgId, actorId: result.userId });
      await ensureDeepResearchAgent({ repo: this.deepResearchAgents }, { orgId: result.orgId, actorId: result.userId });
      await ensureImageGenAgent({ repo: this.imageGenAgents }, { orgId: result.orgId, actorId: result.userId });
      response.setHeader("Set-Cookie", pendingVerificationSetCookie(
        result.pendingIdentityProof,
        process.env.NODE_ENV === "production",
      ));
      const { pendingIdentityProof: _proof, ...contractOutput } = result;
      return contractOutput;
    } catch (e) {
      // ⚠ Nothing from the exception reaches the response except `reasonCode`, which
      // `all-exceptions.filter.ts` re-parses against the closed `AuthReason` enum before
      // emitting. In particular the caught error is never stringified -- `lint-error-leak`
      // bans that in this layer, and here it would be a body containing SQL.
      if (e instanceof InviteCodeInvalidError) {
        throw new BadRequestException({ reasonCode: e.reasonCode });
      }
      if (e instanceof EmailTakenError) {
        throw new ConflictException({ reasonCode: e.reasonCode });
      }
      throw e;
    }
  }
}
