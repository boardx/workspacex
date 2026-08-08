"use client";

import * as React from "react";
import Link from "next/link";
import { BrainCircuit, ChevronRight, ImageOff, User } from "lucide-react";
import { AppShell } from "@/components/shell/app-shell";
import { useSession } from "@/components/session/session-provider";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StateShell, type UiState } from "@/components/state/state-shell";
import { ApiError } from "@/lib/api-client";
import { updateOwnProfile } from "@/lib/live-identity";

/**
 * `/profile` —— 个人资料页（#638 delta，迭代 1）。
 *
 * ## 本轮范围
 * 只做 `updateOwnProfile` 的 `displayName` 编辑。头像上传（`uploadOwnAvatar`）本轮
 * 不做——下面的头像区块是**禁用态占位**，不接受点击，标题说明"下一轮开放"，
 * 不是漏做了交互。
 */
export function ProfileScreen() {
  const { session, identity } = useSession();

  return (
    <AppShell previewRole={null}>
      <div className="mx-auto flex max-w-lg flex-col gap-6 p-6" data-testid="profile-screen">
        <div className="flex items-center gap-2">
          <User aria-hidden className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-16 font-semibold tracking-tight">个人资料</h1>
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
          <ProfileForm initialDisplayName={identity.displayName} />
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

function ProfileForm({ initialDisplayName }: { initialDisplayName: string }) {
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
    } catch (err) {
      setFailureMessage(describeFailure(err));
      setState("dep-failed");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* 头像区块 —— 禁用态占位（uploadOwnAvatar 本轮不做，见文件头注释） */}
      <div className="flex items-center gap-3 rounded-lg border border-border bg-panel p-3" data-testid="profile-avatar-block">
        <Avatar initials={savedName.slice(0, 1)} size="lg" />
        <div className="flex flex-col gap-1">
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled
            data-testid="profile-avatar-upload"
            aria-disabled="true"
            title="头像上传下一轮开放"
          >
            <ImageOff aria-hidden className="h-3 w-3" />
            更换头像
          </Button>
          <p className="text-10 text-muted-foreground">头像上传本轮暂未开放，下一轮迭代接入。</p>
        </div>
      </div>

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

function describeFailure(failure: unknown): string {
  if (failure instanceof ApiError) {
    if (failure.status === 401) return "登录已失效（HTTP 401），请重新登录。";
    if (failure.status === 400) return `${failure.reasonCode ?? "输入不合法"}（HTTP 400）。`;
    return `${failure.reasonCode ?? "保存失败"}（HTTP ${failure.status}）`;
  }
  return failure instanceof Error ? failure.message : "保存失败，请稍后重试。";
}
