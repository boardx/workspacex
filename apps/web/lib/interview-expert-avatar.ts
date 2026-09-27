/** Presentation-only preferences: no profile, evidence or Markdown content is changed. */
export const AVATAR_KEYS = [...Array.from({ length: 24 }, (_, index) => `person-${index + 1}`), "robot"] as const;
export const AVATAR_CHANGED_EVENT = "itv-expert-avatar-changed";

export function avatarStorageKey(expertId: string): string {
  return `workspacex:expert-avatar:v1:${encodeURIComponent(expertId)}`;
}

export function isAvatarKey(value: string | null): value is string {
  return value !== null && AVATAR_KEYS.includes(value);
}

export function defaultExpertAvatar(expertId: string): string {
  let hash = 2166136261;
  for (const character of expertId) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  return AVATAR_KEYS[hash % 24] ?? "person-1";
}

export function readExpertAvatar(expertId: string): string {
  try {
    const stored = window.localStorage.getItem(avatarStorageKey(expertId));
    return isAvatarKey(stored) ? stored : defaultExpertAvatar(expertId);
  } catch { return defaultExpertAvatar(expertId); }
}

export function saveExpertAvatar(expertId: string, key: string | null): void {
  if (key !== null && !isAvatarKey(key)) throw new Error("Invalid avatar key");
  if (key === null) window.localStorage.removeItem(avatarStorageKey(expertId));
  else window.localStorage.setItem(avatarStorageKey(expertId), key);
  window.dispatchEvent(new Event(AVATAR_CHANGED_EVENT));
}
