"use client";
import * as React from "react";
import { Copy } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SectionTitle } from "./parts";
import { ApiError } from "@/lib/api-client";
import {
  issueProjectInviteLink, revokeProjectInviteLinks, buildProjectInviteLink,
  PARTICIPANT_IDENTITY_LABEL, INVITE_LINK_VALIDITY_LABEL,
  type ParticipantIdentityChoice, type InviteLinkValidity, type IssueInviteLinkOut,
} from "@/lib/live-project-invite";

/**
 * 「邀请成员」面板（项目中枢 R2）——引导师在设置 tab 里签发主链接、复制、重置全部。
 *
 * ⚠ 服务端判定：只有本项目引导师能签发 / 撤销（`assertCanManageInviteLinks`），
 *   其他角色点了得到 403 `PROJECT_ROLE_INSUFFICIENT` / `NO_PROJECT_ROLE`，这里如实显示。
 * ⚠ 签发幂等：同（身份 × 有效期）再点一次拿到同一条链接，不会稀释「撤销一条」。
 * ⚠ 链接只以令牌拼成（`buildProjectInviteLink`），不读服务端的原型路径 `url`。
 */
export function ProjectInvitePanel({ projectId }: { projectId: string }) {
  const [identity, setIdentity] = React.useState<ParticipantIdentityChoice>("member");
  const [validity, setValidity] = React.useState<InviteLinkValidity>("7d");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [issued, setIssued] = React.useState<IssueInviteLinkOut | null>(null);
  const [copyState, setCopyState] = React.useState<"idle" | "copied" | "failed">("idle");
  const [revoked, setRevoked] = React.useState<number | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const link = issued && typeof window !== "undefined" ? buildProjectInviteLink(issued.token, window.location.origin) : null;

  async function issue() {
    setBusy(true); setError(null); setRevoked(null); setCopyState("idle");
    try {
      const out = await issueProjectInviteLink({ projectId, kind: "main", groupId: null, identity, validity });
      setIssued(out);
    } catch (e) {
      setError(describeFailure(e));
    } finally {
      setBusy(false);
    }
  }

  async function revokeAll() {
    setBusy(true); setError(null);
    try {
      const out = await revokeProjectInviteLinks(projectId, null);
      setRevoked(out.revokedLinkIds.length);
      setIssued(null);
    } catch (e) {
      setError(describeFailure(e));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
      inputRef.current?.select();
    }
  }

  return (
    <section data-testid="project-invite-panel">
      <SectionTitle meta="项目是受邀才能进的容器：把链接发给要加入的组织成员">邀请成员</SectionTitle>
      <Card>
        <div className="flex flex-col gap-3 p-3.5">
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-10 text-muted-foreground">
              <span>加入后的身份</span>
              <Select
                data-testid="project-invite-identity"
                value={identity}
                onValueChange={(v) => setIdentity(v as ParticipantIdentityChoice)}
                options={(Object.keys(PARTICIPANT_IDENTITY_LABEL) as ParticipantIdentityChoice[]).map((k) => ({ value: k, label: PARTICIPANT_IDENTITY_LABEL[k] }))}
              />
            </label>
            <label className="flex flex-col gap-1 text-10 text-muted-foreground">
              <span>有效期</span>
              <Select
                data-testid="project-invite-validity"
                value={validity}
                onValueChange={(v) => setValidity(v as InviteLinkValidity)}
                options={(Object.keys(INVITE_LINK_VALIDITY_LABEL) as InviteLinkValidity[]).map((k) => ({ value: k, label: INVITE_LINK_VALIDITY_LABEL[k] }))}
              />
            </label>
            <Button size="sm" variant="primary" disabled={busy} onClick={() => void issue()} data-testid="project-invite-issue">
              生成邀请链接
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void revokeAll()} data-testid="project-invite-revoke-all">
              重置全部链接
            </Button>
          </div>

          {link && issued && (
            <div className="flex flex-col gap-1.5 rounded-lg border border-primary/40 bg-primary/5 p-3" data-testid="project-invite-link-block">
              <p className="text-11">
                「{PARTICIPANT_IDENTITY_LABEL[identity]}」链接 · {INVITE_LINK_VALIDITY_LABEL[validity]}
                {issued.inviteCode ? ` · 邀请码 ${issued.inviteCode}` : ""}
              </p>
              <div className="flex items-center gap-1.5">
                <Input
                  ref={inputRef}
                  readOnly
                  value={link}
                  onFocus={(e) => e.currentTarget.select()}
                  className="h-8 flex-1 font-mono text-11"
                  aria-label="项目邀请链接"
                  data-testid="project-invite-link-url"
                />
                <Button type="button" size="xs" variant="primary" onClick={() => void copy()} data-testid="project-invite-link-copy">
                  <Copy aria-hidden className="h-3 w-3" />
                  {copyState === "copied" ? "已复制" : copyState === "failed" ? "请手动复制" : "复制"}
                </Button>
              </div>
              <p className="text-10 text-muted-foreground">收到链接的人需先登录本组织账号，打开后即以上述身份加入本项目。</p>
            </div>
          )}

          {revoked !== null && (
            <p className="text-11 text-muted-foreground" data-testid="project-invite-revoked">
              已重置 {revoked} 条链接；已在场的人不受影响，新访问立即失效。
            </p>
          )}
          {error && (
            <p className="text-11 text-destructive" data-testid="project-invite-error">{error}</p>
          )}
        </div>
      </Card>
    </section>
  );
}

function describeFailure(e: unknown): string {
  if (e instanceof ApiError) {
    switch (e.reasonCode) {
      case "NO_PROJECT_ROLE": return "你不在这个项目里，不能签发邀请。";
      case "PROJECT_ROLE_INSUFFICIENT": return "只有本项目的引导师能签发或撤销邀请链接。";
      case "AUTH_SERVICE_UNAVAILABLE": return "身份校验服务暂时不可用，请稍后重试。";
    }
    if (e.status === 401) return "登录已失效，请重新登录。";
    return `${e.reasonCode ?? "操作失败"}（HTTP ${e.status}）`;
  }
  return e instanceof Error ? e.message : "操作失败，请稍后重试。";
}
