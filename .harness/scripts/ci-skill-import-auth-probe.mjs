/** #5031: prove dedicated public GitHub authentication without exposing credentials. */
import https from 'node:https';
import { pathToFileURL } from 'node:url';

export function probeSkillImportAuthentication(env, request = https.get, emit = console.log) {
  const token = env.WORKSPACEX_SKILL_IMPORT_GITHUB_TOKEN?.trim();
  if (!token) {
    emit(JSON.stringify({ credentialPresent: false, skipped: true, authenticatedQuota: false, quotaAvailable: false }));
    return Promise.resolve(0); // Optional: do not break unrelated/fork CI or borrow a runner token.
  }
  return new Promise(resolve => {
    let finished = false;
    const finish = (result, code = 1) => {
      if (finished) return;
      finished = true;
      emit(JSON.stringify({ credentialPresent: true, authenticatedQuota: false, quotaAvailable: false, ...result }));
      resolve(code);
    };
    let req;
    try {
      req = request('https://api.github.com/rate_limit', {
        headers: { 'user-agent': 'workspacex-skill-import-ci-probe/1.0', accept: 'application/vnd.github+json', authorization: `Bearer ${token}` },
        timeout: 15_000,
      }, res => {
        const chunks = []; let size = 0; let ended = false;
        res.on('data', chunk => {
          size += chunk.length;
          if (size > 65_536) { finish({ responseRefused: true }); req?.destroy(); }
          else chunks.push(chunk);
        });
        res.on('aborted', () => finish({ responseAborted: true }));
        res.on('error', () => finish({ responseFailed: true }));
        res.on('close', () => { if (!ended) finish({ responseIncomplete: true }); });
        res.on('end', () => {
          ended = true;
          let core;
          try { core = JSON.parse(Buffer.concat(chunks).toString('utf8'))?.resources?.core; } catch {}
          const limit = Number.isSafeInteger(core?.limit) && core.limit > 60 ? core.limit : null;
          const remaining = Number.isSafeInteger(core?.remaining) && core.remaining >= 0 && limit !== null && core.remaining <= limit ? core.remaining : null;
          const authenticatedQuota = res.statusCode === 200 && limit !== null && remaining !== null;
          finish({ status: res.statusCode, limit, remaining, authenticatedQuota, quotaAvailable: authenticatedQuota && remaining > 0 }, authenticatedQuota ? 0 : 1);
        });
      });
      req.on('timeout', () => { finish({ requestTimedOut: true }); req.destroy(); });
      req.on('error', () => finish({ requestFailed: true }));
      req.on('close', () => finish({ requestIncomplete: true }));
    } catch { finish({ requestFailed: true }); }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = 1;
  probeSkillImportAuthentication(process.env).then(code => { process.exitCode = code; }).catch(() => {
    console.log(JSON.stringify({ authenticatedQuota: false, quotaAvailable: false, probeFailed: true }));
  });
}
