"""Exercise the installed helper without root, network, or real credentials."""
import json
import pathlib
import tempfile
import unittest

SOURCE = pathlib.Path(__file__).resolve().parents[1] / 'deploy-readiness.sh'


def helper():
    text = SOURCE.read_text()
    assert '# BILLING_RUNTIME_PYTHON_BEGIN\n' in text, 'missing billing runtime helper'
    code = text.split('# BILLING_RUNTIME_PYTHON_BEGIN\n', 1)[1].split('# BILLING_RUNTIME_PYTHON_END', 1)[0]
    scope = {'__name__': 'billing_runtime_test'}
    exec(compile(code, str(SOURCE), 'exec'), scope)
    return scope


def stripe(**overrides):
    return dict(STRIPE_SECRET_KEY='sk_test_fixture123', STRIPE_WEBHOOK_SECRET='whsec_fixture123',
                STRIPE_PAYMENT_LINK='https://buy.stripe.com/test_fixture',
                STRIPE_RETURN_URL='https://devapp.boardx.us/billing?subscription_return=1', **overrides)


def pem(label, body):
    """Construct unmistakably synthetic key framing without a static key block."""
    return '-----' + 'BEGIN ' + label + '-----\n' + body + '\n-----' + 'END ' + label + '-----'


def payload(env):
    return json.dumps({'schemaVersion': 1, 'target': 'devapp', 'environment': env}).encode()


class BillingRuntimeTest(unittest.TestCase):
    def setUp(self):
        self.h = helper()

    def test_closed_bounded_payload_and_provider_completeness(self):
        validate = self.h['validate_payload']
        for raw in [b'x' * 65537, b'{', payload({'PATH': '/tmp'}), payload({'STRIPE_SECRET_KEY': 'sk_test_x'}),
                    payload(dict(stripe(), STRIPE_RETURN_URL='https://evil.test/')),
                    payload(dict(stripe(), STRIPE_PAYMENT_LINK='https://buy.stripe.com.evil.test/a')),
                    b'{"schemaVersion":1,"target":"prod","environment":{}}',
                    b'{"schemaVersion":1,"schemaVersion":1,"target":"devapp","environment":{}}']:
            with self.subTest(raw=raw[:40]), self.assertRaises(ValueError):
                validate(raw, {})
        config, providers = validate(payload(stripe()), {})
        self.assertEqual(providers, {'stripe'})
        self.assertEqual(config, stripe())

    def test_wechat_pem_trailing_newlines_and_pinned_callback(self):
        import base64
        der = base64.b64encode(b'\x30' + b'x' * 300).decode()
        config = {'WECHAT_PAY_APP_ID': 'wx123456', 'WECHAT_PAY_MCH_ID': '1900000000',
                  'WECHAT_PAY_API_V3_KEY': 'a' * 32, 'WECHAT_PAY_MCH_SERIAL_NO': 'ABC123',
                  'WECHAT_PAY_PRIVATE_KEY': pem('PRIVATE KEY', der) + '\n',
                  'WECHAT_PAY_PLATFORM_PUBLIC_KEY': pem('PUBLIC KEY', der) + '\n',
                  'WECHAT_PAY_PLATFORM_KEY_ID': 'PUB_KEY_ID_FIXTURE',
                  'WECHAT_PAY_NOTIFY_URL': 'https://devapp.boardx.us/api/billing/webhooks/wechat'}
        merged, providers = self.h['validate_payload'](payload(config), {})
        self.assertEqual(merged, config)
        self.assertEqual(providers, {'wechat'})
        for patch in [{'WECHAT_PAY_NOTIFY_URL': 'https://evil.test/'},
                      {'WECHAT_PAY_PLATFORM_KEY_ID': 'untrusted'},
                      {'WECHAT_PAY_PRIVATE_KEY': pem('PRIVATE KEY', 'invalid')}]:
            with self.subTest(patch=patch), self.assertRaises(ValueError):
                self.h['validate_payload'](payload(dict(config, **patch)), {})

    def test_wechat_reference_compatibility_without_platform_trust(self):
        import base64
        merchant = {'WECHAT_PAY_APP_ID': 'wx123456', 'WECHAT_PAY_MCH_ID': '1900000000',
                    'WECHAT_PAY_API_V3_KEY': 'a' * 32, 'WECHAT_PAY_MCH_SERIAL_NO': 'ABC123',
                    'WECHAT_PAY_PRIVATE_KEY': pem('PRIVATE KEY', base64.b64encode(b'\x30' + b'x' * 300).decode()),
                    'WECHAT_PAY_NOTIFY_URL': 'https://devapp.boardx.us/api/billing/webhooks/wechat'}
        merged, providers = self.h['validate_payload'](payload(merchant), {})
        self.assertEqual(merged, merchant)
        self.assertEqual(providers, {'wechat'})
        for required in ['WECHAT_PAY_PRIVATE_KEY', 'WECHAT_PAY_API_V3_KEY', 'WECHAT_PAY_MCH_ID']:
            incomplete = dict(merchant)
            del incomplete[required]
            with self.subTest(required=required), self.assertRaises(ValueError):
                self.h['validate_payload'](payload(incomplete), {})
        for trust in [{'WECHAT_PAY_PLATFORM_KEY_ID': 'PUB_KEY_ID_FIXTURE'},
                      {'WECHAT_PAY_PLATFORM_PUBLIC_KEY': pem('PUBLIC KEY', 'invalid')},
                      {'WECHAT_PAY_PLATFORM_PUBLIC_KEY': pem('PUBLIC KEY', 'invalid'),
                       'WECHAT_PAY_PLATFORM_KEY_ID': 'PUB_KEY_ID_FIXTURE'}]:
            with self.subTest(trust=trust), self.assertRaises(ValueError):
                self.h['validate_payload'](payload(dict(merchant, **trust)), {})

    def test_read_owned_rejects_symlink_without_reading_target(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            target = root / 'target'
            target.write_text('not configuration')
            link = root / 'link'
            link.symlink_to(target)
            with self.assertRaises(OSError):
                self.h['read_owned'](link)

    def test_transaction_success_installs_private_files_and_confirms_providers(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            env, dropin = root / 'billing.env', root / '90-billing.conf'
            calls = []
            self.h['configure_transaction'](stripe(), {'stripe'}, env, dropin,
                lambda: calls.append('restart'), lambda providers, old: calls.append((providers, old)), 'old')
            self.assertEqual(self.h['decode_environment'](env.read_bytes()), stripe())
            self.assertEqual(env.stat().st_mode & 0o777, 0o600)
            self.assertEqual(dropin.stat().st_mode & 0o777, 0o600)
            self.assertEqual(dropin.read_text(), '[Service]\nEnvironmentFile=' + str(env) + '\n')
            self.assertEqual(calls, ['restart', ({'stripe'}, 'old')])

    def test_partial_provider_updates_preserve_existing_other_provider(self):
        previous = {'WECHAT_PAY_APP_ID': 'untouched'}
        config, _ = self.h['validate_payload'](payload(stripe()), previous)
        self.assertEqual(config['WECHAT_PAY_APP_ID'], 'untouched')
        updated, _ = self.h['validate_payload'](payload({'STRIPE_WEBHOOK_SECRET': 'whsec_new'}), config)
        self.assertEqual(updated['STRIPE_PAYMENT_LINK'], stripe()['STRIPE_PAYMENT_LINK'])

    def test_shell_payload_is_rejected_without_execution(self):
        with tempfile.TemporaryDirectory() as tmp:
            marker = pathlib.Path(tmp) / 'executed'
            value = 'sk_test_$(touch ' + str(marker) + ')'
            with self.assertRaises(ValueError):
                self.h['validate_payload'](payload(dict(stripe(), STRIPE_SECRET_KEY=value)), {})
            self.assertFalse(marker.exists())

    def test_systemd_roundtrip_preserves_pem_and_inert_metacharacters(self):
        values = {'WECHAT_PAY_PRIVATE_KEY': pem('PRIVATE KEY', 'YWJj'),
                  'STRIPE_WEBHOOK_SECRET': 'whsec_abc'}
        self.assertEqual(self.h['decode_environment'](self.h['encode_environment'](values)), values)

    def test_rejects_symlink_and_insecure_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            target = root / 'real'
            target.mkdir()
            link = root / 'link'
            link.symlink_to(target, target_is_directory=True)
            with self.assertRaises(ValueError):
                self.h['check_directory'](link, owner=self.h['os'].getuid())
            target.chmod(0o777)
            with self.assertRaises(ValueError):
                self.h['check_directory'](target, owner=self.h['os'].getuid())

    def test_transaction_preserves_base_env_and_rolls_back_restart_or_health_failure(self):
        for fail in ['restart', 'health']:
            with self.subTest(fail=fail), tempfile.TemporaryDirectory() as tmp:
                root = pathlib.Path(tmp)
                base = root / 'deploy.env'
                base.write_text('DATABASE_URL=untouched\n')
                env = root / 'billing.env'
                dropin = root / '90-billing.conf'
                env.write_bytes(self.h['encode_environment'](stripe()))
                env.chmod(0o600)
                original = env.read_bytes()
                calls = []
                def restart():
                    calls.append('restart')
                    if fail == 'restart' and len(calls) == 1:
                        raise RuntimeError('failed')
                def ready(providers, old):
                    raise RuntimeError('failed health')
                with self.assertRaises(RuntimeError):
                    self.h['configure_transaction'](dict(stripe(), STRIPE_WEBHOOK_SECRET='whsec_new'),
                        {'stripe'}, env, dropin, restart, ready, 'old')
                self.assertEqual(env.read_bytes(), original)
                self.assertFalse(dropin.exists())
                self.assertEqual(base.read_text(), 'DATABASE_URL=untouched\n')
                self.assertEqual(calls, ['restart', 'restart'])

    def test_restarting_processes_do_not_accumulate_stable_samples(self):
        states = iter(['new-a', 'new-a', 'new-b', 'new-b', 'new-c', 'new-c'])
        with self.assertRaises(RuntimeError):
            self.h['wait_ready']({'stripe'}, 'old', invocation=lambda: next(states),
                fetch=lambda path: {'enabledProviders': ['stripe'], 'trustworthy': True,
                                    'rlsForced': True, 'appRoleIsOwner': False},
                sleep=lambda _: None, attempts=3)

    def test_old_healthy_process_cannot_satisfy_readiness(self):
        with self.assertRaises(RuntimeError):
            self.h['wait_ready']({'stripe'}, 'old', invocation=lambda: 'old',
                fetch=lambda path: {'enabledProviders': ['stripe'], 'trustworthy': True,
                                    'rlsForced': True, 'appRoleIsOwner': False},
                sleep=lambda _: None, attempts=3)


if __name__ == '__main__':
    unittest.main()
