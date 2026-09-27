import {randomBytes, randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {tsImport} from 'tsx/esm/api';
import type {Page} from '@playwright/test';
import {SESSION_TOKEN_STORAGE_KEY} from '../../lib/api-client';
import {FULLSTACK_E2E} from '../fullstack-smoke-fixture';
const loadApiFixture = (path: string) => tsImport(pathToFileURL(resolve(__dirname, `../../../api/${path}`)).href, {parentURL: pathToFileURL(__filename).href, tsconfig: resolve(__dirname, "../../../api/tsconfig.json")});
type FixtureDb = {query<T = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<{rows: T[]; rowCount: number | null}>};
type FixtureHelpers = {asOwner<T>(fn: (db: FixtureDb) => Promise<T>): Promise<T>; asApp<T>(orgId: string, fn: (db: FixtureDb) => Promise<T>): Promise<T>; addOrgMember(orgId: string, userId: string, role: string, team: null): Promise<void>};
// Load the official test fixture only inside the running isolated test. Keeping
// the API test dependency out of the Web product type graph avoids importing the
// entire API migration/deployment graph into Next's application compilation.
let fixturePromise: Promise<FixtureHelpers> | undefined;
const fixtures = () => fixturePromise ??= loadApiFixture('tests/support/db.ts') as Promise<FixtureHelpers>;

export type SoakIdentity = {userId: string; email: string; password: string; role: 'owner' | 'editor' | 'viewer'};
/** Only identity prerequisites are seeded. Board membership and edits use real product APIs/UI.
 * Never invokes ensureDatabase/migrate/reset: the main session owns the isolated stack. */
export async function seedBoardSoakIdentities(): Promise<SoakIdentity[]> {
  if (!process.env.WORKSPACEX_ISOLATION_ID || !process.env.WORKSPACEX_DB
    || process.env.WORKSPACEX_DB === 'workspacex') throw new Error('SOAK_REQUIRES_MAIN_SESSION_ISOLATED_STACK');
  const {asOwner, addOrgMember} = await fixtures();
  await asOwner(async db => {
    const result = await db.query<{name: string}>('SELECT current_database() AS name');
    if (result.rows[0]?.name !== process.env.WORKSPACEX_DB) throw new Error('SOAK_DATABASE_ISOLATION_MISMATCH');
    const org = await db.query('SELECT id FROM organizations WHERE id = $1', [FULLSTACK_E2E.orgId]);
    if (org.rowCount !== 1) throw new Error('SOAK_FULLSTACK_ORG_NOT_SEEDED');
  });
  const run = randomUUID(), actors: SoakIdentity[] = [];
  const {BcryptPasswordHasher} = await loadApiFixture('src/infrastructure/auth/bcrypt-password-hasher.ts') as {BcryptPasswordHasher: new () => {hash(value: string): Promise<string>}};
  const hasher = new BcryptPasswordHasher();
  try {
    for (let index = 0; index < 50; index++) {
      const actor: SoakIdentity = {userId: `soak-${run}-${index}`, email: `soak-${run}-${index}@example.test`,
        password: `Soak-${randomBytes(24).toString('base64url')}!`, role: index === 0 ? 'owner' : index < 20 ? 'editor' : 'viewer'};
      actors.push(actor);
      const hash = await hasher.hash(actor.password);
      await asOwner(db => db.query('INSERT INTO credentials (user_id,email,display_name,password_hash,email_verified_at) VALUES ($1,$2,$3,$4,now())', [actor.userId, actor.email, `Board soak ${index}`, hash]));
      await addOrgMember(FULLSTACK_E2E.orgId, actor.userId, 'consultant', null);
    }
    return actors;
  } catch (error) { await removeBoardSoakIdentities(actors); throw error; }
}
export async function removeBoardSoakIdentities(actors: SoakIdentity[]) {
  if (!actors.length) return;
  const {asOwner, asApp} = await fixtures();
  const ids = actors.map(actor => actor.userId);
  if (ids.some(id => !/^soak-[a-f0-9-]+-\d+$/.test(id))) throw new Error('SOAK_CLEANUP_SCOPE_INVALID');
  await asApp(FULLSTACK_E2E.orgId, db => db.query('DELETE FROM org_memberships WHERE org_id=$1 AND user_id=ANY($2::text[])', [FULLSTACK_E2E.orgId, ids]));
  await asOwner(db => db.query('DELETE FROM credentials WHERE user_id=ANY($1::text[])', [ids]));
}

export async function loginBoardSoakActor(page: Page, actor: SoakIdentity) {
  try {
    await page.goto('/login');
    await page.getByTestId('login-email').fill(actor.email);
    await page.getByTestId('login-password').fill(actor.password);
    const authenticated = page.waitForResponse(response => new URL(response.url()).pathname === '/auth/login' && response.request().method() === 'POST');
    await page.getByTestId('login-submit').click();
    const response = await authenticated;
    if (!response.ok()) throw new Error('AUTHENTICATION_REJECTED');
    const session = await response.json() as {userId?: string; orgs?: string[]; sessionToken?: string};
    if (session.userId !== actor.userId || !session.orgs?.includes(FULLSTACK_E2E.orgId)) throw new Error('SOAK_AUTHENTICATED_IDENTITY_MISMATCH');
    await page.waitForURL(/\/projects$/, {timeout: 30_000});
    const token = await page.evaluate(key => localStorage.getItem(key), SESSION_TOKEN_STORAGE_KEY);
    if (!token || token !== session.sessionToken) throw new Error('NO_MATCHING_SESSION');
    return token;
  } catch { throw new Error(`SOAK_REAL_LOGIN_FAILED:${actor.userId}`); }
}
