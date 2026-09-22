/**
 * Desktop auto sign-in: the runtime owns the local account (secrets.json), so it signs in
 * itself and hands the issued session to the web UI through the login page's URL fragment.
 *
 * ⚠ Wire format is declared in ONE place -- `apps/web/lib/local-session-handoff.ts`
 * (`#wsx-local-session=<base64url(JSON LoginOut)>`); this file only produces it. The
 * round-trip test in `test/local-session.test.ts` decodes with the web parser so the two
 * cannot drift silently.
 */
export const LOCAL_SESSION_HASH_KEY = "wsx-local-session";

export async function signInLocal(apiUrl: string, login: { email: string; password: string }): Promise<unknown> {
  const res = await fetch(`${apiUrl}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(login),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`local sign-in failed: HTTP ${res.status}`);
  return (await res.json()) as unknown;
}

export function localSessionUrl(webUrl: string, loginOut: unknown): string {
  const b64 = Buffer.from(JSON.stringify(loginOut), "utf8").toString("base64url");
  return `${webUrl}/login#${LOCAL_SESSION_HASH_KEY}=${b64}`;
}
