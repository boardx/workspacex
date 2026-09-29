import * as React from "react";

/**
 * Small, first-party SVG illustrations keyed by `AvatarKey` (`@repo/contracts/interview-expert-avatar`,
 * 25 values: `person-1`..`person-24` + `robot`). No remote image requests, no untrusted SVG injection.
 *
 * 迁移自 `components/itv/expert-avatar.tsx`（AG04，`ui/avatar.tsx` 需要同一套插画渲染逻辑给
 * agent-role 目录卡片用，两处各画一份会立刻漂移——见 AGENTS.md「同一事实不得声明在两处」）。
 * `expert-avatar.tsx` 现在从这里重新导出，行为逐字不变。
 */
export function AvatarIllustration({ avatarKey }: { avatarKey: string }) {
  const index = avatarKey === "robot" ? 0 : Number(avatarKey.slice(7)) - 1;
  const hair = index % 6;
  const accessory = Math.floor(index / 6);
  return <svg viewBox="0 0 64 64" fill="none" aria-hidden="true" className="size-full">
    <circle cx="32" cy="32" r="31" fill="currentColor" opacity=".08" />
    {avatarKey === "robot" ? <g stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M32 13v6M15 30h-3v11h3M49 30h3v11h-3" />
      <rect x="17" y="21" width="30" height="27" rx="9" fill="currentColor" opacity=".15" />
      <rect x="17" y="21" width="30" height="27" rx="9" />
      <circle cx="26" cy="32" r="2" fill="currentColor" /><circle cx="38" cy="32" r="2" fill="currentColor" />
      <path d="M26 40h12M23 54h18" />
    </g> : <>
      <path d="M9 61c1-14 9-21 23-21s22 7 23 21" fill="currentColor" opacity={accessory === 3 ? ".45" : ".22"} />
      <path d="M27 38v7l5 5 5-5v-7" fill="currentColor" opacity=".12" />
      {hair >= 3 && <path d="M15 24c0-18 34-18 34 0v24H15Z" fill="currentColor" opacity=".65" />}
      <ellipse cx="32" cy="28" rx="13" ry="16" className="fill-background" />
      <ellipse cx="32" cy="28" rx="13" ry="16" fill="currentColor" opacity=".12" />
      {hair === 0 && <path d="M18 25c-2-18 26-21 29-3l-3 7-3-12-17 5-4 8Z" fill="currentColor" opacity=".8" />}
      {hair === 1 && <path d="M18 25c-3-20 29-22 29 0l-9-10-18 15Z" fill="currentColor" opacity=".8" />}
      {hair === 2 && <path d="M19 23c0-16 26-16 26 0l-6-8-14 1Z" fill="currentColor" opacity=".65" />}
      {hair === 3 && <path d="M17 26c0-18 30-18 30 0L34 14 19 32Z" fill="currentColor" opacity=".8" />}
      {hair === 4 && <path d="M18 25c-3-18 31-20 29 0l-8-8-7 7-8-6Z" fill="currentColor" opacity=".8" />}
      {hair === 5 && <><circle cx="32" cy="10" r="7" fill="currentColor" opacity=".8" /><path d="M18 25c0-19 29-19 28 0L33 15Z" fill="currentColor" opacity=".8" /></>}
      <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <path d="M26 28h1M37 28h1M29 36q3 2 6 0" />
        {accessory === 1 && <><rect x="22" y="24" width="9" height="8" rx="3" /><rect x="33" y="24" width="9" height="8" rx="3" /><path d="M31 27h2" /></>}
        {accessory === 2 && <path d="M23 34q0 9 9 9t9-9M28 34h8" />}
        {accessory === 3 && <path d="m25 45 7 6 7-6M32 51v10" />}
      </g>
    </>}
  </svg>;
}
