"use client";
import { AvatarIllustration } from "@/components/ui/avatar-illustration";
import { isAvatarKey } from "@/lib/interview-expert-avatar";
import { cn } from "@/lib/utils";

/** Use the configured first-party illustration; never infer a real person or online status. */
export function DigitalHumanPortrait({ avatarKey, initials, className }: { avatarKey: string | null; initials: string; className?: string }) {
  const known = avatarKey !== null && isAvatarKey(avatarKey);
  const key = known ? avatarKey : "robot";
  return <span aria-hidden="true" data-testid="digital-human-portrait" data-avatar-key={known ? key : undefined}
    className={cn("relative block overflow-hidden rounded-container bg-ai-tint text-ai-tint-foreground", className)}>
    <AvatarIllustration avatarKey={key} />
    {!known ? <span className="absolute bottom-2 right-2 rounded-control bg-card px-2 py-1 text-12 font-semibold text-card-foreground">{initials}</span> : null}
  </span>;
}
