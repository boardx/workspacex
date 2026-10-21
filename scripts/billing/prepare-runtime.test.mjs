import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepare, activate, secureWrite, validatePayload, OWNER, RETURN_URL, WEBHOOK_URL } from './prepare-runtime.mjs';
const env = { STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_PAYMENT_LINK: 'https://buy.stripe.com/reference' };
function fixture() {
    const calls = [];
    const link = { id: 'plink_owned', url: 'https://buy.stripe.com/owned', metadata: OWNER, after_completion: { type: 'redirect', redirect: { url: RETURN_URL } } };
    const webhook = { id: 'we_owned', api_version: '2025-09-30.clover', url: WEBHOOK_URL, metadata: OWNER, enabled_events: ['checkout.session.completed', 'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted', 'invoice.payment_failed'] };
    const api = async (method, path, body, key) => {
        calls.push({ method, path, body, key });
        if (path === '/payment_links?limit=100')
            return { data: [{ id: 'plink_reference', url: env.STRIPE_PAYMENT_LINK }, ...(calls.some(c => c.path === '/payment_links' && c.method === 'POST') ? [link] : [])], has_more: false };
        if (['/payment_links/plink_reference/line_items?limit=2', '/payment_links/plink_owned/line_items?limit=2'].includes(path))
            return { data: [{ price: { id: 'price_existing', type: 'recurring', recurring: { interval: 'month' } }, quantity: 1 }], has_more: false };
        if (path === '/payment_links')
            return link;
        if (path === '/webhook_endpoints?limit=100')
            return { data: [], has_more: false };
        if (path === '/webhook_endpoints')
            return { ...webhook, secret: 'whsec_fixture' };
        if (path === '/payment_links/plink_owned')
            return link;
        if (path === '/webhook_endpoints/we_owned')
            return webhook;
        return {};
    };
    return { calls, api, link, webhook };
}
test('default check has no mutations or secret output', async () => { const f = fixture(); const r = await prepare({ env, providers: ['stripe'], api: f.api }); assert.equal(f.calls.filter(c => c.method !== 'GET').length, 0); assert.ok(!JSON.stringify(r).includes(env.STRIPE_SECRET_KEY)); });
test('preparation creates separate resources and persists webhook secret immediately', async () => { const f = fixture(); const states = []; const r = await prepare({ env, providers: ['stripe'], mutate: true, api: f.api, saveState: s => states.push(structuredClone(s)) }); assert.equal(r.environment.STRIPE_PAYMENT_LINK, f.link.url); assert.equal(states.at(-1).webhookSecret, 'whsec_fixture'); assert.ok(f.calls.filter(c => c.method === 'POST').every(c => !c.path.includes('reference'))); assert.ok(f.calls.filter(c => c.method === 'POST').every(c => c.key)); });
test('both providers fail before mutations when platform trust is absent', async () => { const f = fixture(); await assert.rejects(prepare({ env, providers: ['stripe', 'wechat'], mutate: true, api: f.api }), /WECHAT_PAY_PLATFORM_PUBLIC_KEY/); assert.equal(f.calls.length, 0); });
test('secure output has 0600 mode and rejects symlinks', () => { const d = mkdtempSync(join(realpathSync(tmpdir()), 'billing-test-')); const p = join(d, 'config'); secureWrite(p, { secret: 'fixture' }); assert.equal(statSync(p).mode & 0o777, 0o600); assert.equal(JSON.parse(readFileSync(p)).secret, 'fixture'); symlinkSync(p, join(d, 'link')); assert.throws(() => secureWrite(join(d, 'link'), {})); });
test('closed payload rejects unknown keys and paths', () => { assert.throws(() => validatePayload({ schemaVersion: 1, target: 'devapp', environment: { STRIPE_UNKNOWN: 'x' } })); assert.throws(() => validatePayload({ schemaVersion: 1, target: 'devapp', environment: { WECHAT_PAY_PRIVATE_KEY_PATH: '/tmp/key' } })); });
test('activation verifies ownership before mutation and rolls back link on endpoint failure', async () => { const f = fixture(); const payload = { schemaVersion: 1, target: 'devapp', environment: { ...env, STRIPE_PAYMENT_LINK: f.link.url, STRIPE_WEBHOOK_SECRET: 'whsec_fixture', STRIPE_RETURN_URL: RETURN_URL } }; const api = async (m, p, b, k) => { if (m === 'GET' && p === '/payment_links?limit=100')
    return { data: [f.link] }; if (m === 'GET' && p === '/webhook_endpoints?limit=100')
    return { data: [f.webhook] }; if (m === 'POST' && p.includes('webhook_endpoints'))
    throw Error('sensitive upstream'); return f.api(m, p, b, k); }; await assert.rejects(activate(payload, api), /activation failed/); assert.ok(f.calls.some(c => c.body.active === 'false')); f.link.metadata = {}; f.calls.length = 0; await assert.rejects(activate(payload, api), /ownership/); assert.equal(f.calls.length, 0); });
test('rerun reuses local state without creating resources again', async () => { const f = fixture(); let state = {}; const saveState = s => { state = structuredClone(s); }; await prepare({ env, providers: ['stripe'], mutate: true, api: f.api, saveState }); const before = f.calls.filter(c => c.method === 'POST' && ['/payment_links', '/webhook_endpoints'].includes(c.path)).length; await prepare({ env, providers: ['stripe'], mutate: true, api: f.api, saveState, state }); assert.equal(f.calls.filter(c => c.method === 'POST' && ['/payment_links', '/webhook_endpoints'].includes(c.path)).length, before); });
test('foreign webhook in supplied state fails before any mutation', async () => { const f = fixture(); f.webhook.metadata = { application: 'foreign' }; await assert.rejects(prepare({ env, mutate: true, api: f.api, state: { linkId: 'plink_owned', webhookId: 'we_owned', webhookSecret: 'whsec_fixture' } }), /ownership/); assert.equal(f.calls.filter(c => c.method === 'POST').length, 0); });
test('creation idempotency keys remain stable across independent retries', async () => { const a = fixture(), b = fixture(); await prepare({ env, mutate: true, api: a.api }); await prepare({ env, mutate: true, api: b.api }); const keys = f => f.calls.filter(c => ['/payment_links', '/webhook_endpoints'].includes(c.path) && c.method === 'POST').map(c => c.key); assert.deepEqual(keys(a), keys(b)); });
test('file parser never evaluates dotenv shell content and CLI errors redact secrets', async () => { const { spawnSync } = await import('node:child_process'); const { writeFileSync } = await import('node:fs'); const d = mkdtempSync(join(realpathSync(tmpdir()), 'billing-cli-')); const file = join(d, 'env'); writeFileSync(file, 'STRIPE_SECRET_KEY="$(echo DO_NOT_PRINT)"\nSTRIPE_PAYMENT_LINK=https://buy.stripe.com/reference\nUNRELATED=keep\n'); const r = spawnSync(process.execPath, ['scripts/billing/prepare-runtime.mjs', '--check', '--env', file], { encoding: 'utf8' }); assert.equal(r.status, 1); assert.ok(!r.stdout.includes('DO_NOT_PRINT')); assert.ok(!r.stderr.includes('DO_NOT_PRINT')); assert.match(readFileSync(file, 'utf8'), /UNRELATED=keep/); });
test('ambiguous activation writes are compensated for both resources', async () => { for (const broken of ['webhook', 'link']) {
    const f = fixture();
    let active = false, disabled = true;
    const calls = [];
    const payload = { schemaVersion: 1, target: 'devapp', environment: { ...env, STRIPE_PAYMENT_LINK: f.link.url, STRIPE_WEBHOOK_SECRET: 'whsec_fixture', STRIPE_RETURN_URL: RETURN_URL } };
    const api = async (m, p, b, k) => { calls.push({ m, p, b }); if (m === 'GET' && p === '/payment_links?limit=100')
        return { data: [f.link] }; if (m === 'GET' && p === '/webhook_endpoints?limit=100')
        return { data: [f.webhook] }; if (m === 'POST' && p.includes('payment_links'))
        active = b.active === 'true'; if (m === 'POST' && p.includes('webhook_endpoints'))
        disabled = b.disabled === 'true'; if ((broken === 'link' && b?.active === 'true') || (broken === 'webhook' && b?.disabled === 'false'))
        throw Error('response lost after applied'); return {}; };
    await assert.rejects(activate(payload, api), /activation failed/);
    assert.equal(active, false);
    assert.equal(disabled, true);
    assert.equal(calls.find(c => c.m === 'POST').p, '/webhook_endpoints/we_owned');
} });
test('new resource is disabled even if state persistence fails', async () => { const f = fixture(); await assert.rejects(prepare({ env, mutate: true, api: f.api, saveState: () => { throw Error('disk unavailable'); } })); assert.ok(f.calls.some(c => c.path === '/payment_links/plink_owned' && c.body.active === 'false')); });
test('lost webhook create response is recovered by exact idempotent replay', async () => { const f = fixture(); let created = false, failed = false, state = {}; const api = async (m, p, b, k) => { if (m === 'GET' && p === '/webhook_endpoints?limit=100' && created)
    return { data: [f.webhook] }; if (m === 'POST' && p === '/webhook_endpoints') {
    created = true;
    const result = await f.api(m, p, b, k);
    if (!failed) {
        failed = true;
        throw Error('response lost');
    }
    return result;
} return f.api(m, p, b, k); }; await assert.rejects(prepare({ env, mutate: true, api, saveState: s => { state = structuredClone(s); } })); assert.ok(f.calls.some(c => c.path === '/webhook_endpoints/we_owned' && c.body.disabled === 'true')); const result = await prepare({ env, mutate: true, api, state, saveState: s => { state = structuredClone(s); } }); assert.equal(result.environment.STRIPE_WEBHOOK_SECRET, 'whsec_fixture'); const creates = f.calls.filter(c => c.path === '/webhook_endpoints'); assert.equal(creates.length, 2); assert.deepEqual(creates[0], creates[1]); });
test('lost payment link create response is discovered and disabled', async () => {
    const f = fixture();
    const api = async (method, path, body, key) => {
        const result = await f.api(method, path, body, key);
        if (method === 'POST' && path === '/payment_links') throw Error('applied before response lost');
        return result;
    };
    await assert.rejects(prepare({env, mutate:true, api}), /preparation failed/);
    assert.ok(f.calls.some(c => c.path === '/payment_links/plink_owned' && c.body.active === 'false'));
});
test('webhook signing secret persistence failure still disables endpoint', async () => {
    const f = fixture();
    await assert.rejects(prepare({env, mutate:true, api:f.api, saveState:state => {
        if (state.webhookSecret) throw Error('disk unavailable');
    }}), /preparation failed/);
    assert.ok(f.calls.some(c => c.path === '/webhook_endpoints/we_owned' && c.body.disabled === 'true'));
});
test('expired webhook replay disables unexpected new owned endpoint and fails closed', async () => {
    const f = fixture();
    const api = async (method, path, body, key) => {
        if (method === 'GET' && path === '/webhook_endpoints?limit=100') return {data:[f.webhook]};
        if (method === 'POST' && path === '/webhook_endpoints') return {...f.webhook,id:'we_new',secret:'whsec_new'};
        return f.api(method,path,body,key);
    };
    await assert.rejects(prepare({env,mutate:true,api}), /preparation failed/);
    assert.ok(f.calls.some(c=>c.path==='/webhook_endpoints/we_new'&&c.body.disabled==='true'));
    assert.ok(f.calls.some(c=>c.path==='/webhook_endpoints/we_owned'&&c.body.disabled==='true'));
});
test('expired replay cleanup failure retries new endpoint and requires operator recovery', async () => {
    const f = fixture();
    let newDisableAttempts = 0;
    const api = async (method, path, body, key) => {
        if (method === 'GET' && path === '/webhook_endpoints?limit=100') return {data:[f.webhook]};
        if (method === 'POST' && path === '/webhook_endpoints') return {...f.webhook,id:'we_new',secret:'whsec_new'};
        if (method === 'POST' && path === '/webhook_endpoints/we_new' && body.disabled === 'true') {
            newDisableAttempts++;
            throw Error('cannot confirm disable');
        }
        return f.api(method,path,body,key);
    };
    await assert.rejects(prepare({env,mutate:true,api}), /operator recovery required/);
    assert.equal(newDisableAttempts, 2);
    assert.ok(f.calls.some(c=>c.path==='/webhook_endpoints/we_owned'&&c.body.disabled==='true'));
});
