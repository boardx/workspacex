import { writeFile } from "node:fs/promises";
import { createCloudNginxConfig } from "./nginx.js";

async function main() {
  const [domain, certificateFile, certificateKeyFile, output, ...extra] = process.argv.slice(2);
  if (!domain || !certificateFile || !certificateKeyFile || !output || extra.length) {
    throw new Error("USAGE: nginx-cli.ts domain certificateFile certificateKeyFile output.conf");
  }
  const config = createCloudNginxConfig({ domain, certificateFile, certificateKeyFile });
  await writeFile(output, config, { flag: "wx", mode: 0o600 });
  process.stdout.write("Nginx configuration generated; validate with nginx -t before activation.\n");
}
main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : "NGINX_GENERATION_FAILED"}\n`);
  process.exitCode = 1;
});
