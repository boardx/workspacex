import JSON5 from "json5";
import { extractJson } from "./guided-structured-json";

/** Parse complete outline data only: no eval, extracted substring, missing-field
 * invention or truncated-output completion. Public/generated schema still validates
 * every parsed value. JSON5 tolerates quoting, comments and trailing commas without
 * an extra model call; malformed/incomplete documents remain errors. */
export function parseGeneratedOutlineJson(text: string): unknown {
  try { return extractJson(text); }
  catch (error) {
    if (!(error instanceof SyntaxError) || text.length > 24000) throw error;
    const trimmed = text.trim();
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    return JSON5.parse(fenced ? fenced[1]! : trimmed);
  }
}
