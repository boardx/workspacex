import { existsSync, statSync } from "node:fs";
import { extname, isAbsolute, normalize } from "node:path";

/** This new-org journey is independent of every historical supplemental attempt. Discovery writes nothing. */
export function assertFreshAidtJourney(requireAbsentStart = false): boolean {
  const marker = process.env.AIDT_V2_FRESH_JOURNEY;
  if (marker === undefined) return false;
  if (marker !== "fresh-native-seven-20261117") throw new Error("AIDT_FRESH_EXPLICIT_MARKER_REQUIRED");
  const old = Object.keys(process.env).find(key => key.startsWith("AIDT_V2_") && /SUPPLEMENT|UNSENT_S2|CANCELLED_S2|S2_CANONICAL|S2_REVIEWED|API_OWNER_/.test(key));
  if (old) throw new Error(`AIDT_FRESH_OLD_SUPPLEMENT_ENV_FORBIDDEN:${old}`);
  const paths = [process.env.AIDT_V2_RUN_LEDGER, process.env.AIDT_V2_COMPLETION_STATE];
  if (paths.some(path => !path || !isAbsolute(path) || extname(path) !== ".json")) throw new Error("AIDT_FRESH_DISTINCT_ABSOLUTE_JSON_REQUIRED");
  const [ledger, state] = paths.map(path => normalize(path!));
  if (ledger === state) throw new Error("AIDT_FRESH_DISTINCT_ABSOLUTE_JSON_REQUIRED");
  if (paths.some(path => existsSync(path!) && statSync(path!).isDirectory())) throw new Error("AIDT_FRESH_DISTINCT_ABSOLUTE_JSON_REQUIRED");
  // Existing paths include symlinks/hardlinks to old history: never overwrite or reuse them as a fresh S1 start.
  if (requireAbsentStart && paths.some(path => existsSync(path!))) throw new Error("AIDT_FRESH_INITIAL_STATE_AND_JOURNAL_MUST_NOT_EXIST");
  return true;
}
