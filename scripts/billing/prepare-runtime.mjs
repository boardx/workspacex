#!/usr/bin/env node
import { parseArgs, parseEnv } from 'node:util';
import { createHash, randomUUID, createPrivateKey, createPublicKey } from 'node:crypto';
import { constants, openSync, closeSync, writeFileSync, readFileSync, renameSync, lstatSync, mkdirSync, unlinkSync, fsyncSync } from 'node:fs';
import { resolve, dirname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { acquireLock } from './advisory-lock.mjs';
export const OWNER = Object.freeze({ application: 'workspacex', target: 'devapp', config_version: '1' });
export const RETURN_URL = 'https://devapp.boardx.us/billing?subscription_return=1';
export const WEBHOOK_URL = 'https://devapp.boardx.us/api/billing/webhooks/stripe';
const WECHAT_URL = 'https://devapp.boardx.us/api/billing/webhooks/wechat';
const EVENTS = ['checkout.session.completed', 'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted', 'invoice.payment_failed'];
const STRIPE = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PAYMENT_LINK', 'STRIPE_MANAGEMENT_PORTAL', 'STRIPE_RETURN_URL'];
const WECHAT = ['WECHAT_PAY_APP_ID', 'WECHAT_PAY_MCH_ID', 'WECHAT_PAY_API_V3_KEY', 'WECHAT_PAY_MCH_SERIAL_NO', 'WECHAT_PAY_PRIVATE_KEY', 'WECHAT_PAY_PLATFORM_PUBLIC_KEY', 'WECHAT_PAY_PLATFORM_KEY_ID', 'WECHAT_PAY_NOTIFY_URL'];
const fail = message => { const error = new Error(message); error.safe = true; throw error; };
const same = (a, b) => JSON.stringify(Object.entries(a ?? {}).sort()) === JSON.stringify(Object.entries(b).sort());
const owned = o => same(o?.metadata, OWNER);
const id = (value, prefix) => typeof value === 'string' && new RegExp(`^${prefix}_[A-Za-z0-9]+$`).test(value) ? value : fail('Invalid resource identity');
function safeParents(path, create = true) {
    let current = resolve(dirname(path));
    const parents = [];
    while (true) {
        parents.unshift(current);
        const parent = dirname(current);
        if (parent === current)
            break;
        current = parent;
    }
    for (const parent of parents) {
        try {
            const s = lstatSync(parent);
            if (s.isSymbolicLink() || !s.isDirectory())
                fail('Unsafe output directory');
        }
        catch (e) {
            if (e.code === 'ENOENT' && create)
                mkdirSync(parent, { mode: 0o700 });
            else
                throw e;
        }
    }
}
export function secureWrite(path, value) {
    safeParents(path);
    try {
        if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink())
            fail('Unsafe output file');
    }
    catch (e) {
        if (e.code !== 'ENOENT')
            throw e;
    }
    const temp = `${path}.${randomUUID()}.tmp`;
    let fd;
    try {
        fd = openSync(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
        writeFileSync(fd, JSON.stringify(value));
        fsyncSync(fd);
        closeSync(fd);
        fd = undefined;
        renameSync(temp, path);
    }
    finally {
        if (fd !== undefined)
            closeSync(fd);
        try {
            unlinkSync(temp);
        }
        catch { }
    }
}
function secureRead(path) {
    safeParents(path, false);
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077))
        fail('Unsafe protected file permissions');
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
        return JSON.parse(readFileSync(fd, 'utf8'));
    }
    finally {
        closeSync(fd);
    }
}
export function validatePayload(p) {
    if (!p || !same(Object.keys(p).sort(), ['environment', 'schemaVersion', 'target'].sort()) || p.schemaVersion !== 1 || p.target !== 'devapp' || !p.environment || Array.isArray(p.environment) || typeof p.environment !== 'object')
        fail('Invalid billing payload');
    for (const [k, v] of Object.entries(p.environment))
        if (![...STRIPE, ...WECHAT].includes(k) || typeof v !== 'string' || !v.trim() || v.length > 16384 || v.includes('\0'))
            fail('Invalid billing environment field');
    if (Buffer.byteLength(JSON.stringify(p)) > 65536)
        fail('Billing payload too large');
    if (p.environment.STRIPE_SECRET_KEY && p.environment.STRIPE_RETURN_URL !== RETURN_URL)
        fail('Invalid Stripe return URL');
    const e = p.environment;
    if (Object.keys(e).some(k => k.startsWith('STRIPE_'))) {
        for (const k of ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PAYMENT_LINK', 'STRIPE_RETURN_URL'])
            if (!e[k])
                fail(`Missing environment fields: ${k}`);
        if (!/^sk_(test|live)_[A-Za-z0-9]+$/.test(e.STRIPE_SECRET_KEY) || !/^whsec_[A-Za-z0-9]+$/.test(e.STRIPE_WEBHOOK_SECRET) || !/^https:\/\/buy\.stripe\.com\/[A-Za-z0-9_]+$/.test(e.STRIPE_PAYMENT_LINK))
            fail('Invalid Stripe configuration');
        if (e.STRIPE_MANAGEMENT_PORTAL && !/^https:\/\/billing\.stripe\.com\/p\/login\/[A-Za-z0-9_]+$/.test(e.STRIPE_MANAGEMENT_PORTAL))
            fail('Invalid Stripe management portal');
    }
    if (Object.keys(e).some(k => k.startsWith('WECHAT_PAY_'))) {
        for (const k of WECHAT)
            if (!e[k])
                fail(`Missing environment fields: ${k}`);
        if (e.WECHAT_PAY_NOTIFY_URL !== WECHAT_URL || !/^\d+$/.test(e.WECHAT_PAY_MCH_ID) || !/^[a-fA-F0-9]+$/.test(e.WECHAT_PAY_MCH_SERIAL_NO))
            fail('Invalid WeChat configuration');
        try {
            const privateKey = createPrivateKey(e.WECHAT_PAY_PRIVATE_KEY), publicKey = createPublicKey(e.WECHAT_PAY_PLATFORM_PUBLIC_KEY);
            if (privateKey.asymmetricKeyType !== 'rsa' || publicKey.asymmetricKeyType !== 'rsa' || privateKey.asymmetricKeyDetails.modulusLength < 2048 || publicKey.asymmetricKeyDetails.modulusLength < 2048 || Buffer.byteLength(e.WECHAT_PAY_API_V3_KEY) !== 32 || !/^PUB_KEY_ID_[A-Za-z0-9_]+$/.test(e.WECHAT_PAY_PLATFORM_KEY_ID))
                fail('Invalid WeChat configuration');
        }
        catch {
            fail('Invalid WeChat configuration');
        }
    }
    if (!Object.keys(e).length)
        fail('Empty billing configuration');
    return p;
}
function stripeApi(key, request = fetch) {
    return async (method, path, body = {}, idem) => {
        if (!/^\/(payment_links|webhook_endpoints)(?:[/?]|$)/.test(path))
            fail('Invalid Stripe operation');
        try {
            const response = await request(`https://api.stripe.com/v1${path}`, { method, redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${key}`, 'Stripe-Version': '2025-09-30.clover', ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': idem } : {}) }, ...(method === 'POST' ? { body: new URLSearchParams(body).toString() } : {}) });
            const reader = response.body.getReader();
            let size = 0;
            const chunks = [];
            while (true) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                size += value.length;
                if (size > 1048576) {
                    await reader.cancel();
                    fail('Stripe response too large');
                }
                chunks.push(Buffer.from(value));
            }
            if (!response.ok)
                fail('Stripe request rejected');
            return JSON.parse(Buffer.concat(chunks).toString('utf8'));
        }
        catch {
            fail('Stripe request failed');
        }
    };
}
async function list(api, path) { const r = await api('GET', `/${path}?limit=100`); if (!Array.isArray(r.data) || r.has_more)
    fail('Stripe inventory requires manual review'); return r.data; }
const metadata = () => Object.fromEntries(Object.entries(OWNER).map(([k, v]) => [`metadata[${k}]`, v]));
function checkLink(link) { if (!owned(link) || link.after_completion?.type !== 'redirect' || link.after_completion.redirect?.url !== RETURN_URL)
    fail('Stripe link ownership or return mismatch'); id(link.id, 'plink'); if (!/^https:\/\/buy\.stripe\.com\/[A-Za-z0-9_]+$/.test(link.url))
    fail('Invalid Stripe link URL'); }
function checkWebhook(webhook) { if (!owned(webhook) || webhook.url !== WEBHOOK_URL || webhook.api_version !== '2025-09-30.clover' || !Array.isArray(webhook.enabled_events) || !same([...webhook.enabled_events].sort(), [...EVENTS].sort()))
    fail('Stripe webhook ownership or events mismatch'); id(webhook.id, 'we'); }
function providerConfig(env, providers, baseDir) {
    const out = {};
    const missing = [];
    for (const provider of providers)
        for (const k of provider === 'stripe' ? ['STRIPE_SECRET_KEY', 'STRIPE_PAYMENT_LINK'] : WECHAT.filter(k => k !== 'WECHAT_PAY_NOTIFY_URL')) {
            let value = env[k];
            if (provider === 'wechat' && k.endsWith('_KEY') && env[`${k}_PATH`] && !value)
                value = readFileSync(resolve(baseDir, env[`${k}_PATH`]), 'utf8');
            if (!value?.trim())
                missing.push(k);
            else
                out[k] = value.replace(/\\n/g, '\n');
        }
    if (providers.includes('stripe')) {
        out.STRIPE_RETURN_URL = RETURN_URL;
        if (env.STRIPE_MANAGEMENT_PORTAL)
            out.STRIPE_MANAGEMENT_PORTAL = env.STRIPE_MANAGEMENT_PORTAL;
        if (env.STRIPE_WEBHOOK_SECRET)
            out.STRIPE_WEBHOOK_SECRET = env.STRIPE_WEBHOOK_SECRET;
    }
    if (providers.includes('wechat'))
        out.WECHAT_PAY_NOTIFY_URL = WECHAT_URL;
    return { out, missing };
}
export async function prepare({ env, providers = ['stripe'], mutate = false, api, state = {}, saveState = () => { }, baseDir = process.cwd() }) {
    if (!providers.length || new Set(providers).size !== providers.length || providers.some(p => !['stripe', 'wechat'].includes(p)))
        fail('Invalid providers');
    const { out, missing } = providerConfig(env, providers, baseDir);
    if (missing.length) {
        if (mutate)
            fail(`Missing environment fields: ${missing.join(', ')}`);
        return { ready: false, missing };
    }
    if (providers.includes('wechat')) {
        validatePayload({ schemaVersion: 1, target: 'devapp', environment: Object.fromEntries(Object.entries(out).filter(([k]) => k.startsWith('WECHAT_PAY_'))) });
        try {
            if (createPrivateKey(out.WECHAT_PAY_PRIVATE_KEY).asymmetricKeyType !== 'rsa' || createPublicKey(out.WECHAT_PAY_PLATFORM_PUBLIC_KEY).asymmetricKeyType !== 'rsa' || Buffer.byteLength(out.WECHAT_PAY_API_V3_KEY) !== 32 || !/^PUB_KEY_ID_[A-Za-z0-9_]+$/.test(out.WECHAT_PAY_PLATFORM_KEY_ID))
                fail('Invalid WeChat configuration');
        }
        catch {
            fail('Invalid WeChat configuration');
        }
    }
    if (!providers.includes('stripe'))
        return mutate ? validatePayload({ schemaVersion: 1, target: 'devapp', environment: out }) : { ready: true, missing: [] };
    if (out.STRIPE_MANAGEMENT_PORTAL && !/^https:\/\/billing\.stripe\.com\/p\/login\/[A-Za-z0-9_]+$/.test(out.STRIPE_MANAGEMENT_PORTAL))
        fail('Invalid Stripe management portal');
    if (!/^sk_(test|live)_[A-Za-z0-9]+$/.test(out.STRIPE_SECRET_KEY))
        fail('Invalid Stripe secret key');
    api ??= stripeApi(out.STRIPE_SECRET_KEY);
    const links = await list(api, 'payment_links');
    const source = links.find(l => l.url === env.STRIPE_PAYMENT_LINK);
    if (!source)
        fail('Configured Stripe link unavailable');
    id(source.id, 'plink');
    const lines = await api('GET', `/payment_links/${source.id}/line_items?limit=2`);
    if (lines.has_more || lines.data?.length !== 1 || lines.data[0].price?.type !== 'recurring' || !Number.isSafeInteger(lines.data[0].quantity) || lines.data[0].quantity < 1)
        fail('Stripe source must have one recurring price');
    id(lines.data[0].price.id, 'price');
    const endpoints = await list(api, 'webhook_endpoints');
    if (endpoints.some(e => e.url === WEBHOOK_URL && !owned(e)))
        fail('Stripe webhook ownership collision');
    const identity = createHash('sha256').update(`devapp:v1:${source.id}:${lines.data[0].price.id}:${lines.data[0].quantity}`).digest('hex');
    const run = randomUUID();
    const idem = op => `workspacex-devapp-v1-${identity}-${op}${op.startsWith('stage-') ? `-${run}` : ''}`;
    if (!mutate)
        return { ready: true, missing: [], ownedLink: links.some(owned), ownedWebhook: endpoints.some(e => e.url === WEBHOOK_URL && owned(e)), localState: !!state.webhookSecret };
    if (links.filter(owned).length > 1 || endpoints.filter(e => e.url === WEBHOOK_URL).length > 1)
        fail('Stripe ownership collision');
    if (Object.keys(state).some(k => !['identity', 'linkId', 'webhookId', 'webhookSecret'].includes(k)) || (state.identity && state.identity !== identity))
        fail('Invalid preparation state');
    if (state.webhookSecret && !/^whsec_[A-Za-z0-9]+$/.test(state.webhookSecret))
        fail('Invalid preparation state');
    if ((state.linkId && !/^plink_[A-Za-z0-9]+$/.test(state.linkId)) || (state.webhookId && !/^we_[A-Za-z0-9]+$/.test(state.webhookId)))
        fail('Invalid preparation state');
    state = { ...state, identity };
    let link = state.linkId ? await api('GET', `/payment_links/${state.linkId}`) : links.find(owned);
    let webhook = state.webhookId ? await api('GET', `/webhook_endpoints/${state.webhookId}`) : endpoints.find(e => e.url === WEBHOOK_URL && owned(e));
    if (link) {
        checkLink(link);
        const existing = await api('GET', `/payment_links/${link.id}/line_items?limit=2`);
        if (existing.has_more || existing.data?.length !== 1 || existing.data[0].price?.id !== lines.data[0].price.id || existing.data[0].quantity !== lines.data[0].quantity)
            fail('Owned Stripe link price mismatch');
    }
    if (webhook)
        checkWebhook(webhook);
    const extraWebhooks = new Map();
    const webhookBody = { url: WEBHOOK_URL, api_version: '2025-09-30.clover', ...Object.fromEntries(EVENTS.map((e, i) => [`enabled_events[${i}]`, e])), ...metadata() };
    try {
        if (!link) {
            link = await api('POST', '/payment_links', { 'line_items[0][price]': id(lines.data[0].price.id, 'price'), 'line_items[0][quantity]': String(lines.data[0].quantity), 'after_completion[type]': 'redirect', 'after_completion[redirect][url]': RETURN_URL, ...metadata() }, idem('create-link'));
            checkLink(link);
            state.linkId = link.id;
            saveState(state);
        }
        // Stripe's create APIs do not accept active/disabled. Never publish this URL
        // before staging completes; bound the default-enabled setup window with the
        // immediate disable below and compensation after every uncertain outcome.
        await api('POST', `/payment_links/${link.id}`, { active: 'false' }, idem('stage-link'));
        if (!webhook || !state.webhookSecret) {
            if (webhook)
                await api('POST', `/webhook_endpoints/${webhook.id}`, { disabled: 'true' }, idem('stage-before-replay'));
            const expectedId = webhook?.id;
            const recovered = await api('POST', '/webhook_endpoints', webhookBody, idem('create-webhook'));
            checkWebhook(recovered);
            if (expectedId && recovered.id !== expectedId) {
                extraWebhooks.set(recovered.id, recovered);
                if (await disableOwned(api, null, recovered, idem('expired-replay')))
                    extraWebhooks.delete(recovered.id);
                fail('Stripe webhook recovery expired; operator recovery required');
            }
            webhook = recovered;
            if (!/^whsec_[A-Za-z0-9]+$/.test(webhook.secret ?? ''))
                fail('Stripe webhook signing secret missing');
            state = { ...state, linkId: link.id, webhookId: webhook.id, webhookSecret: webhook.secret };
            saveState(state);
        }
        await api('POST', `/webhook_endpoints/${webhook.id}`, { disabled: 'true' }, idem('stage-webhook'));
    }
    catch {
        // A POST timeout can mean the resource was created. Discover only our exact
        // metadata and target, then compensate even when local persistence failed.
        let discoveryFailed = false;
        try {
            if (!link) {
                const matches = (await list(api, 'payment_links')).filter(owned);
                if (matches.length === 1) {
                    checkLink(matches[0]);
                    link = matches[0];
                }
                else if (matches.length)
                    discoveryFailed = true;
            }
        }
        catch {
            discoveryFailed = true;
        }
        try {
            if (!webhook) {
                const matches = (await list(api, 'webhook_endpoints')).filter(e => owned(e) && e.url === WEBHOOK_URL);
                if (matches.length === 1) {
                    checkWebhook(matches[0]);
                    webhook = matches[0];
                }
                else if (matches.length)
                    discoveryFailed = true;
            }
        }
        catch {
            discoveryFailed = true;
        }
        let disabled = await disableOwned(api, link, webhook, idem('stage-compensation'));
        for (const extra of extraWebhooks.values()) {
            const confirmed = await disableOwned(api, null, extra, idem('extra-compensation'));
            disabled = confirmed && disabled;
        }
        fail(disabled && !discoveryFailed ? 'Stripe preparation failed; owned resources disabled' : 'Stripe preparation failed; operator recovery required');
    }
    return validatePayload({ schemaVersion: 1, target: 'devapp', environment: { ...out, STRIPE_PAYMENT_LINK: link.url, STRIPE_WEBHOOK_SECRET: state.webhookSecret } });
}
async function disableOwned(api, link, webhook, key) {
    let success = true;
    for (const [object, path, body] of [[link, 'payment_links', { active: 'false' }], [webhook, 'webhook_endpoints', { disabled: 'true' }]]) {
        if (!object)
            continue;
        try {
            if (path === 'payment_links')
                checkLink(object);
            else
                checkWebhook(object);
            await api('POST', `/${path}/${object.id}`, body, `${key}-${path}-${randomUUID()}`);
        }
        catch {
            success = false;
        }
    }
    return success;
}
export async function activate(payload, api) {
    const { environment: env } = validatePayload(payload);
    if (!env.STRIPE_SECRET_KEY)
        return { stripe: false };
    if (!/^sk_(test|live)_[A-Za-z0-9]+$/.test(env.STRIPE_SECRET_KEY) || !/^whsec_.+/.test(env.STRIPE_WEBHOOK_SECRET ?? ''))
        fail('Invalid Stripe activation configuration');
    api ??= stripeApi(env.STRIPE_SECRET_KEY);
    const links = await list(api, 'payment_links');
    const endpoints = await list(api, 'webhook_endpoints');
    const matches = links.filter(l => l.url === env.STRIPE_PAYMENT_LINK);
    const hooks = endpoints.filter(e => e.url === WEBHOOK_URL);
    if (matches.length !== 1 || hooks.length !== 1)
        fail('Stripe activation ownership mismatch');
    const link = matches[0], webhook = hooks[0];
    checkLink(link);
    checkWebhook(webhook);
    const run = randomUUID();
    const key = op => `workspacex-devapp-v1-${link.id}-${webhook.id}-${op}-${run}`;
    try {
        await api('POST', `/webhook_endpoints/${webhook.id}`, { disabled: 'false' }, key('enable'));
        await api('POST', `/payment_links/${link.id}`, { active: 'true' }, key('activate'));
    }
    catch {
        const disabled = await disableOwned(api, link, webhook, key('rollback'));
        fail(disabled ? 'Stripe activation failed; owned resources disabled' : 'Stripe activation failed; rollback requires operator review');
    }
    return { stripe: true };
}
export async function main(args = process.argv.slice(2)) {
    const { values } = parseArgs({ args, options: { check: { type: 'boolean' }, 'prepare-stripe': { type: 'boolean' }, 'activate-from-env': { type: 'boolean' }, providers: { type: 'string', default: 'stripe' }, env: { type: 'string', default: '.env.local' }, output: { type: 'string' } } });
    if ([values.check, values['prepare-stripe'], values['activate-from-env']].filter(Boolean).length > 1)
        fail('Choose one operation');
    if (values['activate-from-env']) {
        await activate(JSON.parse(process.env.DEVAPP_BILLING_CONFIG_JSON ?? ''));
        console.log(JSON.stringify({ activated: true }));
        return;
    }
    const mutate = !!values['prepare-stripe'];
    const root = resolve('.harness/state/.cache/billing');
    let output;
    if (values.output) {
        output = resolve(values.output);
        if (!output.startsWith(`${root}${sep}`) || ['stripe-preparation.json', 'prepare.lock'].some(name => output === resolve(root, name)))
            fail('Output must be inside .harness/state/.cache/billing');
    }
    if (mutate && !output)
        fail('--output is required for preparation');
    if (mutate) {
        safeParents(output);
        try {
            if (!lstatSync(output).isFile() || lstatSync(output).isSymbolicLink())
                fail('Unsafe output file');
        }
        catch (e) {
            if (e.code !== 'ENOENT')
                throw e;
        }
    }
    const envPath = resolve(values.env);
    const env = parseEnv(readFileSync(envPath, 'utf8'));
    const statePath = resolve(root, 'stripe-preparation.json');
    let releaseLock;
    const lockPath = resolve(root, 'prepare.lock');
    try {
        if (mutate) {
            safeParents(lockPath);
            releaseLock = await acquireLock(lockPath, () => {
                console.error('Billing preparation lock was lost.');
                process.exit(1);
            });
        }
        // Recovery state must be read under the same lock as provider mutations.
        let state = {};
        try {
            state = secureRead(statePath);
        } catch (e) {
            if (e.code !== 'ENOENT') fail('Cannot read protected preparation state');
        }
        const result = await prepare({ env, providers: values.providers.split(','), mutate, state, baseDir: dirname(envPath), saveState: s => secureWrite(statePath, s) });
        if (mutate) {
            secureWrite(output, result);
            console.log(JSON.stringify({ prepared: true, activated: false }));
        }
        else
            console.log(JSON.stringify(result));
    }
    finally {
        if (releaseLock) await releaseLock();
    }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
    main().catch(error => { console.error(error?.safe ? error.message : 'Billing configuration failed; inspect provider readiness and protected local state.'); process.exitCode = 1; });
