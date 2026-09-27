import { AVATAR_KEYS, AvatarKey, ExpertAvatarPreference, type ExpertAvatarContext } from "@repo/contracts/interview-expert-avatar";
import { apiRequest, getStoredSessionToken } from "./api-client";
export { AVATAR_KEYS };
export type { ExpertAvatarContext };
/** Presentation preferences, separate from agent profiles and research evidence. */
export const AVATAR_CHANGED_EVENT = "itv-expert-avatar-changed";
let activeSession: string | null = null;
const preferences = new Map<string, ExpertAvatarPreference>();
const pending = new Map<string, Promise<void>>();

function currentSession(): string | null {
  const token = getStoredSessionToken();
  if (token !== activeSession) { activeSession = token; preferences.clear(); pending.clear(); }
  return token;
}
function changed() { window.dispatchEvent(new Event(AVATAR_CHANGED_EVENT)); }
function preferencePath(expertId: string, context?: ExpertAvatarContext) {
  return context ? `/interviews/digital/${encodeURIComponent(context.interviewId)}/markdown/experts/${encodeURIComponent(expertId)}/avatar`
    : `/interviews/digital/experts/${encodeURIComponent(expertId)}/avatar`;
}
function preferenceCacheKey(expertId: string, context?: ExpertAvatarContext) {
  return JSON.stringify([context?.interviewId ?? null, context?.revisionId ?? null, expertId]);
}

export function avatarStorageKey(expertId: string, context?: ExpertAvatarContext): string {
  return `workspacex:expert-avatar:v1:${encodeURIComponent(expertId)}${context ? `:interview:${encodeURIComponent(context.interviewId)}` : ""}`;
}

export function isAvatarKey(value: string | null): value is string {
  return AvatarKey.safeParse(value).success;
}

export function defaultExpertAvatar(expertId: string): string {
  let hash = 2166136261;
  for (const character of expertId) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  return AVATAR_KEYS[hash % 24] ?? "person-1";
}

export function readExpertAvatar(expertId: string, context?: ExpertAvatarContext): string {
  if (currentSession()) return preferences.get(preferenceCacheKey(expertId, context))?.avatarKey ?? defaultExpertAvatar(expertId);
  try {
    const stored = window.localStorage.getItem(avatarStorageKey(expertId, context));
    return isAvatarKey(stored) ? stored : defaultExpertAvatar(expertId);
  } catch { return defaultExpertAvatar(expertId); }
}

/** Never migrate unscoped browser preferences into an authenticated account automatically. */
export async function loadExpertAvatar(expertId: string, context?: ExpertAvatarContext): Promise<void> {
  const token = currentSession();
  if (!token) return;
  const cacheKey = preferenceCacheKey(expertId, context);
  const existing = pending.get(cacheKey);
  if (existing) return existing;
  const request = apiRequest(preferencePath(expertId, context), { sessionToken: token, query: context ? { revisionId: context.revisionId } : undefined }).then((response) => {
    const preference = ExpertAvatarPreference.parse(response);
    if (preference.expertId !== expertId) throw new Error("Avatar expert mismatch");
    if (currentSession() === token && preference.version >= (preferences.get(cacheKey)?.version ?? 0)) {
      preferences.set(cacheKey, preference); changed();
    }
  }).finally(() => { if (activeSession === token) pending.delete(cacheKey); });
  pending.set(cacheKey, request);
  return request;
}

export async function saveExpertAvatar(expertId: string, key: string | null, context?: ExpertAvatarContext): Promise<void> {
  if (key !== null && !isAvatarKey(key)) throw new Error("Invalid avatar key");
  const token = currentSession();
  if (token) {
    const cacheKey = preferenceCacheKey(expertId, context);
    if (!preferences.has(cacheKey)) await loadExpertAvatar(expertId, context);
    if (currentSession() !== token) throw new Error("Avatar session changed");
    const response = await apiRequest(preferencePath(expertId, context), { method: "PATCH", sessionToken: token,
      body: { avatarKey: key, expectedVersion: preferences.get(cacheKey)?.version ?? 0, ...(context ? { revisionId: context.revisionId } : {}) } });
    const preference = ExpertAvatarPreference.parse(response);
    if (preference.expertId !== expertId || currentSession() !== token) throw new Error("Avatar session changed");
    preferences.set(cacheKey, preference);
    changed();
    return;
  }
  // Signed-out design previews keep their explicitly browser-local editing behavior.
  if (key === null) window.localStorage.removeItem(avatarStorageKey(expertId, context));
  else window.localStorage.setItem(avatarStorageKey(expertId, context), key);
  changed();
}
