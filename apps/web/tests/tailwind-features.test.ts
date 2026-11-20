/** Compile the actual stylesheet configuration: TSX rendering alone misses absent utilities. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("emits the independent AIDT module's responsive panel, workspace shelf and dashboard utilities", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const directory = mkdtempSync(join(tmpdir(), "aidt-feature-css-"));
  try {
    const input = join(directory, "input.css"), output = join(directory, "output.css");
    writeFileSync(input, "@tailwind utilities;");
    const cli = createRequire(join(root, "package.json")).resolve("tailwindcss/lib/cli.js");
    execFileSync(process.execPath, [cli, "-c", "tailwind.config.ts", "-i", input, "-o", output, "--minify"], {
      cwd: root, stdio: ["ignore", "pipe", "pipe"], timeout: 30_000,
    });
    const css = readFileSync(output, "utf8");
    expect(css).toContain(".md\\:absolute{position:absolute}");
    expect(css).toContain(".md\\:max-w-md{max-width:28rem}");
    expect(css).toContain(".xl\\:w-\\[var\\(--aidt-shelf-width\\)\\]{width:var(--aidt-shelf-width)}");
    expect(css).toContain(".sm\\:min-h-40{min-height:10rem}");
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 40_000);
