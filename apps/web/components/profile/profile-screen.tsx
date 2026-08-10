"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle, BrainCircuit, CheckCircle2, ChevronRight, Clock, ImagePlus, KeyRound, LogOut, User,
} from "lucide-react";
import { AppShell } from "@/components/shell/app-shell";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { useSession } from "@/components/session/session-provider";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StateShell, type UiState } from "@/components/state/state-shell";
import { ApiError } from "@/lib/api-client";
import {
  changeOwnPassword, fetchAvatarObjectUrl, listOwnActivity, updateOwnProfile, uploadOwnAvatar,
  type ListOwnActivityOut,
} from "@/lib/live-identity";

const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const AVATAR_ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp"];

/**
 * `/profile` —— 个人资料页（#638 delta；迭代 1 只有改名，迭代 2 补头像上传、
 * 改密码、活动记录三块）。
 */
export function ProfileScreen() {
  const { session, identity, updateDisplayName, updateAvatarUrl, logout } = useSession();

  // 迭代 4 顺带修复（复核额外发现）：改名/换头像/改密码成功后，活动记录不会自己刷新——
  // 用户看到的还是旧列表，要手动 reload 才看得到新条目。这几个动作都发生在本页、
  // 都已经有各自的"成功"回调，加一个递增的 key 往下传给 `ActivitySection`，
  // 让它的 `useEffect` 把这次成功也当一次"该重新拉一次列表"的信号，不需要引入
  // 跨组件的状态管理。
  const [activityRefreshKey, setActivityRefreshKey] = React.useState(0);
  const bumpActivityRefresh = React.useCallback(() => setActivityRefreshKey((k) => k + 1), []);

  return (
    <AppShell previewRole={null}>
      <div className="mx-auto flex max-w-lg flex-col gap-6 p-6" data-testid="profile-screen">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <User aria-hidden className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-16 font-semibold tracking-tight">个人资料</h1>
          </div>

          {/*
            移动端专用（375px，2026-08-09 信息架构调整）—— 主题切换与退出现在只挂在桌面档
            左下角个人菜单（`personal-menu.tsx`，`<md` 时 IconRail 整体隐藏，那份下拉不可达）。
            这两个动作因此在移动端会彻底没有入口，除非在这里单独补一条：只在 `<md` 显示
            （`md:hidden`），避免和桌面档的下拉在同一视口里出现「同一功能两个入口」。
            移动端「我」tab 直达本页（路由跳转，不适合弹出个人菜单那种覆盖层交互），
            所以选择把这两个动作前置到页面顶部，而不是也给底部 tab 加一层弹层。
          */}
          <div className="flex shrink-0 items-center gap-1 md:hidden" data-testid="profile-mobile-actions">
            <ThemeToggle testId="profile-mobile-theme-toggle" role={undefined} className="w-auto" />
            <Button
              size="xs"
              variant="ghost"
              data-testid="profile-mobile-logout"
              onClick={logout}
            >
              <LogOut aria-hidden className="h-3 w-3" />
              退出
            </Button>
          </div>
        </div>

        {/*
          Brain 入口（移动端导航收敛，#736 复核修复）—— 375px 下 IconRail 整体隐藏
          （`hidden md:flex`），移动端「我」tab 现在指向 `/profile`（不再直达 `/brain`），
          所以 `/brain` 需要一条从「我」这条线可达的路径；这张卡就是那条路径。
          跟随本页现有卡片视觉（`border-border` + `bg-panel`），不另起风格。
        */}
        <Link
          href="/brain"
          data-testid="profile-brain-entry"
          className="flex items-center gap-3 rounded-lg border border-border bg-panel p-3 transition-all duration-200 hover:bg-muted"
        >
          <BrainCircuit aria-hidden className="h-5 w-5 text-muted-foreground" />
          <div className="flex flex-1 flex-col">
            <span className="text-13 font-medium">我的 Brain</span>
            <span className="text-10 text-muted-foreground">组织记忆 / Context Pack</span>
          </div>
          <ChevronRight aria-hidden className="h-4 w-4 text-muted-foreground" />
        </Link>

        {identity && session ? (
          <>
            <ProfileForm
              initialDisplayName={identity.displayName}
              avatarUrl={identity.avatarUrl}
              onSavedName={(displayName) => {
                updateDisplayName(displayName);
                bumpActivityRefresh();
              }}
              onSavedAvatar={(avatarUrl) => {
                updateAvatarUrl(avatarUrl);
                bumpActivityRefresh();
              }}
            />
            <PasswordSection onChanged={bumpActivityRefresh} />
            <ActivitySection refreshKey={activityRefreshKey} />
          </>
        ) : (
          <div data-testid="loading" className="flex animate-pulse flex-col gap-3">
            <div className="h-14 rounded-lg bg-muted" />
            <div className="h-9 rounded-lg bg-muted" />
            <span className="sr-only">加载中</span>
          </div>
        )}
      </div>
    </AppShell>
  );
}

/* ═══════════════════════════ 头像 + 显示名 ═══════════════════════════ */

function ProfileForm({
  initialDisplayName, avatarUrl, onSavedName, onSavedAvatar,
}: {
  initialDisplayName: string;
  avatarUrl: string | null;
  onSavedName: (displayName: string) => void;
  onSavedAvatar: (avatarUrl: string | null) => void;
}) {
  const [displayName, setDisplayName] = React.useState(initialDisplayName);
  const [savedName, setSavedName] = React.useState(initialDisplayName);
  const [state, setState] = React.useState<UiState>("default");
  const [failureMessage, setFailureMessage] = React.useState<string | null>(null);

  const trimmed = displayName.trim();
  const dirty = trimmed !== savedName;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (trimmed.length === 0) {
      setState("invalid");
      return;
    }
    setState("loading");
    setFailureMessage(null);
    try {
      const out = await updateOwnProfile({ displayName: trimmed });
      setSavedName(out.displayName);
      setDisplayName(out.displayName);
      setState("success");
      onSavedName(out.displayName);
    } catch (err) {
      setFailureMessage(describeFailure(err));
      setState("dep-failed");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <AvatarUpload avatarUrl={avatarUrl} displayName={savedName} onSaved={onSavedAvatar} />

      <form className="flex flex-col gap-4" onSubmit={handleSave} data-testid="profile-name-form">
        <StateShell
          state={state}
          skeletonRows={1}
          errors={{ "display-name": "姓名不能为空" }}
          depFailure={{ what: failureMessage ?? "个人资料服务暂时不可用", retry: () => setState("default") }}
          successMessage="已保存"
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="display-name">显示名</Label>
            <Input
              id="display-name"
              value={displayName}
              disabled={state === "loading"}
              onChange={(e) => {
                setDisplayName(e.currentTarget.value);
                if (state !== "default") setState("default");
              }}
              data-testid="profile-display-name-input"
              aria-invalid={state === "invalid"}
            />
          </div>
        </StateShell>

        <div>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={state === "loading" || !dirty}
            data-testid="profile-save"
          >
            {state === "loading" ? "保存中…" : "保存"}
          </Button>
        </div>
      </form>
    </div>
  );
}

type AvatarUiState = "idle" | "uploading" | "error";

function AvatarUpload({
  avatarUrl, displayName, onSaved,
}: { avatarUrl: string | null; displayName: string; onSaved: (avatarUrl: string | null) => void }) {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const [state, setState] = React.useState<AvatarUiState>("idle");
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  // 读回已保存的头像——`avatarUrl` 要求 Authorization 头，<img src> 做不到，
  // 所以用 fetch 换成 Blob URL（见 `live-identity.ts` 的 `fetchAvatarObjectUrl`）。
  React.useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    if (avatarUrl) {
      fetchAvatarObjectUrl(avatarUrl)
        .then((url) => {
          if (cancelled) return;
          objectUrl = url;
          setPreviewUrl(url);
        })
        .catch(() => {
          if (!cancelled) setErrorMessage("头像加载失败，稍后重试");
        });
    } else {
      setPreviewUrl(null);
    }
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [avatarUrl]);

  async function handleFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = ""; // 允许重复选同一个文件也能触发 onChange
    if (!file) return;

    setErrorMessage(null);

    // 前端预检——体验优化，服务端会重做全部校验（真正的把关在那边）。
    if (file.size > AVATAR_MAX_BYTES) {
      setState("error");
      setErrorMessage(`文件太大（${(file.size / 1024 / 1024).toFixed(1)}MB）——头像最大 5MB。`);
      return;
    }
    if (!AVATAR_ALLOWED_TYPES.includes(file.type)) {
      setState("error");
      setErrorMessage(`不支持的文件类型（${file.type || "未知"}）——只支持 PNG / JPEG / WebP。`);
      return;
    }

    setState("uploading");
    try {
      const uploaded = await uploadOwnAvatar(file);
      const patched = await updateOwnProfile({ avatarArtifactId: uploaded.avatarArtifactId });
      const objectUrl = await fetchAvatarObjectUrl(uploaded.avatarUrl);
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return objectUrl;
      });
      onSaved(patched.avatarUrl);
      setState("idle");
    } catch (err) {
      setState("error");
      setErrorMessage(describeAvatarFailure(err));
    }
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-panel p-3" data-testid="profile-avatar-block">
      <Avatar initials={displayName.slice(0, 1)} src={previewUrl} size="lg" />
      <div className="flex flex-1 flex-col gap-1">
        <input
          ref={fileInputRef}
          type="file"
          accept={AVATAR_ALLOWED_TYPES.join(",")}
          className="hidden"
          onChange={handleFileChosen}
          data-testid="profile-avatar-file-input"
        />
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={state === "uploading"}
          onClick={() => fileInputRef.current?.click()}
          data-testid="profile-avatar-upload"
        >
          <ImagePlus aria-hidden className="h-3 w-3" />
          {state === "uploading" ? "上传中…" : "更换头像"}
        </Button>
        <p className="text-10 text-muted-foreground">PNG / JPEG / WebP，最大 5MB。</p>
        {state === "error" && errorMessage ? (
          <p role="alert" data-testid="profile-avatar-error" className="flex items-center gap-1 text-10 text-destructive">
            <AlertTriangle aria-hidden className="h-3 w-3 shrink-0" />
            {errorMessage}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function describeAvatarFailure(failure: unknown): string {
  if (failure instanceof ApiError) {
    if (failure.reasonCode === "FILE_TOO_LARGE") return "文件太大——头像最大 5MB。";
    if (failure.reasonCode === "UNSUPPORTED_CONTENT_TYPE") return "文件类型不支持或与声明不符——只支持 PNG / JPEG / WebP。";
    if (failure.status === 401) return "登录已失效（HTTP 401），请重新登录。";
    return `${failure.reasonCode ?? "上传失败"}（HTTP ${failure.status}）`;
  }
  return failure instanceof Error ? failure.message : "上传失败，请稍后重试。";
}

/* ═══════════════════════════ 改密码 ═══════════════════════════ */

type PasswordUiState = "idle" | "submitting" | "invalid" | "error" | "success";

function PasswordSection({ onChanged }: { onChanged: () => void }) {
  const [currentPassword, setCurrentPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [state, setState] = React.useState<PasswordUiState>("idle");
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [revokedCount, setRevokedCount] = React.useState<number | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword.length < 12) {
      setState("invalid");
      setErrorMessage("新密码至少需要 12 个字符");
      return;
    }
    setState("submitting");
    setErrorMessage(null);
    setRevokedCount(null);
    try {
      const out = await changeOwnPassword({ currentPassword, newPassword });
      setState("success");
      setRevokedCount(out.revokedSessionCount);
      setCurrentPassword("");
      setNewPassword("");
      onChanged();
    } catch (err) {
      setState("error");
      setErrorMessage(describePasswordFailure(err));
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-panel p-4" data-testid="profile-password-section">
      <div className="flex items-center gap-2">
        <KeyRound aria-hidden className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-13 font-semibold">修改密码</h2>
      </div>

      <form className="flex flex-col gap-3" onSubmit={handleSubmit} data-testid="profile-password-form">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="current-password">当前密码</Label>
          <Input
            id="current-password"
            type="password"
            value={currentPassword}
            disabled={state === "submitting"}
            onChange={(e) => {
              setCurrentPassword(e.currentTarget.value);
              if (state !== "idle") setState("idle");
            }}
            data-testid="profile-current-password-input"
            aria-invalid={state === "error"}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-password">新密码</Label>
          <Input
            id="new-password"
            type="password"
            value={newPassword}
            disabled={state === "submitting"}
            onChange={(e) => {
              setNewPassword(e.currentTarget.value);
              if (state !== "idle") setState("idle");
            }}
            data-testid="profile-new-password-input"
            aria-invalid={state === "invalid"}
          />
          <p className="text-10 text-muted-foreground">至少 12 个字符，不能是常见弱密码。</p>
        </div>

        {state === "invalid" && errorMessage ? (
          <p role="alert" data-testid="err-new-password" className="text-11 text-destructive">{errorMessage}</p>
        ) : null}
        {state === "error" && errorMessage ? (
          <p role="alert" data-testid="profile-password-error" className="flex items-center gap-1.5 text-11 text-destructive">
            <AlertTriangle aria-hidden className="h-3.5 w-3.5 shrink-0" />
            {errorMessage}
          </p>
        ) : null}
        {state === "success" ? (
          <div
            role="status"
            data-testid="profile-password-success"
            className="flex flex-col gap-1 rounded-md border border-success/30 bg-success/10 px-3 py-2 text-11 text-success"
          >
            <span className="flex items-center gap-1.5 font-medium">
              <CheckCircle2 aria-hidden className="h-3.5 w-3.5 shrink-0" />
              密码已修改
            </span>
            {/* 硬约束：改密后"其它设备已登出"必须让用户看得见，不能是静默副作用。 */}
            <span data-testid="profile-password-revoked-count">
              {revokedCount !== null && revokedCount > 0
                ? `已同时登出其它 ${revokedCount} 台设备/会话，本设备保持登录。`
                : "本次没有其它设备在线，无需额外登出。"}
            </span>
          </div>
        ) : null}

        <div>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={state === "submitting" || currentPassword.length === 0 || newPassword.length === 0}
            data-testid="profile-password-submit"
          >
            {state === "submitting" ? "修改中…" : "修改密码"}
          </Button>
        </div>
      </form>
    </div>
  );
}

function describePasswordFailure(failure: unknown): string {
  if (failure instanceof ApiError) {
    if (failure.reasonCode === "CURRENT_PASSWORD_INVALID") return "当前密码不正确。";
    if (failure.reasonCode === "PASSWORD_POLICY_VIOLATION") return "新密码强度不够（太短或是常见弱密码），换一个更强的。";
    if (failure.status === 401) return "登录已失效（HTTP 401），请重新登录。";
    return `${failure.reasonCode ?? "修改失败"}（HTTP ${failure.status}）`;
  }
  return failure instanceof Error ? failure.message : "修改失败，请稍后重试。";
}

/* ═══════════════════════════ 活动记录 ═══════════════════════════ */

function ActivitySection({ refreshKey }: { refreshKey: number }) {
  const [state, setState] = React.useState<UiState>("loading");
  const [failureMessage, setFailureMessage] = React.useState<string | null>(null);
  const [out, setOut] = React.useState<ListOwnActivityOut | null>(null);
  const [loadingMore, setLoadingMore] = React.useState(false);

  const load = React.useCallback(async () => {
    setState("loading");
    setFailureMessage(null);
    try {
      const result = await listOwnActivity({ cursor: null, limit: 20 });
      setOut(result);
      setState(result.events.length === 0 ? "empty" : "default");
    } catch (err) {
      setFailureMessage(describeActivityFailure(err));
      setState("dep-failed");
    }
  }, []);

  // `refreshKey` 变化（本页任一成功操作：改名/换头像/改密码）时重新拉一次列表——
  // 不这样做的话，用户在同一页看到的活动记录永远是打开页面那一刻的旧快照。
  React.useEffect(() => {
    void load();
  }, [load, refreshKey]);

  async function loadMore() {
    if (!out?.nextCursor) return;
    setLoadingMore(true);
    try {
      const more = await listOwnActivity({ cursor: out.nextCursor, limit: 20 });
      setOut((prev) => (prev ? { events: [...prev.events, ...more.events], nextCursor: more.nextCursor } : more));
    } catch {
      // 加载更多失败不打断已展示的内容，只是这次没成功——不弹出全屏错误态。
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-panel p-4" data-testid="profile-activity-section">
      <div className="flex items-center gap-2">
        <Clock aria-hidden className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-13 font-semibold">活动记录</h2>
      </div>

      <StateShell
        state={state}
        emptyHint="还没有活动记录。"
        depFailure={{ what: failureMessage ?? "活动记录服务暂时不可用", retry: load }}
      >
        <ul className="flex flex-col gap-2" data-testid="profile-activity-list">
          {out?.events.map((event) => (
            <li
              key={event.eventId}
              data-testid={`profile-activity-${event.eventId}`}
              className="flex items-start justify-between gap-3 border-b border-border/60 pb-2 last:border-none last:pb-0"
            >
              <div className="flex flex-col gap-0.5 overflow-hidden">
                <span className="truncate text-12">{event.summary}</span>
              </div>
              <time className="shrink-0 text-10 text-muted-foreground" dateTime={event.occurredAt}>
                {formatActivityTime(event.occurredAt)}
              </time>
            </li>
          ))}
        </ul>
      </StateShell>

      {state === "default" && out?.nextCursor ? (
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={loadingMore}
          onClick={loadMore}
          data-testid="profile-activity-load-more"
        >
          {loadingMore ? "加载中…" : "加载更多"}
        </Button>
      ) : null}
    </div>
  );
}

function formatActivityTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("zh-CN", { hour12: false });
  } catch {
    return iso;
  }
}

function describeActivityFailure(failure: unknown): string {
  if (failure instanceof ApiError) {
    if (failure.status === 401) return "登录已失效（HTTP 401），请重新登录。";
    return `${failure.reasonCode ?? "加载失败"}（HTTP ${failure.status}）`;
  }
  return failure instanceof Error ? failure.message : "加载失败，请稍后重试。";
}

function describeFailure(failure: unknown): string {
  if (failure instanceof ApiError) {
    if (failure.status === 401) return "登录已失效（HTTP 401），请重新登录。";
    if (failure.status === 400) return `${failure.reasonCode ?? "输入不合法"}（HTTP 400）。`;
    return `${failure.reasonCode ?? "保存失败"}（HTTP ${failure.status}）`;
  }
  return failure instanceof Error ? failure.message : "保存失败，请稍后重试。";
}
