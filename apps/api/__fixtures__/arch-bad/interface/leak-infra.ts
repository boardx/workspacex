// Counter-proof fixture: a controller importing a concrete implementation defeats DI.
import { db } from "../infrastructure/db";
export const w = db;
