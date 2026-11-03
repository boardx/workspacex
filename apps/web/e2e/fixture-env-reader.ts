/** Read the dump-fixture-env JSON-valued export protocol without evaluating shell code. */
export function readFixtureExports(output: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of output.split(/\r?\n/)) {
    const match = /^export ([A-Z0-9_]+)=(.+)$/.exec(line);
    if (!match) continue;
    const value: unknown = JSON.parse(match[2]!);
    if (typeof value !== "string" && typeof value !== "number") throw new Error(`Unsupported fixture export ${match[1]}`);
    values[match[1]!] = String(value);
  }
  return values;
}
