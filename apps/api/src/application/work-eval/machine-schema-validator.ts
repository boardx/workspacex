import Ajv from "ajv";
import { z } from "zod";

/** Evaluation must never count ignored keywords/formats as implemented constraints.
 * strictTypes is disabled for valid conditional schemas whose type is defined in an outer branch.
 * Unsupported formats fail closed until an actual validator is registered here.
 */
export function newWorkSkillSchemaValidator(): Ajv {
  const ajv = new Ajv({ strict: false, strictSchema: true, allErrors: true });
  const dateTime = z.string().datetime({ offset: true });
  ajv.addFormat("date-time", { type: "string", validate: (value: string) => dateTime.safeParse(value).success });
  return ajv;
}
