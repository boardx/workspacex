import { lstat, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { assertTrustedPath } from "./trusted-path";
import { ensureDeploymentSecret, assertSecretOperationActive, type SecretOperationContext } from "./secrets";

/** Root-only deployment wrapper; generic secret utilities remain usable by local tools. */
export async function ensureTrustedDeploymentSecret(directory: string, name: string, context: SecretOperationContext = {}): Promise<string> {
  assertSecretOperationActive(context);
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(name)) throw new Error("INVALID_SECRET_NAME");
  await assertTrustedPath(dirname(directory), { trustedRoot: "/", kind: "directory" });
  try { await mkdir(directory, { mode: 0o700 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  const verifyDirectory = () => assertTrustedPath(directory, { trustedRoot: "/", kind: "directory", private: true });
  const path = join(directory, name);
  const verifyKey = () => assertTrustedPath(path, { trustedRoot: "/", kind: "file", private: true });
  await verifyDirectory();
  try { await lstat(path); await verifyKey(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  assertSecretOperationActive(context);
  const value = await ensureDeploymentSecret(directory, name, context);
  await verifyDirectory(); await verifyKey();
  assertSecretOperationActive(context);
  return value;
}
