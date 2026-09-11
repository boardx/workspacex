import { afterEach, expect, it, vi } from "vitest";
import { ensureTrustedDeploymentSecret } from "../src/trusted-generated-secrets";
import { assertTrustedPath } from "../src/trusted-path";
import { ensureDeploymentSecret } from "../src/secrets";
vi.mock("../src/trusted-path", () => ({ assertTrustedPath: vi.fn(async () => {}) }));
vi.mock("../src/secrets", () => ({ assertSecretOperationActive: vi.fn(), ensureDeploymentSecret: vi.fn(async () => "private-key-value") }));
vi.mock("node:fs/promises", () => ({ mkdir: vi.fn(async () => {}), lstat: vi.fn(async () => ({})) }));
afterEach(() => vi.clearAllMocks());
it("checks root-only directory and key before and after the actual atomic secret utility", async () => {
  expect(await ensureTrustedDeploymentSecret("/srv/wsx/secrets", "app-password")).toBe("private-key-value");
  expect(vi.mocked(assertTrustedPath).mock.calls).toEqual([
    ["/srv/wsx", { trustedRoot: "/", kind: "directory" }],
    ["/srv/wsx/secrets", { trustedRoot: "/", kind: "directory", private: true }],
    ["/srv/wsx/secrets/app-password", { trustedRoot: "/", kind: "file", private: true }],
    ["/srv/wsx/secrets", { trustedRoot: "/", kind: "directory", private: true }],
    ["/srv/wsx/secrets/app-password", { trustedRoot: "/", kind: "file", private: true }],
  ]);
});
it("rejects an unsafe existing key before reading or replacing it", async () => {
  vi.mocked(assertTrustedPath).mockImplementationOnce(async () => {}).mockImplementationOnce(async () => {}).mockRejectedValueOnce(new Error("UNTRUSTED_HOST_PATH"));
  await expect(ensureTrustedDeploymentSecret("/srv/wsx/secrets", "app-password")).rejects.toThrow("UNTRUSTED_HOST_PATH");
  expect(ensureDeploymentSecret).not.toHaveBeenCalled();
});
it("never returns a generated key if final ownership verification fails", async () => {
  vi.mocked(assertTrustedPath).mockImplementationOnce(async () => {}).mockImplementationOnce(async () => {}).mockImplementationOnce(async () => {}).mockRejectedValueOnce(new Error("UNTRUSTED_HOST_PATH"));
  await expect(ensureTrustedDeploymentSecret("/srv/wsx/secrets", "app-password")).rejects.toThrow("UNTRUSTED_HOST_PATH");
  expect(ensureDeploymentSecret).toHaveBeenCalledOnce();
});
