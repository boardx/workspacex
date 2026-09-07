import { posix } from "node:path";

/** Virtual paths only. This check does not isolate an executed process. */
export function validateSessionPath(path: string, writable = false): string {
  if (typeof path !== "string" || path.includes("\0") || path.includes("\\") ||
      path.split("/").some((part) => part === ".." || part === ".")) {
    throw new Error("INVALID_SESSION_PATH");
  }
  const normalized = posix.normalize(path);
  if (path !== normalized || !["/workspace", "/skills", "/inputs"].some(
    (root) => path === root || path.startsWith(`${root}/`),
  )) throw new Error("INVALID_SESSION_PATH");
  if (writable && !(path === "/workspace" || path.startsWith("/workspace/"))) {
    throw new Error("SESSION_PATH_READ_ONLY");
  }
  return normalized;
}
