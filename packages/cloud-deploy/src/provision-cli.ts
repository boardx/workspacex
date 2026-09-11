import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { z } from "zod";
import { cloudProvisionOptionsSchema, provisionCloud } from "./cloud-provision";
import { assertTrustedPath } from "./trusted-path";

async function readJson(path: string): Promise<unknown> {
  await assertTrustedPath(path, { trustedRoot: "/", kind: "file" });
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 65536) throw new Error();
    const data = Buffer.alloc(65537); let size = 0;
    while (size < data.length) {
      const { bytesRead } = await file.read(data, size, data.length - size, null);
      if (!bytesRead) break; size += bytesRead;
    }
    if (size > 65536) throw new Error();
    return JSON.parse(data.subarray(0, size).toString("utf8"));
  } finally { await file.close(); }
}
const controller = new AbortController();
const cancel = () => controller.abort();
process.once("SIGINT", cancel); process.once("SIGTERM", cancel);
try {
  if (process.argv.length !== 3) throw new Error();
  const request = z.object({ configFile: z.string().startsWith("/"), releaseFile: z.string().startsWith("/"),
    options: cloudProvisionOptionsSchema }).strict().parse(await readJson(process.argv[2]!));
  const [config, release] = await Promise.all([readJson(request.configFile), readJson(request.releaseFile)]);
  const report = await provisionCloud(config, release, request.options, controller.signal);
  console.log(JSON.stringify(report));
  if (report.status !== "passed") process.exitCode = 1;
} catch {
  console.error(JSON.stringify({ ok: false, code: "PROVISION_CONFIGURATION_OR_EXECUTION_FAILED" })); process.exitCode = 1;
} finally { process.removeListener("SIGINT", cancel); process.removeListener("SIGTERM", cancel); }
