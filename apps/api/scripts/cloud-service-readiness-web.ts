const WEB_ROOT = "http://web:3000/";
const LOGIN_PATH = "/login";
const LOGIN_MARKER = 'data-testid="login-form"';
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export type ReadinessFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

function validatedLoginUrl(response: Response): URL {
  const location = response.headers.get("location");
  if (!location) throw new Error("WEB_LOGIN_REDIRECT_INVALID");

  let target: URL;
  try {
    target = new URL(location, WEB_ROOT);
  } catch {
    throw new Error("WEB_LOGIN_REDIRECT_INVALID");
  }
  const root = new URL(WEB_ROOT);
  if (
    target.origin !== root.origin
    || target.pathname !== LOGIN_PATH
    || target.search !== ""
    || target.hash !== ""
    || target.username !== ""
    || target.password !== ""
  ) {
    throw new Error("WEB_LOGIN_REDIRECT_INVALID");
  }
  return target;
}

async function assertLoginDocument(response: Response): Promise<void> {
  if (response.status !== 200) {
    await response.body?.cancel();
    throw new Error("WEB_LOGIN_RESPONSE_INVALID");
  }
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("text/html")) {
    await response.body?.cancel();
    throw new Error("WEB_LOGIN_RESPONSE_INVALID");
  }
  if (!(await response.text()).includes(LOGIN_MARKER)) {
    throw new Error("WEB_LOGIN_MARKER_MISSING");
  }
}

export async function probeWebLoginPage(
  fetchImpl: ReadinessFetch = fetch,
  signal?: AbortSignal,
): Promise<void> {
  const rootResponse = await fetchImpl(WEB_ROOT, { signal, redirect: "manual" });
  if (!REDIRECT_STATUSES.has(rootResponse.status)) {
    await assertLoginDocument(rootResponse);
    return;
  }

  const loginUrl = validatedLoginUrl(rootResponse);
  await rootResponse.body?.cancel();
  const loginResponse = await fetchImpl(loginUrl.toString(), { signal, redirect: "error" });
  await assertLoginDocument(loginResponse);
}
