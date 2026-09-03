"use client";
import * as React from "react";
import { DoorOpen, ShieldCheck, LogIn } from "lucide-react";
import { StateShell } from "@/components/state/state-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import type { UiState } from "@/lib/ui-state";
import { ORG_ROLE_LABEL, ACTIVATION_CONTEXT, AUTH_POLICY } from "@/lib/mock/org-admin";

/**
 * UC-1.6 R3-6a · 激活落地页（免登上下文，**不复用后台**，R8）
 *
 * [原型确认缺失] 底部演示场景条 11 项无任何注册/激活场景，故此屏为原创设计，需 sign-off。
 * 两分支：6a 新用户设姓名 + 密码（≥ AUTH_POLICY.passwordMinLen 位，查弱口令库）；
 *        6b 已有账号只需登录确认加入本组织，不新建账号。
 * 链接携带的组织 / 角色**以服务端为准，篡改无效**（AC5）；激活页不回显任何其它成员信息。
 * 链接失效统一提示（不区分无效/过期/已用/已撤销，防枚举，E1）。
 */
export function ActivateScreen({ state }: { state: UiState }) {
  const [mode, setMode] = React.useState<"new" | "existing">("new");
  const [pwd, setPwd] = React.useState("");
  const [done, setDone] = React.useState(false);

  const ctx = ACTIVATION_CONTEXT;
  const pwdTooShort = pwd.length > 0 && pwd.length < AUTH_POLICY.passwordMinLen;

  // 无权限态 = 链接已失效的统一提示（防枚举）
  if (state === "denied") {
    return (
      <div className="w-full max-w-md" data-testid="activate-invalid">
        <StateShell
          state="denied"
          denial={{ layer: "organization", reason: "该邀请已失效，请联系管理员重发。（无效 / 过期 / 已用 / 已撤销返回同一提示，且不泄露组织与成员信息）" }}
        >
          <span />
        </StateShell>
      </div>
    );
  }

  // 其余异常态走 StateShell
  if (state === "loading" || state === "empty" || state === "dep-failed") {
    return (
      <div className="w-full max-w-md" data-testid="activate-state">
        <StateShell
          state={state}
          skeletonRows={4}
          emptyHint="这条激活链接没有携带有效的邀请上下文。"
          depFailure={{ what: "账号服务暂不可用，无法完成激活；你的输入已保留，稍后可重试。" }}
        >
          <span />
        </StateShell>
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-md flex-col gap-4 rounded-lg border border-border bg-card p-6 shadow-sm" data-testid="activate-card">
      <div className="flex items-center gap-2">
        <DoorOpen aria-hidden className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-18 font-semibold tracking-tight">加入 {ctx.orgName}</h1>
      </div>

      {/* 入场即带好的组织角色（以服务端为准） */}
      <div className="flex flex-col gap-2 rounded-md border border-border bg-panel p-3" data-testid="activate-context">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-11 text-muted-foreground">你被邀请为</span>
          <Badge tone="primary">{ORG_ROLE_LABEL[ctx.role]}</Badge>
        </div>
        <p className="text-11 text-muted-foreground">邮箱 {ctx.maskedEmail} · 激活链接 {ctx.linkValidDays} 天有效、一次性</p>
        <div className="flex items-start gap-1.5 rounded-sm bg-muted px-2 py-1.5">
          <ShieldCheck aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
          <p className="text-10 text-muted-foreground" data-testid="activate-tamper-note">
            组织、角色<strong>以服务端记录为准</strong>：改写链接参数不改变实际授予的身份（AC5），篡改尝试写安全审计。
          </p>
        </div>
      </div>

      {/* 分支切换：新用户 / 已有账号 */}
      <div className="flex gap-1.5" data-testid="activate-mode">
        <Button size="sm" variant={mode === "new" ? "primary" : "outline"} onClick={() => setMode("new")} data-testid="activate-mode-new">我是新用户</Button>
        <Button size="sm" variant={mode === "existing" ? "primary" : "outline"} onClick={() => setMode("existing")} data-testid="activate-mode-existing">我已有账号</Button>
      </div>

      <StateShell
        state={state === "invalid" ? "invalid" : "default"}
        errors={{ "activate-pwd": `口令至少 ${AUTH_POLICY.passwordMinLen} 位，且不能是常见泄露口令。` }}
      >
        {mode === "new" ? (
          <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); setDone(true); }} data-testid="activate-form-new">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="activate-name">姓名</Label>
              <Input id="activate-name" placeholder="你的名字" data-testid="activate-name" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="activate-pwd">设置密码</Label>
              <Input
                id="activate-pwd"
                type="password"
                value={pwd}
                onChange={(e) => setPwd(e.currentTarget.value)}
                placeholder={`至少 ${AUTH_POLICY.passwordMinLen} 位`}
                aria-describedby={pwdTooShort ? "activate-pwd-hint" : undefined}
                data-testid="activate-pwd"
              />
              <p id="activate-pwd-hint" className={pwdTooShort ? "text-10 text-destructive" : "text-10 text-muted-foreground"} data-testid="activate-pwd-hint">
                {pwdTooShort ? `还差 ${AUTH_POLICY.passwordMinLen - pwd.length} 位` : `≥ ${AUTH_POLICY.passwordMinLen} 位、不强制字符类、查弱口令库、不强制定期更换（O-28）`}
              </p>
            </div>
            <p className="text-10 text-muted-foreground">点击链接本身已证明邮箱所有权，不再二次发信（O-28 ⑤）。</p>
            <Button type="submit" variant="primary" disabled={pwd.length < AUTH_POLICY.passwordMinLen} data-testid="activate-submit-new">
              激活并进入
            </Button>
          </form>
        ) : (
          <div className="flex flex-col gap-3" data-testid="activate-form-existing">
            <p className="text-12 text-muted-foreground">
              该邮箱在别的组织已有账号。<strong>不新建账号</strong>——登录确认后把现有账号加入本组织；
              切换器里会出现两条，切换时清空全部项目级上下文，权限按当前组织重新求值（O-12）。
            </p>
            <Button variant="primary" onClick={() => setDone(true)} data-testid="activate-submit-existing">
              <LogIn aria-hidden className="h-3.5 w-3.5" /> 登录并加入 {ctx.orgName}
            </Button>
          </div>
        )}
      </StateShell>

      {(done || state === "success") && (
        <p data-testid="saved" className="inline-flex items-center gap-1 text-12 text-success" role="status">
          已激活：核销链接、创建成员、写入「{ORG_ROLE_LABEL[ctx.role]}」、初始化配额，均在同一事务内完成。
        </p>
      )}
    </div>
  );
}
