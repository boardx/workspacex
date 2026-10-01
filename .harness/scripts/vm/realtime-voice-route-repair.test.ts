import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const temps: string[] = [];
afterEach(() => { for (const p of temps.splice(0)) rmSync(p, { recursive: true, force: true }); });

// Execute the real shell helper in a disposable /etc/caddy substitute; only privileged
// commands are doubles. The rendered candidate, replacement and rollback are real files.
function fixture(routes: string[], options: { invalid?: boolean; reloadFails?: boolean; anchor?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "voice-route-"));
  temps.push(dir);
  const live = join(dir, "Caddyfile");
  const helper = join(dir, "helper.sh");
  const log = join(dir, "commands");
  const blocks = routes.map((p) => `\thandle ${p} {\n\t\treverse_proxy 127.0.0.1:3200\n\t}`).join("\n");
  const before = `example.test {\n${blocks}\n${options.anchor === false ? "" : "\thandle /kernel/probe/* {\n\t\trespond 404\n\t}\n"}\thandle {\n\t\treverse_proxy 127.0.0.1:3100\n\t}\n}\n`;
  writeFileSync(live, before);
  writeFileSync(helper, readFileSync(new URL("./deploy-readiness.sh", import.meta.url), "utf8").replaceAll("/etc/caddy", dir));
  writeFileSync(log, "");
  for (const [name, body] of Object.entries({
    chmod: "exit 0", chown: "exit 0",
    caddy: `printf 'validate\\n' >> '${log}'\nexit ${options.invalid ? 1 : 0}`,
    systemctl: `printf 'systemctl %s\\n' "$*" >> '${log}'\nexit ${options.reloadFails ? 1 : 0}`,
  })) {
    const p = join(dir, name);
    writeFileSync(p, `#!/bin/sh\n${body}\n`); chmodSync(p, 0o755);
  }
  const run = () => spawnSync("bash", ["-c", 'set -euo pipefail; source "$1"; ensure_reviewed_websocket_caddy_routes "$2" "$3"', "--", helper, live, "3200"], { encoding: "utf8", env: { ...process.env, PATH: `${dir}:${process.env.PATH}` } });
  return { run, before, text: () => readFileSync(live, "utf8"), commands: () => readFileSync(log, "utf8") };
}

describe("reviewed realtime voice route repair", () => {
  it("repairs missing voice on an existing Board deployment; a second run makes no change", () => {
    const f = fixture(["/whiteboards/*/sync", "/chat/asr-draft"]);
    expect(f.run().status).toBe(0);
    const repaired = f.text();
    expect(repaired).toContain("handle /chat/realtime-digital-human {\n\t\treverse_proxy 127.0.0.1:3200");
    expect(repaired.indexOf("handle /chat/realtime-digital-human")).toBeLessThan(repaired.indexOf("handle /kernel/probe/*"));
    expect(repaired.match(/handle \/whiteboards\/\*\/sync/g)).toHaveLength(1);
    expect(repaired).toContain("handle /chat/asr-draft");
    const commands = f.commands();
    expect(f.run().status).toBe(0);
    expect(f.text()).toBe(repaired);
    expect(f.commands()).toBe(commands);
  });
  it("repairs both reviewed routes on older deployments", () => {
    const f = fixture([]);
    expect(f.run().status).toBe(0);
    expect(f.text()).toContain("handle /whiteboards/*/sync");
    expect(f.text()).toContain("handle /chat/realtime-digital-human");
  });
  it("leaves live config unchanged when candidate validation fails", () => {
    const f = fixture(["/whiteboards/*/sync"], { invalid: true });
    expect(f.run().status).toBe(1);
    expect(f.text()).toBe(f.before);
    expect(f.commands()).not.toContain("systemctl");
  });
  it("restores previous config when reload and restart fail", () => {
    const f = fixture(["/whiteboards/*/sync"], { reloadFails: true });
    expect(f.run().status).toBe(1);
    expect(f.text()).toBe(f.before);
    expect(f.commands()).toContain("systemctl reload caddy");
  });
  it("refuses an ambiguous insertion point without changing config", () => {
    const f = fixture([], { anchor: false });
    expect(f.run().status).toBe(1);
    expect(f.text()).toBe(f.before);
    expect(f.commands()).toBe("");
  });
});
