"use client";

/** Teaching copy belongs to this host; composer/messages remain canonical Chat. */
export function AidtChatEmptyState(): JSX.Element {
  return <div data-testid="copilotkit-v2-empty" className="flex min-h-full flex-col items-center justify-center gap-4 px-4 py-4 text-center sm:px-6">
    <div className="flex flex-col items-center gap-2" data-testid="aidt-chat-welcome">
      <p className="max-w-xl text-24 font-semibold tracking-tight text-card-foreground sm:text-30">先说说你们的想法</p>
      <p className="max-w-lg text-14 leading-relaxed text-muted-foreground">从一次具体的观察或经历开始。</p>
    </div>
  </div>;
}
