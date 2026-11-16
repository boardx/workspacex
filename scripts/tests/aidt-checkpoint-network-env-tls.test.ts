import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomInt, X509Certificate } from "node:crypto";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import https from "node:https";
import net from "node:net";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { test } from "node:test";
import { acquireTestPortLease, testPortLeaseDir } from "../../.harness/scripts/lib/test-port-lease.ts";
import { restoreOwnerEnvironment } from "../lib/aidt-checkpoint-network-env.mjs";

// Explicit interpreter, never a runtime/env/credential file. No dependency installation.
const python = process.env.AIDT_TLS_TEST_PYTHON;
const client = String.raw`
import json, ssl, sys
import httpx
url = httpx.URL(sys.argv[1])
assert url.scheme == 'https' and url.host == '127.0.0.1'
assert url.path == '/tls-regression' and not url.query
transport = httpx.HTTPTransport(verify=True, trust_env=True, retries=0)
context = transport._pool._ssl_context
assert context.verify_mode == ssl.CERT_REQUIRED and context.check_hostname
try:
    with httpx.Client(transport=transport, trust_env=True, timeout=3.0, follow_redirects=False) as session:
        response = session.head(str(url))
        result = {'status': response.status_code, 'bodyBytes': len(response.content), 'certificateValidationRequired': True}
except httpx.ConnectError as error:
    chain = []
    pending, visited = [error], set()
    while pending and len(chain) < 16:
        item = pending.pop()
        if id(item) in visited:
            continue
        visited.add(id(item))
        chain.append(type(item).__name__)
        pending.extend(nested for nested in (item.__cause__, item.__context__) if nested is not None)
    result = {'certificateValidationRequired': True, 'certificateVerificationFailed': 'SSLCertVerificationError' in chain, 'exceptionTypes': chain}
print(json.dumps(result))
`;

async function head(interpreter: string, url: string, env: NodeJS.ProcessEnv) {
  assert.equal(new URL(url).hostname, "127.0.0.1");
  // Pass only our synthetic allowlisted environment, never process.env/proxies/model credentials.
  const child = spawn(interpreter, ["-c", client, url], { env, stdio: ["ignore", "pipe", "pipe"], timeout: 7_000 });
  let output = "", error = "";
  child.stdout.on("data", chunk => { output += chunk; });
  child.stderr.on("data", chunk => { error += chunk; });
  const [code, signal] = await once(child, "exit");
  assert.equal(signal, null, "bounded Python client must exit normally");
  assert.equal(code, 0, `synthetic Python client failed: ${error}`);
  return JSON.parse(output) as { status?: number; bodyBytes?: number; certificateValidationRequired: boolean; certificateVerificationFailed?: boolean; exceptionTypes?: string[] };
}

test("real loopback TLS: omitted caller CA fails; inherited caller CA succeeds with verification on", { timeout: 45_000 }, async () => {
  assert.ok(python && isAbsolute(python) && existsSync(python), "set AIDT_TLS_TEST_PYTHON to an existing Python/httpx interpreter");
  const directory = mkdtempSync(join(tmpdir(), "aidt-loopback-tls-"));
  const caKey = join(directory, "ca.key"), ca = join(directory, "ca.pem"), key = join(directory, "server.key"), csr = join(directory, "server.csr"), cert = join(directory, "server.pem");
  const leaseRoot = testPortLeaseDir();
  let lease: ReturnType<typeof acquireTestPortLease> = null;
  let server: https.Server | undefined, port = 0;
  let oldResult: Awaited<ReturnType<typeof head>> | undefined, newResult: Awaited<ReturnType<typeof head>> | undefined;
  let headCount = 0, tlsErrors = 0, portRebindSucceeded = false, leaseReleased = false;
  const requests: { method: string | undefined; path: string | undefined; authorization: boolean; cookie: boolean; bodyBytes: number }[] = [];
  try {
    const openssl = (args: string[]) => execFileSync("openssl", args, { cwd: directory, timeout: 10_000, stdio: "ignore", env: { PATH: process.env.PATH, HOME: directory, LANG: "C.UTF-8" } });
    openssl(["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256", "-days", "1", "-subj", "/CN=AIDT temporary loopback CA", "-keyout", caKey, "-out", ca, "-addext", "basicConstraints=critical,CA:TRUE"]);
    openssl(["req", "-newkey", "rsa:2048", "-nodes", "-sha256", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1", "-keyout", key, "-out", csr]);
    openssl(["x509", "-req", "-in", csr, "-CA", ca, "-CAkey", caKey, "-CAcreateserial", "-out", cert, "-days", "1", "-sha256", "-copy_extensions", "copy"]);
    for (let candidate = 0; candidate < 32; candidate++) {
      port = randomInt(20_000, 60_000);
      lease = acquireTestPortLease(port, leaseRoot);
      if (!lease) continue;
      lease.markStarting();
      server = https.createServer({ key: readFileSync(key), cert: readFileSync(cert) }, (request, response) => {
        const observed = { method: request.method, path: request.url, authorization: Boolean(request.headers.authorization), cookie: Boolean(request.headers.cookie), bodyBytes: 0 };
        requests.push(observed);
        request.on("data", chunk => { observed.bodyBytes += chunk.length; });
        request.on("end", () => { headCount++; response.writeHead(200, { "content-length": "0" }); response.end(); });
      });
      server.on("tlsClientError", () => { tlsErrors++; });
      try {
        server.listen(port, "127.0.0.1"); await once(server, "listening"); break;
      } catch (error) {
        lease.release(true); lease = null; server = undefined;
        if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
      }
    }
    assert.ok(lease && server?.listening, "must acquire a real standard port lease before listening");
    assert.equal(acquireTestPortLease(port, leaseRoot), null, "a second owner cannot acquire the live leased port");
    const owner = JSON.parse(readFileSync(join(leaseRoot, String(port), readdirSync(join(leaseRoot, String(port)))[0]!), "utf8"));
    assert.equal(owner.pid, process.pid); assert.equal(owner.starting, true);
    const caller = { PATH: process.env.PATH!, HOME: directory, LANG: "C.UTF-8", TMPDIR: directory, SSL_CERT_FILE: ca };
    // Deliberately reproduce the old base-only launch shape; all values are temporary fixtures.
    const legacy = { PATH: caller.PATH, HOME: caller.HOME, LANG: caller.LANG, TMPDIR: caller.TMPDIR };
    const inherited = restoreOwnerEnvironment(caller, {});
    assert.equal(Object.hasOwn(legacy, "SSL_CERT_FILE"), false); assert.equal(inherited.SSL_CERT_FILE, ca);
    for (const env of [legacy, inherited]) assert.equal(Object.keys(env).some(name => /PROXY|MODEL|TOKEN|SECRET|PASSWORD|API_KEY/i.test(name) && name !== "NO_PROXY"), false);
    const url = `https://127.0.0.1:${port}/tls-regression`;
    oldResult = await head(python, url, legacy);
    assert.equal(oldResult.certificateValidationRequired, true); assert.equal(oldResult.certificateVerificationFailed, true);
    assert.equal(oldResult.status, undefined); assert.equal(headCount, 0, "untrusted TLS must fail before any HTTP HEAD");
    newResult = await head(python, url, inherited);
    assert.deepEqual(newResult, { status: 200, bodyBytes: 0, certificateValidationRequired: true });
    assert.equal(headCount, 1); assert.deepEqual(requests, [{ method: "HEAD", path: "/tls-regression", authorization: false, cookie: false, bodyBytes: 0 }]);
    assert.ok(tlsErrors >= 1);
    console.info(JSON.stringify({ scope: "controlled-loopback-launch-environment-mechanism-only", historicalS2RootCauseProven: false, noExternalNetwork: true,
      modelRequests: 0, databaseAccess: false, standardPortLease: true, port, caSha256Fingerprint: new X509Certificate(readFileSync(ca)).fingerprint256,
      oldResult, newResult, headCount, requests, retries: 0, timeoutSeconds: 3 }));
  } finally {
    let listenerClosed = !server?.listening;
    try {
      if (server?.listening) {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
        listenerClosed = true;
        const probe = net.createServer();
        try {
          probe.listen(port, "127.0.0.1"); await once(probe, "listening"); portRebindSucceeded = true;
        } finally {
          if (probe.listening) await new Promise<void>((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
        }
      }
    } finally {
      // An unconfirmed listener teardown retains the standard quarantine; never release a potentially live port.
      lease?.release(listenerClosed);
      leaseReleased = !existsSync(join(leaseRoot, String(port)));
      rmSync(directory, { recursive: true, force: true });
      console.info(JSON.stringify({ cleanup: true, portRebindSucceeded, leaseReleased, temporaryPrivateKeysRemoved: !existsSync(directory) }));
    }
    assert.equal(existsSync(directory), false); assert.equal(leaseReleased, true);
    if (newResult?.status === 200) assert.equal(portRebindSucceeded, true);
  }
});
