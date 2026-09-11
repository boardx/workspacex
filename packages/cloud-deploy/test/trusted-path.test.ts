import { expect, it, vi } from "vitest";
import { assertTrustedPath } from "../src/trusted-path";
const dir = (uid = 0, mode = 0o755) => ({ uid, mode, isDirectory: () => true, isFile: () => false, isSymbolicLink: () => false });
const base = () => new Map([["/", dir()], ["/var", dir()], ["/var/lib", dir()], ["/var/lib/wsx", dir(0, 0o700)]]);
const inspect = (paths: ReturnType<typeof base>) => vi.fn(async (path: string) => { const stat = paths.get(path); if (!stat) throw new Error("secret path missing"); return stat; });
const opts = { trustedRoot: "/", kind: "directory", private: true } as const;
it("checks every component including root without requiring system ancestors to be 0700", async () => {
  const read = inspect(base()); await assertTrustedPath("/var/lib/wsx", opts, read);
  expect(read.mock.calls.map(args => args[0])).toEqual(["/var/lib/wsx", "/var/lib", "/var", "/"]);
});
it.each(["/var/lib/wsx", "/var/lib", "/"])("rejects non-root ownership at %s", async path => {
  const paths = base(); paths.set(path, dir(1000, 0o700));
  await expect(assertTrustedPath("/var/lib/wsx", opts, inspect(paths))).rejects.toThrow("UNTRUSTED_HOST_PATH");
});
it.each([0o775, 0o777, 0o1777])("rejects writable ancestors with mode %s", async mode => {
  const paths = base(); paths.set("/var", dir(0, mode));
  await expect(assertTrustedPath("/var/lib/wsx", opts, inspect(paths))).rejects.toThrow("UNTRUSTED_HOST_PATH");
});
it.each(["/var/lib/wsx", "/var", "/"])("rejects symlinks at %s", async path => {
  const paths = base(); paths.set(path, { ...dir(0, 0o700), isSymbolicLink: () => true });
  await expect(assertTrustedPath("/var/lib/wsx", opts, inspect(paths))).rejects.toThrow("UNTRUSTED_HOST_PATH");
});
it("permits an explicit service-owned leaf but never extends the exception to ancestors", async () => {
  const paths = base(); paths.set("/var/lib/wsx", dir(999, 0o700));
  await assertTrustedPath("/var/lib/wsx", { ...opts, allowedLeafUids: [999] }, inspect(paths));
  paths.set("/var/lib", dir(999, 0o700));
  await expect(assertTrustedPath("/var/lib/wsx", { ...opts, allowedLeafUids: [999] }, inspect(paths))).rejects.toThrow("UNTRUSTED_HOST_PATH");
});
it("requires exact private permissions and a real directory", async () => {
  const paths = base(); paths.set("/var/lib/wsx", dir(0, 0o750));
  await expect(assertTrustedPath("/var/lib/wsx", opts, inspect(paths))).rejects.toThrow("UNTRUSTED_HOST_PATH");
  paths.set("/var/lib/wsx", { ...dir(0, 0o700), isDirectory: () => false });
  await expect(assertTrustedPath("/var/lib/wsx", opts, inspect(paths))).rejects.toThrow("UNTRUSTED_HOST_PATH");
});
it("validates private files without allowing a service-owned secret", async () => {
  const paths = base(); paths.set("/var/lib/wsx", { ...dir(0, 0o600), isDirectory: () => false, isFile: () => true });
  await assertTrustedPath("/var/lib/wsx", { ...opts, kind: "file" }, inspect(paths));
  paths.set("/var/lib/wsx", { ...paths.get("/var/lib/wsx")!, uid: 999 });
  await expect(assertTrustedPath("/var/lib/wsx", { ...opts, kind: "file", allowedLeafUids: [999] }, inspect(paths))).rejects.toThrow("UNTRUSTED_HOST_PATH");
});
it.each(["relative", "/var/lib/../lib/wsx", "/var/lib/wsx/"])("rejects ambiguous path %s", async path => {
  await expect(assertTrustedPath(path, opts, inspect(base()))).rejects.toThrow("UNTRUSTED_HOST_PATH");
});
it("rejects paths outside the explicitly trusted root and fails closed on stat errors", async () => {
  await expect(assertTrustedPath("/other", { ...opts, trustedRoot: "/var" }, inspect(base()))).rejects.toThrow("UNTRUSTED_HOST_PATH");
  await expect(assertTrustedPath("/missing", opts, inspect(base()))).rejects.toThrow("UNTRUSTED_HOST_PATH");
});
