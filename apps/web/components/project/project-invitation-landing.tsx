"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { auth as authContract } from "@repo/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useOptionalSession } from "@/components/session/session-provider";
import { ApiError, getStoredSessionToken } from "@/lib/api-client";
import { contractFieldIssues } from "@/lib/auth";
import { switchCurrentOrganization } from "@/lib/session-api";
import {
  previewInvitation, acceptInvitation, activateInvitation, describeInvitationFailure,
  projectInvitationReasonText, PROJECT_INVITATION_TOKEN_PARAM,
  type PreviewInvitationOut,
} from "@/lib/live-project-invitations";

const JOIN_PATH = "/projects/join";

type Phase =
  | { kind: "loading" }
  | { kind: "invalid" }
  | { kind: "unavailable"; message: string }
  | { kind: "ready"; preview: PreviewInvitationOut }
  | { kind: "verify"; email: string }
  | { kind: "entering" };

/**
 * 通用项目邀请落地页（#4788）：`/projects/join?invite=<token>`（工作坊的 `?t=` 由
 * `project-join-screen.tsx` 承接，互不相干）。先 `preview`（匿名可调、带会话时按会话给下一步），再按
 * `nextStep` 分支：直接加入 / 已在项目里 / 邮箱不符 / 去登录 / 注册（建号 + 入组织 + 入项目）。
 * 「邀请无效」只有一种说法，不区分原因。
 */
export function ProjectInvitationLanding({ token }: { token: string | null }) {
  const router = useRouter();
  const session = useOptionalSession();
  const status = session?.status ?? "loading";
  const [phase, setPhase] = React.useState<Phase>({ kind: "loading" });
  const startedRef = React.useRef(false);

  const selfUrl = `${JOIN_PATH}?${PROJECT_INVITATION_TOKEN_PARAM}=${encodeURIComponent(token ?? "")}`;
  const loginUrl = `/login?next=${encodeURIComponent(selfUrl)}`;

  React.useEffect(() => {
    if (status === "loading" || startedRef.current) return;
    startedRef.current = true;
    if (!token) { setPhase({ kind: "invalid" }); return; }
    previewInvitation(token)
      .then((preview) => setPhase(preview.valid && preview.nextStep !== null ? { kind: "ready", preview } : { kind: "invalid" }))
      .catch((e: unknown) => setPhase({ kind: "unavailable", message: describeInvitationFailure(e) }));
  }, [status, token]);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-3 p-6" data-testid="project-join-invitation">
      <span className="text-11 font-medium uppercase tracking-widest text-muted-foreground">WorkspaceX</span>
      <h1 className="text-16 font-semibold">加入项目</h1>
      {phase.kind === "loading" && (
        <p className="text-12 text-muted-foreground" data-testid="project-join-loading">正在确认邀请…</p>
      )}
      {phase.kind === "invalid" && (
        <>
          <p className="text-12 leading-relaxed text-destructive" data-testid="project-join-invalid">
            {projectInvitationReasonText("INVITATION_INVALID")}
          </p>
          <div>
            <Button asChild size="sm" variant="outline" data-testid="project-join-home">
              <a href="/projects">回到首页</a>
            </Button>
          </div>
        </>
      )}
      {phase.kind === "unavailable" && (
        <>
          <p role="alert" className="text-12 text-destructive" data-testid="project-join-unavailable">{phase.message}</p>
          <div>
            <Button size="sm" variant="outline" onClick={() => window.location.reload()} data-testid="project-join-reload">重试</Button>
          </div>
        </>
      )}
      {phase.kind === "entering" && (
        <p className="text-12 text-muted-foreground" data-testid="project-join-entering">已加入，正在进入项目…</p>
      )}
      {phase.kind === "verify" && (
        <div className="flex flex-col gap-2" data-testid="project-join-verify">
          <p className="text-12 leading-relaxed">
            账号已创建，你也已经加入这个项目。我们给 <strong className="break-all">{phase.email}</strong> 发了一封验证邮件，
            请先点开邮件里的链接完成验证，然后再登录。
          </p>
          <div>
            <Button asChild size="sm" variant="primary" data-testid="project-join-verify-login">
              <a href="/login">去登录</a>
            </Button>
          </div>
        </div>
      )}
      {phase.kind === "ready" && token !== null && (
        <ReadyBody
          token={token}
          preview={phase.preview}
          loginUrl={loginUrl}
          onEntering={() => setPhase({ kind: "entering" })}
          onVerify={(email) => setPhase({ kind: "verify", email })}
          onInvalid={() => setPhase({ kind: "invalid" })}
          goProject={(projectId) => router.replace(`/projects/${encodeURIComponent(projectId)}`)}
          goLogin={() => router.replace(loginUrl)}
        />
      )}
    </div>
  );
}

function Headline({ preview }: { preview: PreviewInvitationOut }) {
  return (
    <p className="text-12 leading-relaxed" data-testid="project-join-headline">
      <strong>{preview.inviterName ?? "有人"}</strong> 邀请你加入项目 <strong>「{preview.projectName ?? "未命名项目"}」</strong>。
    </p>
  );
}

function ReadyBody({ token, preview, loginUrl, onEntering, onVerify, onInvalid, goProject, goLogin }: {
  token: string;
  preview: PreviewInvitationOut;
  loginUrl: string;
  onEntering: () => void;
  onVerify: (email: string) => void;
  onInvalid: () => void;
  goProject: (projectId: string) => void;
  goLogin: () => void;
}) {
  const session = useOptionalSession();
  const step = preview.nextStep;

  if (step === "accept") {
    return (
      <AcceptBlock token={token} preview={preview} onEntering={onEntering} onInvalid={onInvalid} goProject={goProject} />
    );
  }
  if (step === "already_member") {
    return (
      <div className="flex flex-col gap-3" data-testid="project-join-already">
        <Headline preview={preview} />
        <p className="text-12 text-muted-foreground">你已经在这个项目里了。</p>
        <AlreadyLink token={token} />
      </div>
    );
  }
  if (step === "email_mismatch") {
    return (
      <div className="flex flex-col gap-3" data-testid="project-join-mismatch">
        <Headline preview={preview} />
        <p className="text-12 leading-relaxed text-destructive">
          这条邀请发给了 <strong className="break-all" data-testid="project-join-mismatch-email">{preview.invitedEmail ?? "另一个邮箱"}</strong>，
          和你当前登录的账号不是同一个。请退出后，用收到邀请的邮箱账号登录。
        </p>
        <div>
          <Button size="sm" variant="primary" data-testid="project-join-switch-account"
            onClick={() => { void (session ? session.logout() : Promise.resolve()).finally(goLogin); }}>
            退出并切换账号
          </Button>
        </div>
      </div>
    );
  }
  // login / register / login_or_register：未登录的三种
  return (
    <AnonymousBlock token={token} preview={preview} loginUrl={loginUrl}
      onEntering={onEntering} onVerify={onVerify} onInvalid={onInvalid} goProject={goProject} goLogin={goLogin} />
  );
}

async function ensureProjectOrganization(session: ReturnType<typeof useOptionalSession>, orgId: string) {
      if (session?.session && orgId !== session.session.currentOrgId) {
        const s = session.session;
        if (s.orgIds.includes(orgId)) {
          await session.switchOrganization(orgId);
        } else {
          // 刚被加进这个组织：本地会话的组织清单里还没有它。服务端切换后，用同一个 bearer 重建本地会话。
          await switchCurrentOrganization(orgId, s.sessionToken);
          await session.startSession(
            { sessionToken: s.sessionToken, userId: s.userId, orgs: [orgId, ...s.orgIds], expiresAt: s.expiresAt },
            { expectedToken: s.sessionToken },
          );
        }
      }
}

function AlreadyLink({ token }: { token: string }) {
  // already_member 时 preview 不带项目 id；接受是幂等的，借它拿到项目 id 再进去。
  const router = useRouter();
  const session = useOptionalSession();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function go() {
    setBusy(true); setError(null);
    try {
      const out = await acceptInvitation(token);
      await ensureProjectOrganization(session, out.orgId);
      router.replace(`/projects/${encodeURIComponent(out.projectId)}`);
    } catch (e) {
      setError(describeInvitationFailure(e));
      setBusy(false);
    }
  }
  return (
    <>
      <div>
        <Button size="sm" variant="primary" disabled={busy} onClick={() => void go()} data-testid="project-join-open">进入项目</Button>
      </div>
      {error !== null && <p role="alert" className="text-11 text-destructive" data-testid="project-join-error">{error}</p>}
    </>
  );
}

function AcceptBlock({ token, preview, onEntering, onInvalid, goProject }: {
  token: string; preview: PreviewInvitationOut; onEntering: () => void; onInvalid: () => void; goProject: (id: string) => void;
}) {
  const session = useOptionalSession();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function accept() {
    setBusy(true); setError(null);
    try {
      const out = await acceptInvitation(token);
      await ensureProjectOrganization(session, out.orgId);
      onEntering();
      goProject(out.projectId);
    } catch (e) {
      if (e instanceof ApiError && e.reasonCode === "INVITATION_INVALID") { onInvalid(); return; }
      setError(describeInvitationFailure(e));
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3" data-testid="project-join-accept">
      <Headline preview={preview} />
      <div>
        <Button size="sm" variant="primary" disabled={busy} onClick={() => void accept()} data-testid="project-join-accept-button">
          {busy ? "加入中…" : "加入项目"}
        </Button>
      </div>
      {error !== null && <p role="alert" className="text-11 text-destructive" data-testid="project-join-error">{error}</p>}
    </div>
  );
}

function AnonymousBlock({ token, preview, loginUrl, onEntering, onVerify, onInvalid, goProject, goLogin }: {
  token: string; preview: PreviewInvitationOut; loginUrl: string;
  onEntering: () => void; onVerify: (email: string) => void; onInvalid: () => void;
  goProject: (id: string) => void; goLogin: () => void;
}) {
  const step = preview.nextStep;
  const canRegister = step === "register" || step === "login_or_register";
  const [formOpen, setFormOpen] = React.useState(step === "register");
  return (
    <div className="flex flex-col gap-3" data-testid="project-join-anonymous">
      <Headline preview={preview} />
      {step === "login" && (
        <p className="text-12 text-muted-foreground" data-testid="project-join-login-hint">
          这个邮箱已经有账号了，登录后就能加入。
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild size="sm" variant={formOpen ? "outline" : "primary"} data-testid="project-join-login">
          <a href={loginUrl}>登录</a>
        </Button>
        {canRegister && !formOpen && (
          <Button size="sm" variant="outline" onClick={() => setFormOpen(true)} data-testid="project-join-register-open">
            没有账号？注册
          </Button>
        )}
      </div>
      {canRegister && formOpen && (
        <RegisterForm token={token} preview={preview} loginUrl={loginUrl}
          onEntering={onEntering} onVerify={onVerify} onInvalid={onInvalid} goProject={goProject} goLogin={goLogin} />
      )}
    </div>
  );
}

function RegisterForm({ token, preview, onEntering, onVerify, onInvalid, goProject, goLogin }: {
  token: string; preview: PreviewInvitationOut; loginUrl: string;
  onEntering: () => void; onVerify: (email: string) => void; onInvalid: () => void;
  goProject: (id: string) => void; goLogin: () => void;
}) {
  const session = useOptionalSession();
  const emailKind = preview.kind === "email";
  const [email, setEmail] = React.useState(preview.invitedEmail ?? "");
  const [name, setName] = React.useState("");
  const [pwd, setPwd] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [pwdError, setPwdError] = React.useState<string | null>(null);
  const [error, setError] = React.useState<{ message: string; needLogin: boolean } | null>(null);

  const canSubmit = !busy && name.trim().length > 0 && pwd.length > 0 && (emailKind || email.trim().length > 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true); setError(null); setPwdError(null);
    const initialToken = getStoredSessionToken();
    try {
      const out = await activateInvitation({
        token, name: name.trim(), password: pwd, ...(emailKind ? {} : { email: email.trim() }),
      });
      if (out.verificationRequired || out.session === null) {
        onVerify(emailKind ? (preview.invitedEmail ?? email.trim()) : email.trim());
        return;
      }
      if (session === null || getStoredSessionToken() !== initialToken) {
        // 没有会话容器，或在提交期间本机登录态变了：不覆盖别人的登录，引导去登录。
        setError({ message: "账号已创建。请用刚设置的邮箱和密码登录。", needLogin: true });
        setBusy(false);
        return;
      }
      await session.startSession(out.session, { expectedToken: initialToken });
      onEntering();
      goProject(out.projectId);
    } catch (err) {
      setBusy(false);
      const issues = contractFieldIssues(err);
      if (issues?.some((i) => i.path === "profile.password" || i.path === "password")) {
        setPwdError(`密码不符合要求：至少 ${authContract.AUTH_POLICY.passwordMinLen} 位，且不能是常见泄露口令。`);
        return;
      }
      if (err instanceof ApiError) {
        if (err.reasonCode === "INVITATION_INVALID") { onInvalid(); return; }
        if (err.reasonCode === "LOGIN_REQUIRED") {
          setError({ message: projectInvitationReasonText("LOGIN_REQUIRED"), needLogin: true });
          return;
        }
      }
      if (err instanceof Error && !(err instanceof ApiError)) {
        // startSession 失败：账号已建好，只是本机没能自动登录。
        setError({ message: "账号已创建，但自动登录没有完成。请用刚设置的邮箱和密码登录。", needLogin: true });
        return;
      }
      setError({ message: describeInvitationFailure(err), needLogin: false });
    }
  }

  return (
    <form className="flex flex-col gap-3 rounded-control border border-border p-3" onSubmit={(e) => void submit(e)} noValidate data-testid="project-join-register-form">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="project-join-email">邮箱</Label>
        <Input id="project-join-email" type="email" value={email} readOnly={emailKind} disabled={busy}
          onChange={(e) => setEmail(e.currentTarget.value)} placeholder="name@example.com" data-testid="project-join-email" />
        {!emailKind && (
          <p className="text-10 text-muted-foreground">我们会给这个邮箱发验证邮件，验证后才能登录。</p>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="project-join-name">姓名</Label>
        <Input id="project-join-name" value={name} disabled={busy} onChange={(e) => setName(e.currentTarget.value)}
          placeholder="你的名字" data-testid="project-join-name" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="project-join-pwd">设置密码</Label>
        <Input id="project-join-pwd" type="password" value={pwd} disabled={busy} aria-invalid={pwdError !== null}
          onChange={(e) => { setPwd(e.currentTarget.value); setPwdError(null); }}
          placeholder={`至少 ${authContract.AUTH_POLICY.passwordMinLen} 位`} data-testid="project-join-pwd" />
        {pwdError !== null && <p role="alert" className="text-10 text-destructive" data-testid="project-join-pwd-error">{pwdError}</p>}
      </div>
      {error !== null && (
        <div role="alert" className="flex flex-col gap-2" data-testid="project-join-register-error">
          <p className="text-12 text-destructive">{error.message}</p>
          {error.needLogin && (
            <div>
              <Button type="button" size="sm" variant="outline" onClick={goLogin} data-testid="project-join-goto-login">去登录</Button>
            </div>
          )}
        </div>
      )}
      <Button type="submit" size="md" variant="primary" disabled={!canSubmit} data-testid="project-join-register-submit">
        {busy ? "创建中…" : "创建账号并加入项目"}
      </Button>
    </form>
  );
}
