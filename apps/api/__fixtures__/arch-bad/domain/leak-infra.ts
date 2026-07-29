// Counter-proof fixture: domain must not know the database exists.
import { db } from "../infrastructure/db";
export const y = db;
