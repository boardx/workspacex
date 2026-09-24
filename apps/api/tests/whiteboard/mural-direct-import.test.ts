import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Principal } from "../../src/domain/principal";
import { toOrgId } from "../../src/domain/org-id";
import { MuralDirectImport } from "../../src/application/whiteboard/mural-direct-import";
import {
  MuralRemoteUnauthorized,
  type MuralAuditAction,
  type MuralAuthorizationState,
  type MuralCredentialRepository,
  type MuralRemoteClient,
  type MuralTokenResult,
  type SealedMuralCredential,
} from "../../src/application/whiteboard/mural-ports";
import { AesMuralCredentialCipher } from "../../src/infrastructure/whiteboard/mural-credential-cipher";
import { importPreview } from "../../src/application/whiteboard/portable-board";
import type { WhiteboardTransferStore } from "../../src/application/whiteboard/transfer-ports";
const principal: Principal = { orgId: toOrgId("org-a"), userId: "user-a" },
  key = (p: Principal) => `${p.orgId}:${p.userId}`;
class MemoryRepository implements MuralCredentialRepository {
  states = new Map<
    string,
    {
      owner: string;
      value: MuralAuthorizationState;
      expires: Date;
      used: boolean;
    }
  >();
  credentials = new Map<string, SealedMuralCredential>();
  audits: Array<[MuralAuditAction, string | undefined, number | undefined]> =
    [];
  async createState(p: Principal, h: string, r: string, e: Date) {
    this.states.set(h, {
      owner: key(p),
      value: { returnTo: r },
      expires: e,
      used: false,
    });
  }
  async consumeState(p: Principal, h: string, n: Date) {
    const x = this.states.get(h);
    if (!x || x.owner !== key(p) || x.used || x.expires <= n) return null;
    x.used = true;
    return x.value;
  }
  async save(p: Principal, v: Omit<SealedMuralCredential, "revision">) {
    this.credentials.set(key(p), {
      ...v,
      revision: (this.credentials.get(key(p))?.revision ?? 0) + 1,
    });
  }
  async load(p: Principal) {
    return this.credentials.get(key(p)) ?? null;
  }
  async rotate(
    p: Principal,
    e: number,
    v: Omit<SealedMuralCredential, "revision" | "connectedAt">,
  ) {
    const x = this.credentials.get(key(p));
    if (!x || x.revision !== e) return false;
    this.credentials.set(key(p), { ...x, ...v, revision: x.revision + 1 });
    return true;
  }
  async revoke(p: Principal) {
    const x = this.credentials.get(key(p)) ?? null;
    this.credentials.delete(key(p));
    return x;
  }
  async audit(_p: Principal, a: MuralAuditAction, id?: string, n?: number) {
    this.audits.push([a, id, n]);
  }
}
const token = (access = "access", refresh = "refresh"): MuralTokenResult => ({
  credential: { access, refresh },
  scopes: ["workspaces:read", "murals:read"],
  expiresAt: null,
});
const transfer: WhiteboardTransferStore = {
  previewImport: async (_p, input) => importPreview(input),
  exportBoard: async () => {
    throw new Error("unused");
  },
  importBoard: async () => {
    throw new Error("unused");
  },
};
function remote(overrides: Partial<MuralRemoteClient> = {}): MuralRemoteClient {
  return {
    authorizationUrl: (s) =>
      `https://app.mural.co/api/public/v1/authorization/oauth2/?state=${s}`,
    exchange: async () => token(),
    refresh: async () => token("next", "rotated"),
    revoke: async () => {},
    workspaces: async () => ({
      items: [{ id: "w", name: "Workspace" }],
      next: null,
    }),
    murals: async () => ({
      items: [{ id: "m", name: "Mural", modifiedAt: null }],
      next: null,
    }),
    mural: async () => ({ id: "m", name: "Mural" }),
    widgets: async () => ({ data: [], next: null }),
    ...overrides,
  };
}
async function connected(
  repo: MemoryRepository,
  cipher: AesMuralCredentialCipher,
) {
  await repo.save(principal, {
    sealed: cipher.seal(principal, token().credential),
    scopes: token().scopes,
    connectedAt: new Date().toISOString(),
    expiresAt: null,
  });
}
describe("Mural direct import service", () => {
  it("binds one-time state and ciphertext to tenant and actor", async () => {
    const repo = new MemoryRepository(),
      cipher = new AesMuralCredentialCipher("key"),
      service = new MuralDirectImport(
        repo,
        cipher,
        remote(),
        transfer,
        () => new Date("2026-09-24T00:00:00Z"),
      ),
      state = new URL(
        (
          await service.start(principal, { returnTo: "/studio/board" })
        ).authorizationUrl,
      ).searchParams.get("state")!;
    await expect(
      service.callback({ ...principal, userId: "other" }, state, "code"),
    ).rejects.toMatchObject({ code: "OAUTH_STATE_INVALID" });
    await expect(service.callback(principal, state, "code")).resolves.toEqual({
      returnTo: "/studio/board",
    });
    await expect(
      service.callback(principal, state, "code"),
    ).rejects.toMatchObject({ code: "OAUTH_STATE_INVALID" });
    const sealed = (await repo.load(principal))!.sealed;
    expect(sealed).not.toContain("access");
    expect(() =>
      cipher.open({ ...principal, orgId: toOrgId("other") }, sealed),
    ).toThrow();
  });
  it("lists workspaces then active murals with bounded opaque pages", async () => {
    const repo = new MemoryRepository(),
      cipher = new AesMuralCredentialCipher("key");
    await connected(repo, cipher);
    const workspaces = vi.fn(async () => ({
        items: [{ id: "w", name: "Workspace" }],
        next: "n",
      })),
      murals = vi.fn(async () => ({
        items: [{ id: "m", name: "Mural", modifiedAt: null }],
        next: null,
      })),
      service = new MuralDirectImport(
        repo,
        cipher,
        remote({ workspaces, murals }),
        transfer,
      );
    await expect(
      service.listWorkspaces(principal, { next: "a" }),
    ).resolves.toMatchObject({ next: "n" });
    await service.listMurals(principal, { workspaceId: "w", next: "b" });
    expect(workspaces).toHaveBeenCalledWith("access", "a", 50);
    expect(murals).toHaveBeenCalledWith("access", "w", "b", 50);
  });
  it("paginates widgets, produces atomic preview and visibly discloses the drawing API gap without a fake count", async () => {
    const fixture = JSON.parse(
      readFileSync(
        "../../packages/whiteboard-core/tests/fixtures/mural-board-v1.json",
        "utf8",
      ),
    ) as {
      mural: { id: string; name: string };
      pages: Array<{ widgets: Record<string, unknown>[] }>;
    };
    const widgets = fixture.pages[0]!.widgets.filter(
        (x) => x.type !== "drawing",
      ),
      repo = new MemoryRepository(),
      cipher = new AesMuralCredentialCipher("key");
    await connected(repo, cipher);
    const pages = vi.fn(async (_a: string, _m: string, next?: string) =>
        next
          ? { data: widgets.slice(2), next: null }
          : { data: widgets.slice(0, 2), next: "next" },
      ),
      service = new MuralDirectImport(
        repo,
        cipher,
        remote({ mural: async () => fixture.mural, widgets: pages }),
        transfer,
        () => new Date("2026-09-24T00:00:00Z"),
      ),
      result = await service.preview(principal, {
        muralId: fixture.mural.id,
        packageBoardId: randomUUID(),
      });
    expect(pages).toHaveBeenCalledTimes(2);
    expect(result.preview.destinationName).toContain(fixture.mural.name);
    expect(result.external.losses).toContainEqual(
      expect.objectContaining({
        code: "DRAWINGS_NOT_INCLUDED",
        message: expect.stringContaining("无法统计或导入"),
      }),
    );
    expect(result.input.requestId).toBeTruthy();
  });
  it("single-flights refresh, rejects repeated next, and revokes locally before remote work", async () => {
    const repo = new MemoryRepository(),
      cipher = new AesMuralCredentialCipher("key");
    await connected(repo, cipher);
    const refresh = vi.fn(async () => token("new", "next-refresh")),
      workspaces = vi.fn(async (access: string) => {
        if (access === "access") throw new MuralRemoteUnauthorized();
        return { items: [], next: null };
      }),
      service = new MuralDirectImport(
        repo,
        cipher,
        remote({ refresh, workspaces }),
        transfer,
      );
    await Promise.all([
      service.listWorkspaces(principal, {}),
      service.listWorkspaces(principal, {}),
    ]);
    expect(refresh).toHaveBeenCalledTimes(1);
    const repeated = new MuralDirectImport(
      repo,
      cipher,
      remote({ widgets: async () => ({ data: [], next: "same" }) }),
      transfer,
    );
    await expect(
      repeated.preview(principal, {
        muralId: "m",
        packageBoardId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "REPEATED_CURSOR" });
    let localFirst = false;
    const disconnect = new MuralDirectImport(
      repo,
      cipher,
      remote({
        revoke: async () => {
          localFirst = (await repo.load(principal)) === null;
          throw new Error("offline");
        },
      }),
      transfer,
    );
    await expect(disconnect.disconnect(principal)).resolves.toEqual({
      disconnected: true,
    });
    expect(localFirst).toBe(true);
  });
});
