"use client";
import * as React from "react";
import { Mic, UserCheck, ArrowRightLeft, DoorOpen, RefreshCw, ShieldAlert } from "lucide-react";
import { StateShell } from "@/components/state/state-shell";
import type { UiState } from "@/lib/ui-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { JOIN_CONTEXT, type JoinScene, type GroupViewRole } from "@/lib/mock/entry";

/**
 * 链接落地页表单（UC-1.2 R3/R8 + D-01）——只问一件事：确认你是谁。
 *
 * 两条正交的预览维度：
 *  - `?state=` 走七态（经 StateShell），异常态是原型最缺的东西；
 *  - `?scene=` 走 D-01 明列的三种意外（别组链接 / 不在名单 / 掉线换设备），
 *    这三条是业务替代流，不是机械态，故单独一维，只在 default 态下生效。
 */
export function JoinForm({
  state,
  scene,
  role,
}: {
  state: UiState;
  scene: JoinScene;
  role: GroupViewRole;
}) {
  const [codeSent, setCodeSent] = React.useState(false);
  // 「申请加入」三态：等待中 / 已批准 / 已拒绝（R8 必须三态可见）
  const [applyStatus, setApplyStatus] = React.useState<"idle" | "waiting" | "approved" | "rejected">(
    "idle",
  );
  const [recovered, setRecovered] = React.useState(false);

  // ── 七态优先：非 default 一律交给 StateShell ────────────────────────
  if (state !== "default") {
    return (
      <StateShell
        state={state}
        className="flex flex-col gap-4"
        skeletonRows={3}
        emptyHint="本组还没有任何画布或便签，进入后等引导师开场"
        errors={{ code: "验证码不正确或已过期，请重新获取" }}
        depFailure={{
          what: "短信服务暂时不可用，无法下发验证码——可请引导师在「分组与签到」里直接把你加进来",
        }}
        denial={{
          layer: "project",
          reason: "这条链接已失效或你不在本场名单里，请找引导师重发",
        }}
        successMessage="验证通过，正在进入第 2 组…"
      >
        <VerifyForm ctx={JOIN_CONTEXT} codeSent={codeSent} onGetCode={() => setCodeSent(true)} />
      </StateShell>
    );
  }

  // ── default 态：按场景分流 ──────────────────────────────────────────
  if (scene === "wrong-group") {
    return (
      <div
        role="status"
        data-testid="join-wrong-group"
        className="flex flex-col gap-3 rounded-lg border border-border bg-muted p-4"
      >
        <div className="flex items-center gap-2">
          <ArrowRightLeft aria-hidden className="h-4 w-4 text-primary" />
          <span className="text-14 font-semibold">你在第 {JOIN_CONTEXT.groupNo} 组</span>
          <Badge tone="primary">已自动带你回本组</Badge>
        </div>
        <p className="text-12 text-muted-foreground">
          你打开的是别组的链接。系统按名单里你手机号所属的组，把你带到了{" "}
          <strong className="text-background-foreground">第 {JOIN_CONTEXT.groupNo} 组 · {JOIN_CONTEXT.groupName}</strong>
          ——这不是错误，你不需要重新找链接。
        </p>
        <Button variant="primary" size="lg" data-testid="join-enter" className="self-start">
          进入我的小组
        </Button>
      </div>
    );
  }

  if (scene === "not-listed") {
    return (
      <div className="flex flex-col gap-4" data-testid="join-not-listed">
        <div className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/5 p-4">
          <DoorOpen aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
          <div className="flex flex-col gap-1">
            <span className="text-14 font-semibold">先停在门口</span>
            <p className="text-12 text-muted-foreground">
              你的手机号验证通过了，但不在本场名单里。在引导师批准前，你还进不了任何组、看不到任何内容。
            </p>
          </div>
        </div>

        <div
          data-testid="join-apply-status"
          className="flex flex-col gap-2 rounded-md border border-border-subtle bg-panel p-3"
        >
          {applyStatus === "idle" && (
            <>
              <p className="text-12 text-muted-foreground">
                点下面这个按钮，引导师的「分组与签到」里会出现一条待批。
              </p>
              <Button
                variant="primary"
                size="lg"
                onClick={() => setApplyStatus("waiting")}
                data-testid="join-apply"
                className="self-start"
              >
                向引导师申请加入
              </Button>
            </>
          )}
          {applyStatus === "waiting" && (
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Badge tone="warning">等待中</Badge>
                <span className="text-12 text-muted-foreground">
                  已发出申请，引导师批准后你会被指到某一组并自动进场。
                </span>
              </div>
            </div>
          )}
          {applyStatus === "approved" && (
            <div className="flex items-center gap-2">
              <Badge tone="primary">已批准</Badge>
              <span className="text-12 text-muted-foreground">
                引导师把你加进了第 {JOIN_CONTEXT.groupNo} 组，刷新即进场。
              </span>
            </div>
          )}
          {applyStatus === "rejected" && (
            <div className="flex items-center gap-2">
              <Badge tone="danger">已拒绝</Badge>
              <span className="text-12 text-muted-foreground">
                引导师未通过你的申请，如有疑问请当面联系引导师。
              </span>
            </div>
          )}
        </div>

        {/* dev 预览：让人类看到三态的流转（生产环境不会有这排按钮） */}
        {process.env.NODE_ENV !== "production" && applyStatus === "waiting" && (
          <div className="flex items-center gap-2" data-testid="join-apply-sim">
            <span className="text-10 uppercase tracking-wide text-muted-foreground">预览流转</span>
            <Button size="xs" variant="ghost" onClick={() => setApplyStatus("approved")} data-testid="join-apply-approve">
              模拟批准
            </Button>
            <Button size="xs" variant="ghost" onClick={() => setApplyStatus("rejected")} data-testid="join-apply-reject">
              模拟拒绝
            </Button>
          </div>
        )}
      </div>
    );
  }

  if (scene === "reconnect") {
    return (
      <div className="flex flex-col gap-4" data-testid="join-reconnect">
        {!recovered ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-muted py-8 text-center">
            <RefreshCw aria-hidden className="h-6 w-6 animate-spin text-muted-foreground" />
            <div className="flex flex-col gap-1">
              <p className="text-13 font-medium">正在把你接回同一组、同一环节…</p>
              <p className="text-12 text-muted-foreground">
                换了设备也能恢复——依据是「已验证手机号 + 名单条目」，不靠这台设备的浏览器记录。
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setRecovered(true)} data-testid="join-reconnect-verify">
              重新验证手机号以接管
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-2">
              <UserCheck aria-hidden className="h-4 w-4 text-success" />
              <span className="text-14 font-semibold">已回到环节 3</span>
              <Badge tone="neutral">旧设备会话已失效</Badge>
            </div>
            <p className="text-12 text-muted-foreground">
              本组已产出的内容一条没丢。旧设备上的会话已被接管失效，避免两台设备同时冒充你。
            </p>
            <Button variant="primary" size="lg" data-testid="join-continue" className="self-start">
              继续本组讨论
            </Button>
          </div>
        )}
      </div>
    );
  }

  // scene === "default"（正常进场）
  return (
    <div className="flex flex-col gap-5">
      <VerifyForm ctx={JOIN_CONTEXT} codeSent={codeSent} onGetCode={() => setCodeSent(true)} />

      {/* 已是成员：直接免登（D-01） */}
      <div
        data-testid="join-member-sso"
        className="flex items-center justify-between gap-3 rounded-md border border-border-subtle bg-panel p-3"
      >
        <div className="flex items-center gap-2">
          <UserCheck aria-hidden className="h-4 w-4 text-muted-foreground" />
          <span className="text-12 text-muted-foreground">已经是远洋的成员？不用再验手机号。</span>
        </div>
        <Button variant="outline" size="sm" data-testid="join-member-continue">
          用我的账号直接进
        </Button>
      </div>

      {/* 组长链接多一份主持权限 */}
      {role === "groupLead" && (
        <div
          data-testid="join-lead-note"
          className="flex items-start gap-2.5 rounded-md border border-ai/20 bg-ai-tint p-3"
        >
          <ShieldAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-ai-tint-foreground" />
          <p className="text-12 text-ai-tint-foreground">
            你拿到的是<strong className="font-semibold">组长链接</strong>，进场后多一份主持权限：
            向引导师举手、提交本组产出。
          </p>
        </div>
      )}

      {/* 麦克风权限说明（可随时关掉，不阻断进场） */}
      <div
        data-testid="join-mic-note"
        className="flex items-start gap-2.5 rounded-md border border-border-subtle bg-panel p-3"
      >
        <Mic aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <p className="text-11 text-muted-foreground">
          进入后会申请麦克风权限，用于本组讨论的实时转录。
          <strong className="text-background-foreground">可以随时关掉</strong>，关掉也不影响你贴便签、发言和投票。
        </p>
      </div>
    </div>
  );
}

/** 手机号 + 验证码验证块，正常态与七态成功/校验共用 */
function VerifyForm({
  ctx,
  codeSent,
  onGetCode,
}: {
  ctx: typeof JOIN_CONTEXT;
  codeSent: boolean;
  onGetCode: () => void;
}) {
  return (
    <div className="flex flex-col gap-4" data-testid="join-verify-form">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="join-phone">确认一下是你</Label>
        <Input id="join-phone" type="tel" inputMode="numeric" placeholder="输入你的手机号" data-testid="join-phone" />
        <p className="text-11 text-muted-foreground">
          仅用来核对名单里有没有你，提交后一律以掩码回显（如 {ctx.maskedPhone}），别人看不到完整号码。
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="join-code">验证码</Label>
        <div className="flex items-center gap-2">
          <Input id="join-code" inputMode="numeric" placeholder="6 位验证码" data-testid="join-code" />
          <Button variant="outline" size="lg" onClick={onGetCode} data-testid="join-get-code" className="shrink-0">
            {codeSent ? "已发送 · 重发" : "获取"}
          </Button>
        </div>
        {codeSent && (
          <p className="text-11 text-success" data-testid="join-code-sent">
            验证码已发到 {ctx.maskedPhone}，60 秒后可重发。
          </p>
        )}
      </div>
      <Button variant="primary" size="lg" data-testid="join-enter">
        进入我的小组
      </Button>
    </div>
  );
}
