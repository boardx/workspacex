// Counter-proof fixture: business code parked at the root, in no layer at all.
// Without the composition-root allowlist this file would silently escape the gate --
// "put it in a directory with no layer name" must not be a way around layering.
import { db } from "./infrastructure/db";
export const escaped = db;
