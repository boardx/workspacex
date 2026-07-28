import { KeyRound } from "lucide-react";
import { StatePreviewSwitcher } from "@/components/state/state-shell";
import { resolvePreviewState, UI_STATE_LABEL } from "@/lib/ui-state";
import { EntryPreviewSwitcher } from "@/components/entry/preview-switcher";
import { SessionPanel } from "@/components/entry/session-panel";
import { Badge } from "@/components/ui/badge";
import { SESSION, SESSION_SCENES, resolveSessionScene } from "@/lib/mock/entry";

/**
 * 受访者会话屏（裁决 D-U10）——同意书承诺的那条链接落在这里。
 *
 * 「事后你随时可以用这条链接回来改选择、要一份文字稿、或要求删除全部记录」——
 * 这屏就是那个承诺的兑现处。受访者是外部人员，走 `(entry)` 组、**不套 AppShell**。
 *
 * 身份：一次性令牌（UC-6.3），链接形如 `/session?t=<token>`；令牌失效 = denied 态。
 */
export default function SessionPage({
  searchParams,
}: {
  searchParams: { state?: string; scene?: string; t?: string };
}) {
  const state = resolvePreviewState(searchParams.state);
  const scene = resolveSessionScene(searchParams.scene);

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col gap-3 p-4">
      <div className="flex flex-col gap-1.5">
        <StatePreviewSwitcher current={state} />
        <div className="flex flex-wrap gap-1.5">
          <EntryPreviewSwitcher
            label="场景"
            param="scene"
            options={SESSION_SCENES}
            current={scene}
            testid="session-scene-switcher"
          />
        </div>
        <p className="text-10 text-muted-foreground">
          当前状态：<strong className="text-background-foreground">{UI_STATE_LABEL[state]}</strong>
        </p>
      </div>

      <div className="flex flex-1 flex-col gap-5 rounded-lg border border-border bg-card p-6 shadow-sm">
        <header className="flex flex-col gap-2" data-testid="session-header">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-20 font-semibold tracking-tight">你的访谈</h1>
            <Badge tone="neutral">外部受访者</Badge>
          </div>
          <p className="text-13 text-muted-foreground">
            {SESSION.project}。被记录的人，自己也要有一块屏——这里能看到正在发生什么、你授权了什么，
            也能随时改选择、要文字稿或撤回。
          </p>
          <p
            className="inline-flex items-center gap-1.5 text-11 text-muted-foreground"
            data-testid="session-identity"
          >
            <KeyRound aria-hidden className="h-3 w-3" />
            用一次性链接进入，无需账号 · 令牌{" "}
            <span className="font-mono text-11">{SESSION.maskedToken}</span>
          </p>
        </header>

        <SessionPanel state={state} scene={scene} />
      </div>
    </div>
  );
}
