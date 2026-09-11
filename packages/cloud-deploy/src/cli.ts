import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { deploymentExample, validateDeploymentConfig } from "./index";

const write = (value: unknown) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
const fail = (code: string) => { write({ ok: false, errors: [{ path: "$", code }] }); process.exitCode = 2; };
const args = process.argv.slice(2);
const [command, value] = args;

if (args.length !== 2 || !["validate", "example"].includes(command ?? "")) {
  fail("USAGE: validate <file.json> | example starter|production");
} else if (command === "example") {
  if (value !== "starter" && value !== "production") fail("INVALID_PROFILE");
  else write(deploymentExample(value));
} else if (!value) {
  fail("CONFIG_PATH_REQUIRED");
} else {
  // Bound the input before parsing and do not log filesystem errors or JSON fragments.
  const file = await open(value, constants.O_RDONLY | constants.O_NONBLOCK).catch(() => null);
  if (!file) fail("CONFIG_READ_FAILED");
  else {
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > 65_536) fail("CONFIG_FILE_INVALID_OR_TOO_LARGE");
      else {
        const buffer = Buffer.alloc(65_537);
        let total = 0;
        while (total < buffer.length) {
          const { bytesRead } = await file.read(buffer, total, buffer.length - total, null);
          if (bytesRead === 0) break;
          total += bytesRead;
        }
        if (total > 65_536) fail("CONFIG_FILE_INVALID_OR_TOO_LARGE");
        else {
          let input: unknown;
          try { input = JSON.parse(buffer.subarray(0, total).toString("utf8")); }
          catch { fail("CONFIG_JSON_INVALID"); }
          if (!process.exitCode) {
            const result = validateDeploymentConfig(input);
            if (result.ok) write({ ok: true, plan: result.plan });
            else { write(result); process.exitCode = 2; }
          }
        }
      }
    } catch { fail("CONFIG_READ_FAILED"); }
    finally { await file.close(); }
  }
}
