import { createHash, randomBytes, randomUUID } from "node:crypto";
import { whiteboardMural as C, whiteboardTransfer as T } from "@repo/contracts";
import { convertExternalBoardSnapshot } from "@repo/whiteboard-core";
import type { Principal } from "../../domain/principal";
import type { WhiteboardTransferStore } from "./transfer-ports";
import {
  MuralImportError as Fault,
  MuralRemoteUnauthorized,
  type MuralCredentialCipher,
  type MuralCredentialRepository,
  type MuralRemoteClient,
  type MuralTokenResult,
  type SealedMuralCredential,
} from "./mural-ports";
const STATE_TTL_MS = 10 * 60 * 1000,
  digest = (value: string) =>
    createHash("sha256").update(value, "utf8").digest("hex");
export class MuralDirectImport {
  readonly #refreshes = new Map<string, Promise<SealedMuralCredential>>();
  constructor(
    private readonly repository: MuralCredentialRepository,
    private readonly cipher: MuralCredentialCipher,
    private readonly client: MuralRemoteClient,
    private readonly transfer: WhiteboardTransferStore,
    private readonly clock: () => Date = () => new Date(),
  ) {}
  async start(p: Principal, raw: C.StartMuralOAuthInput) {
    const input = C.StartMuralOAuthInput.parse(raw),
      state = randomBytes(32).toString("base64url"),
      now = this.clock();
    await this.repository.createState(
      p,
      digest(state),
      input.returnTo,
      new Date(now.getTime() + STATE_TTL_MS),
    );
    return C.StartMuralOAuthResult.parse({
      authorizationUrl: this.client.authorizationUrl(state),
    });
  }
  async callback(p: Principal, state: string, code: string) {
    if (!state || state.length > 500 || !code || code.length > 8192)
      throw new Fault("OAUTH_STATE_INVALID");
    const consumed = await this.repository.consumeState(
      p,
      digest(state),
      this.clock(),
    );
    if (!consumed) throw new Fault("OAUTH_STATE_INVALID");
    const token = await this.client.exchange(code);
    await this.save(p, token);
    await this.repository.audit(p, "connected");
    return consumed;
  }
  async connection(p: Principal): Promise<C.MuralConnection> {
    const value = await this.repository.load(p);
    return C.MuralConnection.parse(
      value
        ? {
            connected: true,
            scopes: value.scopes,
            connectedAt: value.connectedAt,
          }
        : { connected: false, scopes: [], connectedAt: null },
    );
  }
  async listWorkspaces(
    p: Principal,
    raw: unknown,
  ): Promise<C.ListMuralWorkspacesResult> {
    const query = C.PageQuery.parse(raw);
    return C.ListMuralWorkspacesResult.parse(
      await this.authorized(p, (access) =>
        this.client.workspaces(access, query.next, query.limit),
      ),
    );
  }
  async listMurals(
    p: Principal,
    raw: unknown,
  ): Promise<C.ListWorkspaceMuralsResult> {
    const query = C.ListWorkspaceMuralsQuery.parse(raw);
    return C.ListWorkspaceMuralsResult.parse(
      await this.authorized(p, (access) =>
        this.client.murals(access, query.workspaceId, query.next, query.limit),
      ),
    );
  }
  async preview(
    p: Principal,
    raw: C.PreviewMuralInput,
  ): Promise<C.PreviewMuralResult> {
    const input = C.PreviewMuralInput.parse(raw);
    const mural = await this.authorized(p, (access) =>
      this.client.mural(access, input.muralId),
    );
    const widgets: Record<string, unknown>[] = [],
      tokens = new Set<string>();
    let next: string | undefined;
    while (true) {
      const page = await this.authorized(p, (access) =>
        this.client.widgets(access, input.muralId, next),
      );
      widgets.push(...page.data);
      if (widgets.length > C.MURAL_DIRECT_IMPORT.maxWidgets)
        throw new Fault("WIDGET_LIMIT_EXCEEDED");
      if (!page.next) break;
      if (tokens.has(page.next)) throw new Fault("REPEATED_CURSOR");
      tokens.add(page.next);
      next = page.next;
    }
    const converted = convertExternalBoardSnapshot(
      {
        format: "mural.public-api.mural-snapshot",
        schemaVersion: 1,
        exportedAt: this.clock().toISOString(),
        drawingsIncluded: false,
        mural: { id: mural.id, name: mural.name },
        pages: [{ id: "default", name: "Mural", widgets }],
      },
      { packageBoardId: input.packageBoardId },
    );
    if (!converted.ok)
      throw new Fault(
        converted.code === "PAYLOAD_TOO_LARGE"
          ? "PAYLOAD_TOO_LARGE"
          : "REMOTE_SCHEMA_CHANGED",
      );
    const external = {
      ...converted.preview,
      losses: converted.preview.losses.map((loss) =>
        loss.code === "DRAWINGS_NOT_INCLUDED"
          ? {
              ...loss,
              message:
                "Mural Public API 不提供 drawings，因此无法统计或导入绘图内容。",
            }
          : loss,
      ),
    };
    const importInput = T.ImportBoardInput.parse({
        requestId: randomUUID(),
        package: converted.package,
      }),
      preview = await this.transfer.previewImport(p, importInput);
    await this.repository.audit(
      p,
      "import_fetched",
      input.muralId,
      widgets.length,
    );
    return C.PreviewMuralResult.parse({
      input: importInput,
      external,
      preview,
    });
  }
  async disconnect(p: Principal): Promise<{ disconnected: true }> {
    const previous = await this.repository.revoke(p);
    await this.repository.audit(p, "revoked");
    if (previous) {
      try {
        await this.client.revoke(this.cipher.open(p, previous.sealed).access);
      } catch {
        /* local revocation wins */
      }
    }
    return { disconnected: true };
  }
  private async save(p: Principal, token: MuralTokenResult) {
    await this.repository.save(p, {
      sealed: this.cipher.seal(p, token.credential),
      scopes: token.scopes,
      connectedAt: this.clock().toISOString(),
      expiresAt: token.expiresAt,
    });
  }
  private async authorized<T>(
    p: Principal,
    call: (access: string) => Promise<T>,
  ): Promise<T> {
    let record = await this.repository.load(p);
    if (!record) throw new Fault("NOT_CONNECTED");
    try {
      return await call(this.cipher.open(p, record.sealed).access);
    } catch (error) {
      if (!(error instanceof MuralRemoteUnauthorized)) throw error;
      record = await this.refresh(p, record);
      try {
        return await call(this.cipher.open(p, record.sealed).access);
      } catch (retry) {
        if (retry instanceof MuralRemoteUnauthorized)
          throw new Fault("REMOTE_UNAUTHORIZED");
        throw retry;
      }
    }
  }
  private refresh(p: Principal, record: SealedMuralCredential) {
    const key = `${p.orgId}\0${p.userId}`,
      active = this.#refreshes.get(key);
    if (active) return active;
    const pending = this.performRefresh(p, record).finally(() =>
      this.#refreshes.delete(key),
    );
    this.#refreshes.set(key, pending);
    return pending;
  }
  private async performRefresh(p: Principal, record: SealedMuralCredential) {
    const current = this.cipher.open(p, record.sealed);
    if (!current.refresh) throw new Fault("REMOTE_UNAUTHORIZED");
    const next = await this.client.refresh(current.refresh),
      credential = {
        ...next.credential,
        refresh: next.credential.refresh ?? current.refresh,
      },
      rotated = await this.repository.rotate(p, record.revision, {
        sealed: this.cipher.seal(p, credential),
        scopes: next.scopes,
        expiresAt: next.expiresAt,
      }),
      stored = await this.repository.load(p);
    if (!stored) throw new Fault("NOT_CONNECTED");
    if (rotated) await this.repository.audit(p, "refreshed");
    return stored;
  }
}
