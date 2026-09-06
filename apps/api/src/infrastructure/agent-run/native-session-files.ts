import { request } from "node:http";
import { sandboxSession as S } from "@repo/contracts";
import type { BoundSessionFiles } from "../../application/agent-run/collect-native-outputs";

/** Bound by trusted service composition, never by a tool invocation. */
export function createNativeSessionFiles(config: {
  socketPath: string; sessionId: string; token: string; timeoutMs?: number;
}): BoundSessionFiles {
  // Validate fields separately: configuration contains transport-only fields.
  const credentials = S.schemas.created.safeParse({ sessionId: config.sessionId, token: config.token, expiresAt: 0 });
  const timeoutMs = config.timeoutMs ?? S.limits.defaultTimeoutMs;
  if (!credentials.success || !config.socketPath.startsWith("/") || config.socketPath.includes("\0")
    || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > S.limits.maxTimeoutMs) {
    throw new Error("native_session_configuration_invalid");
  }
  const { socketPath, sessionId, token } = config;
  return {
    async read(path: string): Promise<unknown> {
      if (!S.schemas.read.safeParse({ path }).success) throw new Error("native_session_path_invalid");
      return new Promise((resolve, reject) => {
        const fail = () => reject(new Error("native_session_read_failed"));
        const req = request({ socketPath, method: "GET",
          path: `/sessions/${sessionId}/files?path=${encodeURIComponent(path)}`,
          headers: { Authorization: `Bearer ${token}` },
        }, res => {
          if (res.statusCode !== 200) { res.destroy(); fail(); return; }
          const chunks: Buffer[] = []; let size = 0;
          res.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > S.limits.maxRequestBytes) { res.destroy(); req.destroy(); fail(); return; }
            chunks.push(chunk);
          });
          res.on("error", fail);
          res.on("aborted", fail);
          res.on("end", () => {
            try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
            catch { fail(); }
          });
        });
        // A wall-clock deadline also bounds a server trickling response bytes.
        const timer = setTimeout(() => { req.destroy(); fail(); }, timeoutMs);
        req.on("close", () => clearTimeout(timer));
        req.on("error", fail);
        req.end();
      });
    },
  };
}
