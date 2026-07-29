// Counter-proof fixture: the use-case layer depends on ports it defines, not on implementations.
import { db } from "../infrastructure/db";
export const z = db;
