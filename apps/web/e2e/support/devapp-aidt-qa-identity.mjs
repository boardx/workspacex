/** One bounded normal invitation lifecycle. Credentials stay in this process, never a fixture file. */
import { randomBytes } from 'node:crypto';
import { ORIGIN, ProbeFailure } from './devapp-aidt-auth-readonly.mjs';

function validReusableQaCredentialPair(email, password) {
  return typeof email === 'string' && /^aidt-qa-[a-f0-9]{32}@example\.invalid$/.test(email)
    && typeof password === 'string' && /^[A-Za-z0-9_-]{43}$/.test(password);
}

export function reusableQaRequested(env) {
  const choice = env.AIDT_REUSABLE_ORDINARY_QA;
  if (choice !== undefined && !['true', 'false'].includes(choice)) throw new ProbeFailure('QA_IDENTITY_OPT_IN_INVALID');
  if (choice === 'true' && env.AIDT_LIVE_DEV !== 'true') throw new ProbeFailure('QA_IDENTITY_OPT_IN_SCOPE_INVALID');
  return choice === 'true';
}

export function consumeReusableQaCredentials(env) {
  const email = env.AIDT_REUSABLE_QA_EMAIL;
  const password = env.AIDT_REUSABLE_QA_PASSWORD;
  delete env.AIDT_REUSABLE_QA_EMAIL;
  delete env.AIDT_REUSABLE_QA_PASSWORD;
  if (!reusableQaRequested(env)) return null;
  if (!validReusableQaCredentialPair(email, password)) throw new ProbeFailure('QA_REUSABLE_CREDENTIALS_UNAVAILABLE');
  return { email, password };
}

export const QA_IDENTITY_CODES = Object.freeze([
  'QA_IDENTITY_INPUT_INVALID', 'QA_IDENTITY_CONTEXT_FAILED', 'QA_IDENTITY_TRANSPORT_UNKNOWN',
  'QA_IDENTITY_REDIRECT_REJECTED', 'QA_IDENTITY_RESPONSE_INVALID', 'QA_IDENTITY_HTTP_FAILED',
  'QA_IDENTITY_ADMIN_REQUIRED', 'QA_IDENTITY_ACTIVATION_MISMATCH', 'QA_IDENTITY_CONSULTANT_REQUIRED',
  'QA_IDENTITY_REVOKE_FAILED', 'QA_IDENTITY_DISPOSE_FAILED', 'QA_IDENTITY_CALLBACK_FAILED',
]);
const REASONS = new Set(['INVALID_CREDENTIAL', 'ACCOUNT_LOCKED', 'EMAIL_NOT_VERIFIED', 'AUTH_SERVICE_UNAVAILABLE',
  'NO_ORG_MEMBERSHIP', 'PROJECT_ROLE_INSUFFICIENT', 'INVITE_NOT_FOUND', 'INVITE_ALREADY_MEMBER', 'QUOTA_EXHAUSTED']);
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/.test(value);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const keys = (value, expected) => object(value) && Object.keys(value).sort().join(',') === [...expected].sort().join(',');
const token = value => typeof value === 'string' && value.length >= 20 && value.length <= 8192;
const copy = value => JSON.parse(JSON.stringify(value));
const sessionValid = value => keys(value, ['userId', 'orgs', 'sessionToken', 'expiresAt']) && id(value.userId)
  && Array.isArray(value.orgs) && value.orgs.length > 0 && value.orgs.length <= 100 && value.orgs.every(id)
  && new Set(value.orgs).size === value.orgs.length && token(value.sessionToken) && Number.isFinite(Date.parse(value.expiresAt)) && Date.parse(value.expiresAt) > Date.now();
// Mirrors the actual session default: non-local org first, then smallest ID; never switch organizations.
const defaultOrg = orgs => [...orgs].sort().find(value => !value.startsWith('org-local-')) ?? [...orgs].sort()[0];

export class QaIdentityError extends ProbeFailure {
  constructor(code, receipt) { super(code); this.receipt = copy(receipt); }
}

/** createContext must create a fresh Playwright APIRequestContext, without tracing or storageState. */
export async function bootstrapOrdinaryQaIdentity({ origin, adminCredentials, reusableCredentials, createContext, onReceipt = () => {}, onSecret = () => {} }) {
  const receipt = { schemaVersion: 1, kind: 'devapp-aidt-ordinary-qa-bootstrap', authority: 'normal-organization-shared-invitation',
    mailboxOwnershipVerified: false, status: 'running', phase: 'preflight', adminVerified: false, accountAccepted: false, activationOutcome: 'not-attempted',
    consultantVerified: false, linkKnown: false, linkRevoked: false, contextsDisposed: false,
    counts: { adminLogins: 0, adminIdentityReads: 0, linkCreates: 0, activations: 0, qaIdentityReads: 0, linkRevokes: 0 },
    failureCode: null, httpStatus: null, reasonCode: null };
  let adminContext, activationContext, adminToken, adminUserId, orgId, linkId, credentials, identity, failure, failedHttp;
  const error = code => { throw new QaIdentityError(code, receipt); };
  const emit = () => { try { onReceipt(copy(receipt)); } catch { error('QA_IDENTITY_CALLBACK_FAILED'); } };
  const secret = value => { if (typeof value === 'string' && value) try { onSecret(value); } catch { error('QA_IDENTITY_CALLBACK_FAILED'); } };
  const noteResponseSecrets = body => {
    if (!object(body)) return;
    for (const value of [body.sessionToken, body.linkToken, body.sessionId, body.session?.sessionToken]) secret(value);
  };
  async function call(context, phase, counter, path, body, bearer) {
    if (receipt.counts[counter] !== 0) error('QA_IDENTITY_INPUT_INVALID');
    receipt.phase = phase; receipt.counts[counter]++;
    try { emit(); } catch (cause) { if (phase !== 'revoke') throw cause; }
    let response;
    try {
      const options = { maxRedirects: 0, maxRetries: 0, timeout: 15000, failOnStatusCode: false,
        headers: { accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
        ...(body === undefined ? {} : { data: body }) };
      response = await context[body === undefined ? 'get' : 'post'](ORIGIN + path, options);
      const status = response.status(); receipt.httpStatus = status;
      if (status >= 300 && status < 400) error('QA_IDENTITY_REDIRECT_REJECTED');
      const bytes = await response.body();
      if (!Buffer.isBuffer(bytes) || bytes.length > 65536) error('QA_IDENTITY_RESPONSE_INVALID');
      let data; try { data = JSON.parse(bytes.toString('utf8')); } catch { error('QA_IDENTITY_RESPONSE_INVALID'); }
      if ((status === 200 || status === 201) && phase === 'invite-create' && object(data) && /^oil-[a-f0-9]{24}$/.test(data.linkId ?? '')) {
        linkId = data.linkId; receipt.linkKnown = true;
      }
      noteResponseSecrets(data);
      receipt.reasonCode = REASONS.has(data?.reasonCode) ? data.reasonCode : null;
      if (!(body === undefined ? status === 200 : status === 200 || status === 201)) error('QA_IDENTITY_HTTP_FAILED');
      return data;
    } catch (cause) {
      if (cause instanceof QaIdentityError) throw cause;
      error('QA_IDENTITY_TRANSPORT_UNKNOWN');
    } finally { if (response) try { await response.dispose(); } catch { /* No response body survives this call. */ } }
  }
  async function revoke() {
    if (!linkId || !adminContext || receipt.counts.linkRevokes) return;
    const result = await call(adminContext, 'revoke', 'linkRevokes',
      `/api/organizations/${encodeURIComponent(orgId)}/invite-links/${encodeURIComponent(linkId)}/revoke`, { orgId, linkId }, adminToken);
    if (!keys(result, ['status']) || result.status !== 'revoked') error('QA_IDENTITY_REVOKE_FAILED');
    receipt.linkRevoked = true; emit();
  }
  try {
    if (origin !== ORIGIN || !keys(adminCredentials, ['email', 'password']) || typeof adminCredentials.email !== 'string'
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminCredentials.email) || typeof adminCredentials.password !== 'string'
      || adminCredentials.password.length < 1 || adminCredentials.password.length > 1024 || typeof createContext !== 'function'
      || typeof onReceipt !== 'function' || typeof onSecret !== 'function') error('QA_IDENTITY_INPUT_INVALID');
    if (reusableCredentials !== undefined && (!keys(reusableCredentials, ['email', 'password'])
      || !validReusableQaCredentialPair(reusableCredentials.email, reusableCredentials.password)
      || reusableCredentials.email === adminCredentials.email || reusableCredentials.password === adminCredentials.password)) {
      error('QA_IDENTITY_INPUT_INVALID');
    }
    secret(adminCredentials.email); secret(adminCredentials.password);
    emit();
    try {
      adminContext = await createContext({ baseURL: ORIGIN, ignoreHTTPSErrors: false, timeout: 15000 });
      activationContext = await createContext({ baseURL: ORIGIN, ignoreHTTPSErrors: false, timeout: 15000 });
      if (!adminContext || !activationContext || adminContext === activationContext) error('QA_IDENTITY_CONTEXT_FAILED');
    } catch (cause) { if (cause instanceof QaIdentityError) throw cause; error('QA_IDENTITY_CONTEXT_FAILED'); }
    const login = await call(adminContext, 'admin-login', 'adminLogins', '/api/auth/login', { email: adminCredentials.email, password: adminCredentials.password });
    if (!sessionValid(login)) error('QA_IDENTITY_RESPONSE_INVALID');
    adminToken = login.sessionToken; adminUserId = login.userId; orgId = defaultOrg(login.orgs);
    const admin = await call(adminContext, 'admin-identity', 'adminIdentityReads', `/api/identity/me?orgId=${encodeURIComponent(orgId)}`, undefined, adminToken);
    if (!object(admin) || admin.orgRole !== 'admin' || admin.org?.id !== orgId || admin.org?.kind !== 'organization') error('QA_IDENTITY_ADMIN_REQUIRED');
    receipt.adminVerified = true;
    const invited = await call(adminContext, 'invite-create', 'linkCreates', `/api/organizations/${encodeURIComponent(orgId)}/invite-links`,
      { orgId, orgRole: 'consultant', expiry: '1d', maxUses: 1 }, adminToken);
    // Retain only the newly observed own-link ID, so malformed success still permits bounded cleanup.
    if (object(invited) && /^oil-[a-f0-9]{24}$/.test(invited.linkId ?? '')) { linkId = invited.linkId; receipt.linkKnown = true; }
    if (!keys(invited, ['linkId', 'status', 'linkToken', 'expiresAt']) || !linkId || invited.status !== 'active' || !token(invited.linkToken)
      || !Number.isFinite(Date.parse(invited.expiresAt)) || Date.parse(invited.expiresAt) <= Date.now()) error('QA_IDENTITY_RESPONSE_INVALID');
    credentials = reusableCredentials ?? { email: `aidt-qa-${randomBytes(16).toString('hex')}@example.invalid`,
      password: randomBytes(32).toString('base64url') };
    secret(credentials.email); secret(credentials.password);
    receipt.activationOutcome = 'unknown';
    const activated = await call(activationContext, 'activate', 'activations', '/api/org-invites/activate-via-link',
      { token: invited.linkToken, email: credentials.email, profile: { name: 'AIDT 专用合成验收成员', password: credentials.password } });
    if (!keys(activated, ['userId', 'orgId', 'orgRole', 'teamId', 'sessionId', 'session']) || !id(activated.userId) || activated.userId === adminUserId
      || activated.orgId !== orgId || activated.orgRole !== 'consultant' || activated.teamId !== '' || !token(activated.sessionId)
      || !sessionValid(activated.session) || activated.session.userId !== activated.userId || !activated.session.orgs.includes(orgId)
      || defaultOrg(activated.session.orgs) !== orgId) error('QA_IDENTITY_ACTIVATION_MISMATCH');
    receipt.accountAccepted = true; receipt.activationOutcome = 'accepted';
    const ordinary = await call(activationContext, 'qa-identity', 'qaIdentityReads', `/api/identity/me?orgId=${encodeURIComponent(orgId)}`, undefined, activated.session.sessionToken);
    if (!object(ordinary) || ordinary.orgRole !== 'consultant' || ordinary.org?.id !== orgId || ordinary.org?.kind !== 'organization') error('QA_IDENTITY_CONSULTANT_REQUIRED');
    receipt.consultantVerified = true;
    identity = { userId: activated.userId, adminUserId, orgId };
    await revoke();
  } catch (cause) {
    failure = cause instanceof QaIdentityError ? cause.code : 'QA_IDENTITY_TRANSPORT_UNKNOWN';
    failedHttp = { status: receipt.httpStatus, reason: receipt.reasonCode };
  } finally {
    if (linkId && !receipt.counts.linkRevokes) try { await revoke(); } catch { failure ??= 'QA_IDENTITY_REVOKE_FAILED'; }
    receipt.phase = 'dispose';
    const contexts = [...new Set([activationContext, adminContext].filter(Boolean))];
    const disposed = await Promise.allSettled(contexts.map(context => Promise.resolve().then(() => context.dispose())));
    receipt.contextsDisposed = disposed.every(result => result.status === 'fulfilled');
    if (!receipt.contextsDisposed) failure ??= 'QA_IDENTITY_DISPOSE_FAILED';
    if (failedHttp) { receipt.httpStatus = failedHttp.status; receipt.reasonCode = failedHttp.reason; }
    receipt.status = failure ? 'failed' : 'succeeded'; receipt.failureCode = failure ?? null; receipt.phase = 'complete';
    try { emit(); } catch { failure ??= 'QA_IDENTITY_CALLBACK_FAILED'; receipt.status = 'failed'; receipt.failureCode = failure; }
  }
  if (failure) throw new QaIdentityError(failure, receipt);
  // Accidentally serializing the result must never publish credentials or account IDs.
  return Object.defineProperties({ receipt: copy(receipt) }, {
    credentials: { value: Object.freeze(credentials), enumerable: false }, identity: { value: Object.freeze(identity), enumerable: false },
  });
}
