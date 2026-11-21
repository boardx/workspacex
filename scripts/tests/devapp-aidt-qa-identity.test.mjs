import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bootstrapOrdinaryQaIdentity, QaIdentityError } from '../../apps/web/e2e/support/devapp-aidt-qa-identity.mjs';
const ORIGIN = 'https://devapp.boardx.us';
const adminCredentials = { email: 'synthetic-admin@example.invalid', password: 'DUMMY_ADMIN_SECRET_NOT_REAL' };
const linkId = 'oil-' + 'a'.repeat(24), linkToken = 'DUMMY_LINK_SECRET_NOT_REAL_123456789';
const adminToken = 'DUMMY_ADMIN_BEARER_NOT_REAL_123456789', qaToken = 'DUMMY_QA_BEARER_NOT_REAL_123456789';
const session = (userId, sessionToken, orgs = ['org-qa']) => ({ userId, sessionToken, orgs, expiresAt: '2999-01-01T00:00:00.000Z' });
function fixture(change = () => undefined) {
  const calls = [], contexts = [], receipts = [], secrets = [];
  const options = { origin: ORIGIN, adminCredentials, onReceipt: value => receipts.push(value), onSecret: value => secrets.push(value),
    createContext: async config => {
      const index = contexts.length;
      const context = { config, disposed: false, dispose: async () => { context.disposed = true; } };
      const request = async (method, url, requestOptions) => {
        const path = new URL(url).pathname, entry = { method, url, path, options: requestOptions, context: index };
        calls.push(entry);
        let body;
        if (path === '/api/auth/login') body = session('admin-owned', adminToken, ['org-local-owned', 'org-qa']);
        else if (path === '/api/identity/me') body = { org: { id: 'org-qa', kind: 'organization' }, orgRole: index === 0 ? 'admin' : 'consultant' };
        else if (path === '/api/organizations/org-qa/invite-links') body = { linkId, status: 'active', linkToken, expiresAt: '2999-01-01T00:00:00.000Z' };
        else if (path === '/api/org-invites/activate-via-link') body = { userId: 'qa-new', orgId: 'org-qa', orgRole: 'consultant', teamId: '', sessionId: 'DUMMY_QA_SESSION_ID_123456789', session: session('qa-new', qaToken) };
        else if (path === `/api/organizations/org-qa/invite-links/${linkId}/revoke`) body = { status: 'revoked' };
        else assert.fail('unexpected route');
        const row = { status: 200, body, entry };
        await change(row);
        return { status: () => row.status, body: async () => row.bytes ?? Buffer.from(JSON.stringify(row.body)), dispose: async () => {} };
      };
      context.get = (url, opts) => request('GET', url, opts); context.post = (url, opts) => request('POST', url, opts);
      contexts.push(context); return context;
    } };
  return { options, calls, contexts, receipts, secrets };
}
async function failed(f, code) {
  let caught;
  await assert.rejects(bootstrapOrdinaryQaIdentity(f.options), error => { caught = error; return error instanceof QaIdentityError && error.code === code; });
  assert.ok(f.contexts.every(context => context.disposed));
  assert.equal(caught.receipt.status, 'failed');
  assert.equal(caught.receipt.failureCode, code);
  for (const count of Object.values(caught.receipt.counts)) assert.ok(count === 0 || count === 1);
  const publicText = JSON.stringify({ error: String(caught), receipt: caught.receipt, receipts: f.receipts });
  for (const secret of f.secrets) assert.equal(publicText.includes(secret), false, 'public failure must not contain secrets');
  return caught;
}
test('creates exactly one ordinary QA via scoped real API shapes, revokes own link, and disposes both contexts', async () => {
  const f = fixture(), result = await bootstrapOrdinaryQaIdentity(f.options);
  assert.deepEqual(result.identity, { userId: 'qa-new', adminUserId: 'admin-owned', orgId: 'org-qa' });
  assert.equal(result.receipt.status, 'succeeded'); assert.equal(result.receipt.linkRevoked, true);
  assert.equal(result.receipt.mailboxOwnershipVerified, false);
  assert.equal(result.receipt.activationOutcome, 'accepted');
  assert.deepEqual(result.receipt.counts, { adminLogins: 1, adminIdentityReads: 1, linkCreates: 1, activations: 1, qaIdentityReads: 1, linkRevokes: 1 });
  assert.match(result.credentials.email, /^aidt-qa-[a-f0-9]{32}@example\.invalid$/);
  assert.match(result.credentials.password, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(f.calls.map(row => [row.context, row.method, row.path]), [
    [0, 'POST', '/api/auth/login'], [0, 'GET', '/api/identity/me'], [0, 'POST', '/api/organizations/org-qa/invite-links'],
    [1, 'POST', '/api/org-invites/activate-via-link'], [1, 'GET', '/api/identity/me'], [0, 'POST', `/api/organizations/org-qa/invite-links/${linkId}/revoke`],
  ]);
  assert.deepEqual(f.calls[2].options.data, { orgId: 'org-qa', orgRole: 'consultant', expiry: '1d', maxUses: 1 });
  assert.deepEqual(f.calls[3].options.data, { token: linkToken, email: result.credentials.email, profile: { name: 'AIDT 专用合成验收成员', password: result.credentials.password } });
  assert.equal(f.calls[3].options.headers.authorization, undefined);
  assert.equal(f.calls[4].options.headers.authorization, `Bearer ${qaToken}`);
  assert.deepEqual(f.calls[5].options.data, { orgId: 'org-qa', linkId });
  for (const call of f.calls) assert.deepEqual([call.options.maxRedirects, call.options.maxRetries, call.options.timeout], [0, 0, 15000]);
  assert.ok(f.contexts.every(context => context.disposed && context.config.ignoreHTTPSErrors === false));
  assert.deepEqual(Object.keys(result), ['receipt']);
  for (const value of f.secrets) assert.equal(JSON.stringify(result).includes(value), false);
  for (const value of [adminCredentials.password, adminToken, linkToken, qaToken, result.credentials.password, result.credentials.email]) assert.ok(f.secrets.includes(value));
});
for (const origin of ['http://devapp.boardx.us', 'https://devapp.boardx.us:444', 'https://evil.invalid', 'https://devapp.boardx.us/extra', 'https://a:b@devapp.boardx.us']) test(`rejects noncanonical target ${origin}`, async () => {
  const f = fixture(); f.options.origin = origin; await failed(f, 'QA_IDENTITY_INPUT_INVALID'); assert.equal(f.calls.length, 0);
});
test('rejects malformed credentials and never opens a context', async () => {
  const f = fixture(); f.options.adminCredentials = { ...adminCredentials, orgRole: 'admin' };
  await failed(f, 'QA_IDENTITY_INPUT_INVALID'); assert.equal(f.contexts.length, 0);
});
for (const mutate of [body => { body.orgRole = 'consultant'; }, body => { body.org.id = 'foreign'; }, body => { body.org.kind = 'personal-local'; }]) test('checks actual same-organization admin before any invitation write', async () => {
  const f = fixture(row => { if (row.entry.path === '/api/identity/me' && row.entry.context === 0) mutate(row.body); });
  await failed(f, 'QA_IDENTITY_ADMIN_REQUIRED'); assert.equal(f.calls.length, 2);
});
test('uses actual default organization rule rather than the first unsorted membership', async () => {
  const f = fixture(); await bootstrapOrdinaryQaIdentity(f.options);
  assert.equal(new URL(f.calls[1].url).search, '?orgId=org-qa');
});
test('HTTP redirects do not follow and never create a link', async () => {
  const f = fixture(row => { row.status = 302; }); await failed(f, 'QA_IDENTITY_REDIRECT_REJECTED'); assert.equal(f.calls.length, 1);
});
test('unknown create outcome never retries or guesses a link to revoke', async () => {
  const f = fixture(row => { if (row.entry.path.endsWith('/invite-links')) throw new Error('RAW_SECRET_PROVIDER_FAILURE'); });
  const e = await failed(f, 'QA_IDENTITY_TRANSPORT_UNKNOWN'); assert.equal(e.receipt.counts.linkCreates, 1); assert.equal(e.receipt.counts.linkRevokes, 0);
});
test('malformed successful create with observed owned link still cleans up exactly that link', async () => {
  const f = fixture(row => { if (row.entry.path.endsWith('/invite-links')) row.body.extra = 'invalid'; });
  const e = await failed(f, 'QA_IDENTITY_RESPONSE_INVALID'); assert.equal(e.receipt.counts.activations, 0); assert.equal(e.receipt.linkRevoked, true);
});
test('normal quota failure stops activation and revokes the known own link once', async () => {
  const f = fixture(row => { if (row.entry.path.endsWith('/activate-via-link')) { row.status = 400; row.body = { reasonCode: 'QUOTA_EXHAUSTED', private: 'DO_NOT_REPORT' }; } });
  const e = await failed(f, 'QA_IDENTITY_HTTP_FAILED'); assert.equal(e.receipt.linkRevoked, true); assert.equal(e.receipt.counts.activations, 1);
  assert.equal(e.receipt.httpStatus, 400); assert.equal(e.receipt.reasonCode, 'QUOTA_EXHAUSTED');
});
test('unknown activation outcome never retries and still revokes the known one-use link', async () => {
  const f = fixture(row => { if (row.entry.path.endsWith('/activate-via-link')) throw new Error('RAW_SECRET_FROM_REMOTE'); });
  const e = await failed(f, 'QA_IDENTITY_TRANSPORT_UNKNOWN'); assert.equal(e.receipt.linkRevoked, true); assert.equal(e.receipt.counts.activations, 1);
  assert.equal(e.receipt.activationOutcome, 'unknown');
});
for (const mutate of [body => { body.userId = 'admin-owned'; }, body => { body.orgId = 'foreign'; }, body => { body.orgRole = 'admin'; }, body => { body.session.userId = 'foreign'; }, body => { body.teamId = 'unexpected'; }]) test('refuses mismatched activation identity without continuing into QA', async () => {
  const f = fixture(row => { if (row.entry.path.endsWith('/activate-via-link')) mutate(row.body); });
  const e = await failed(f, 'QA_IDENTITY_ACTIVATION_MISMATCH'); assert.equal(e.receipt.linkRevoked, true); assert.equal(e.receipt.counts.qaIdentityReads, 0);
});
test('requires independently read consultant role after activation', async () => {
  const f = fixture(row => { if (row.entry.path === '/api/identity/me' && row.entry.context === 1) row.body.orgRole = 'admin'; });
  const e = await failed(f, 'QA_IDENTITY_CONSULTANT_REQUIRED'); assert.equal(e.receipt.linkRevoked, true);
});
test('failed revoke never retries, never returns usable credentials, and retains safe failure', async () => {
  const f = fixture(row => { if (row.entry.path.endsWith('/revoke')) throw new Error('RAW_REVOKE_SECRET'); });
  const e = await failed(f, 'QA_IDENTITY_TRANSPORT_UNKNOWN'); assert.equal(e.receipt.counts.linkRevokes, 1); assert.equal(e.receipt.linkRevoked, false);
});
test('secret callback failure after own-link response still revokes without repeating create', async () => {
  const f = fixture(); f.options.onSecret = value => { f.secrets.push(value); if (value === linkToken) throw new Error('CALLBACK_RAW'); };
  const e = await failed(f, 'QA_IDENTITY_CALLBACK_FAILED'); assert.equal(e.receipt.linkRevoked, true); assert.equal(e.receipt.counts.linkCreates, 1);
});
test('receipt callback failure cannot suppress exact known-link cleanup', async () => {
  const f = fixture(); f.options.onReceipt = value => { f.receipts.push(value); if (value.phase === 'activate' || value.phase === 'revoke') throw new Error('RAW_CALLBACK'); };
  const e = await failed(f, 'QA_IDENTITY_CALLBACK_FAILED'); assert.equal(e.receipt.linkRevoked, true); assert.equal(e.receipt.counts.activations, 1);
  assert.equal(f.calls.some(row => row.path.endsWith('/activate-via-link')), false);
});
test('module contains no filesystem, database, role mutation or remote configuration escape', () => {
  const source = readFileSync(new URL('../../apps/web/e2e/support/devapp-aidt-qa-identity.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /node:fs|node:child_process|console\.|process\.env|storageState\s*:|\.query\(|\/password-reset|\/members\/|tool_permission_grants/);
});
