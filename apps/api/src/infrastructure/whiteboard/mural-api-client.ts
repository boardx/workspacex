import { setTimeout as wait } from "node:timers/promises";
import { z } from "zod";
import { whiteboardMural as C } from "@repo/contracts";
import {
  MuralImportError as Fault,
  MuralRemoteUnauthorized,
  type MuralRemoteClient,
  type MuralTokenResult,
} from "../../application/whiteboard/mural-ports";
const ORIGIN = "https://app.mural.co",
  BASE = "/api/public/v1";
const Token = z
  .object({
    access_token: z.string().min(1).max(16384),
    refresh_token: z.string().min(1).max(16384).nullable().optional(),
    expires_in: z.number().int().positive().max(31536000).optional(),
    scope: z.string().max(2000).optional(),
  })
  .passthrough();
const Named = z
  .object({
    id: z.string().min(1).max(256),
    name: z.string().min(1).max(200).optional(),
    title: z.string().min(1).max(200).optional(),
    updatedOn: z.union([z.string().datetime(), z.number().int().nonnegative()]).optional(),
    updatedAt: z.union([z.string().datetime(), z.number().int().nonnegative()]).optional(),
  })
  .passthrough()
  .refine((v) => Boolean(v.name || v.title));
const Page = z
  .object({
    value: z.array(Named).max(C.MURAL_DIRECT_IMPORT.pageLimit),
    next: z.string().min(1).max(2000).nullable().optional(),
  })
  .passthrough();
const WidgetPage = z
  .object({
    value: z
      .array(z.record(z.unknown()))
      .max(C.MURAL_DIRECT_IMPORT.widgetPageLimit),
    next: z.string().min(1).max(2000).nullable().optional(),
  })
  .passthrough();
const timestamp = (value: string | number | undefined): string | null => value === undefined ? null : typeof value === 'number' ? new Date(value).toISOString() : value;
const DetailEnvelope = z.object({ value: Named }).passthrough();
export interface MuralClientConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  readonly appPublicUrl: string;
}
async function readBoundedJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declared) &&
    declared > C.MURAL_DIRECT_IMPORT.maxResponseBytes
  )
    throw new Fault("PAYLOAD_TOO_LARGE");
  if (!response.body) throw new Fault("REMOTE_SCHEMA_CHANGED");
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > C.MURAL_DIRECT_IMPORT.maxResponseBytes)
        throw new Fault("PAYLOAD_TOO_LARGE");
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Fault("REMOTE_SCHEMA_CHANGED");
  }
}
export class MuralApiClient implements MuralRemoteClient {
  constructor(
    private readonly config: MuralClientConfig,
    private readonly http: typeof fetch = fetch,
    private readonly sleep: (ms: number) => Promise<unknown> = (ms) => wait(ms),
    private readonly timeoutMs = 10_000,
    private readonly now: () => number = Date.now,
  ) {
    let callback: URL, app: URL;
    try {
      callback = new URL(config.redirectUri);
      app = new URL(config.appPublicUrl);
    } catch {
      throw new Error("MURAL_OAUTH_CONFIG_INVALID");
    }
    if (
      !config.clientId ||
      !config.clientSecret ||
      callback.protocol !== "https:" ||
      callback.origin !== app.origin ||
      callback.pathname !== "/studio/board/mural/callback" ||
      callback.search ||
      callback.hash ||
      callback.username ||
      callback.password ||
      app.protocol !== "https:" ||
      app.pathname !== "/" ||
      app.search ||
      app.hash ||
      app.username ||
      app.password
    )
      throw new Error("MURAL_OAUTH_CONFIG_INVALID");
  }
  authorizationUrl(state: string) {
    const url = new URL(`${BASE}/authorization/oauth2/`, ORIGIN);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", this.config.clientId);
    url.searchParams.set("redirect_uri", this.config.redirectUri);
    url.searchParams.set("scope", C.MURAL_DIRECT_IMPORT.scopes.join(" "));
    url.searchParams.set("state", state);
    return url.toString();
  }
  exchange(code: string) {
    return this.token({
      grant_type: "authorization_code",
      code,
      redirect_uri: this.config.redirectUri,
    });
  }
  refresh(refresh: string) {
    return this.token({ grant_type: "refresh_token", refresh_token: refresh });
  }
  async revoke(_access: string): Promise<void> {
    /* Mural Public API documents no token-revoke endpoint; local deletion is authoritative. */
  }
  async workspaces(access: string, next: string | undefined, limit: number) {
    const url = this.url("/workspaces", { limit: String(limit), next });
    const parsed = Page.safeParse(
      await this.send(url, { headers: { authorization: `Bearer ${access}` } }),
    );
    if (!parsed.success) throw new Fault("REMOTE_SCHEMA_CHANGED");
    return {
      items: parsed.data.value.map((v) => ({
        id: v.id,
        name: (v.name ?? v.title)!,
      })),
      next: parsed.data.next ?? null,
    };
  }
  async murals(
    access: string,
    workspaceId: string,
    next: string | undefined,
    limit: number,
  ) {
    const url = this.url(
      `/workspaces/${encodeURIComponent(workspaceId)}/murals`,
      { status: "active", sortBy: "lastModified", limit: String(limit), next },
    );
    const parsed = Page.safeParse(
      await this.send(url, { headers: { authorization: `Bearer ${access}` } }),
    );
    if (!parsed.success) throw new Fault("REMOTE_SCHEMA_CHANGED");
    return {
      items: parsed.data.value.map((v) => ({
        id: v.id,
        name: (v.name ?? v.title)!,
        modifiedAt: timestamp(v.updatedOn ?? v.updatedAt)
      })),
      next: parsed.data.next ?? null,
    };
  }
  async mural(access: string, muralId: string) {
    const raw = await this.send(
        this.url(`/murals/${encodeURIComponent(muralId)}`),
        { headers: { authorization: `Bearer ${access}` } },
      ),
      envelope = DetailEnvelope.safeParse(raw),
      parsed = Named.safeParse(envelope.success ? envelope.data.value : raw);
    if (!parsed.success) throw new Fault("REMOTE_SCHEMA_CHANGED");
    return {
      id: parsed.data.id,
      name: (parsed.data.name ?? parsed.data.title)!,
    };
  }
  async widgets(access: string, muralId: string, next?: string) {
    const parsed = WidgetPage.safeParse(
      await this.send(
        this.url(`/murals/${encodeURIComponent(muralId)}/widgets`, {
          limit: String(C.MURAL_DIRECT_IMPORT.widgetPageLimit),
          next,
        }),
        { headers: { authorization: `Bearer ${access}` } },
      ),
    );
    if (!parsed.success) throw new Fault("REMOTE_SCHEMA_CHANGED");
    return { data: parsed.data.value, next: parsed.data.next ?? null };
  }
  private url(path: string, params: Record<string, string | undefined> = {}) {
    const url = new URL(`${BASE}${path}`, ORIGIN);
    for (const [key, value] of Object.entries(params))
      if (value) url.searchParams.set(key, value);
    return url;
  }
  private async token(
    values: Record<string, string>,
  ): Promise<MuralTokenResult> {
    const body = new URLSearchParams({
      ...values,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    });
    const parsed = Token.safeParse(
      await this.send(this.url("/authorization/oauth2/token"), {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      }),
    );
    if (!parsed.success) throw new Fault("REMOTE_SCHEMA_CHANGED");
    const returned = parsed.data.scope?.split(/\s+/).filter(Boolean);
    if (returned && (returned.length !== C.MURAL_DIRECT_IMPORT.scopes.length || C.MURAL_DIRECT_IMPORT.scopes.some((scope) => !returned.includes(scope))))
      throw new Fault("OAUTH_SCOPE_INSUFFICIENT");
    return {
      credential: {
        access: parsed.data.access_token,
        refresh: parsed.data.refresh_token ?? null,
      },
      scopes: [...C.MURAL_DIRECT_IMPORT.scopes],
      expiresAt: parsed.data.expires_in
        ? new Date(this.now() + parsed.data.expires_in * 1000).toISOString()
        : null,
    };
  }
  private async send(url: URL, init: RequestInit): Promise<unknown> {
    if (url.origin !== ORIGIN || !url.pathname.startsWith(`${BASE}/`))
      throw new Fault("INVALID_REQUEST");
    for (let attempt = 0; attempt < 3; attempt++) {
      const abort = new AbortController(),
        timer = setTimeout(() => abort.abort(), this.timeoutMs);
      let response: Response;
      try {
        response = await this.http(url, {
          ...init,
          signal: abort.signal,
          redirect: "error",
        });
      } catch (error) {
        if ((error as { name?: string }).name === "AbortError")
          throw new Fault("REMOTE_TIMEOUT");
        throw new Fault("REMOTE_UNAVAILABLE");
      } finally {
        clearTimeout(timer);
      }
      if (response.status === 429) {
        await response.body?.cancel();
        if (attempt === 2) throw new Fault("REMOTE_RATE_LIMITED");
        const header = response.headers.get("retry-after"),
          seconds = header === null ? NaN : Number(header),
          date = header === null ? NaN : Date.parse(header),
          delay = Number.isFinite(seconds)
            ? seconds * 1000
            : Number.isFinite(date)
              ? date - this.now()
              : 250 * 2 ** attempt;
        await this.sleep(Math.min(10_000, Math.max(0, delay)));
        continue;
      }
      if (response.status === 401) {
        await response.body?.cancel();
        throw new MuralRemoteUnauthorized();
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Fault("REMOTE_UNAVAILABLE");
      }
      return readBoundedJson(response);
    }
    throw new Fault("REMOTE_RATE_LIMITED");
  }
}
export function muralApiClientFromEnv() {
  return new MuralApiClient({
    clientId: process.env.MURAL_CLIENT_ID ?? "",
    clientSecret: process.env.MURAL_CLIENT_SECRET ?? "",
    redirectUri: process.env.MURAL_OAUTH_REDIRECT_URI ?? "",
    appPublicUrl: process.env.APP_PUBLIC_URL ?? "",
  });
}
export class EnvironmentMuralApiClient implements MuralRemoteClient {
  private client() {
    return muralApiClientFromEnv();
  }
  authorizationUrl(state: string) {
    return this.client().authorizationUrl(state);
  }
  exchange(code: string) {
    return this.client().exchange(code);
  }
  refresh(token: string) {
    return this.client().refresh(token);
  }
  revoke(access: string) {
    return this.client().revoke(access);
  }
  workspaces(access: string, next: string | undefined, limit: number) {
    return this.client().workspaces(access, next, limit);
  }
  murals(
    access: string,
    workspaceId: string,
    next: string | undefined,
    limit: number,
  ) {
    return this.client().murals(access, workspaceId, next, limit);
  }
  mural(access: string, id: string) {
    return this.client().mural(access, id);
  }
  widgets(access: string, id: string, next?: string) {
    return this.client().widgets(access, id, next);
  }
}
