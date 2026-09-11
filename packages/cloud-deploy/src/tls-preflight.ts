import { X509Certificate, createPrivateKey } from "node:crypto";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import type { TLSSocket } from "node:tls";
import { z } from "zod";
import { resolveSecret } from "./secrets";

type Context = { signal: AbortSignal; remainingMs: () => number };
type Environment = { publicUrl: string; tlsSecretRef: string };
const tlsSecret = z.object({ certificatePem: z.string().min(1).max(65536), privateKeyPem: z.string().min(1).max(65536) }).strict();
const cancelled = () => new Error("TLS_PREFLIGHT_CANCELLED");
function active(context: Context) {
  if (context.signal.aborted || !Number.isFinite(context.remainingMs()) || context.remainingMs() <= 0) throw cancelled();
}

/** Read the already-issued leaf/fullchain and its private key from the declared secret.
 * No key is installed or transmitted. The public endpoint must present the exact configured
 * leaf, pass normal platform CA/hostname verification, and answer HTTPS without redirecting.
 * A 404 may precede application start; application readiness remains a separate stage.
 */
export async function verifyTlsPreflight(environment: Environment, context: Context,
  source: NodeJS.ProcessEnv = process.env, request: typeof httpsRequest = httpsRequest) {
  active(context);
  let url: URL;
  let certificate: X509Certificate;
  try {
    url = new URL(environment.publicUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error();
    const secret = tlsSecret.parse(JSON.parse(await resolveSecret(environment.tlsSecretRef, source, context)));
    const blocks = secret.certificatePem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
    if (!blocks?.length || secret.certificatePem.replace(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g, "").trim()) throw new Error();
    const certificates = blocks.map(pem => new X509Certificate(pem));
    certificate = certificates[0]!;
    const key = createPrivateKey(secret.privateKeyPem);
    if (!certificate.checkPrivateKey(key)) throw new Error("TLS_PRIVATE_KEY_MISMATCH");
  } catch (error) {
    active(context);
    if (error instanceof Error && error.message === "TLS_PRIVATE_KEY_MISMATCH") throw error;
    throw new Error("TLS_SECRET_INVALID");
  }
  active(context);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (!(isIP(hostname) ? certificate.checkIP(hostname) : certificate.checkHost(hostname, { subject: "never" }))) {
    throw new Error("TLS_HOSTNAME_MISMATCH");
  }
  const validFrom = Date.parse(certificate.validFrom), validTo = Date.parse(certificate.validTo);
  const current = () => Number.isFinite(validFrom) && Number.isFinite(validTo) && validFrom <= Date.now() && Date.now() < validTo;
  if (!current()) throw new Error("TLS_CERTIFICATE_NOT_CURRENT");
  const budget = Math.max(1, Math.min(5000, Math.floor(context.remainingMs())));
  const controller = new AbortController();
  const signal = AbortSignal.any([context.signal, controller.signal]);
  const timer = setTimeout(() => controller.abort(), budget);
  try {
    await new Promise<void>((resolve, reject) => {
      let matched = false;
      const req = request(url, { method: "HEAD", agent: false, rejectUnauthorized: true, signal }, response => {
        response.resume();
        if (!matched || !response.statusCode || response.statusCode < 200 || response.statusCode >= 500 ||
          (response.statusCode >= 300 && response.statusCode < 400)) {
          req.destroy(); reject(new Error("TLS_ENDPOINT_UNVERIFIED")); return;
        }
        req.destroy(); resolve();
      });
      req.once("socket", socket => {
        const tls = socket as TLSSocket;
        tls.once("secureConnect", () => {
          if (!tls.authorized) { req.destroy(new Error("TLS_ENDPOINT_UNVERIFIED")); return; }
          const peer = tls.getPeerCertificate();
          if (!peer.raw || !certificate.raw.equals(peer.raw)) {
            req.destroy(new Error("TLS_ENDPOINT_CERTIFICATE_MISMATCH")); return;
          }
          matched = true;
        });
      });
      req.once("error", error => {
        if (signal.aborted) reject(cancelled());
        else reject(new Error(error.message === "TLS_ENDPOINT_CERTIFICATE_MISMATCH" ? error.message : "TLS_ENDPOINT_UNVERIFIED"));
      });
      req.end();
    });
    active(context);
    if (!current()) throw new Error("TLS_CERTIFICATE_NOT_CURRENT");
    return { tlsVerified: true, hostnameMatched: true, privateKeyMatched: true, leafFingerprintSha256: certificate.fingerprint256,
      validTo: new Date(validTo).toISOString() } as const;
  } catch (error) {
    if (signal.aborted || context.signal.aborted || context.remainingMs() <= 0) throw cancelled();
    const code = error instanceof Error ? error.message : "";
    if (["TLS_ENDPOINT_CERTIFICATE_MISMATCH", "TLS_CERTIFICATE_NOT_CURRENT"].includes(code)) throw new Error(code);
    throw new Error("TLS_ENDPOINT_UNVERIFIED");
  } finally { clearTimeout(timer); }
}
