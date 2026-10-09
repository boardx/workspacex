import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('terminal', Path(__file__).resolve().parents[1] / 'scripts/verify-promotion-result.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
SOURCE = 'a' * 40
VALUE = dict(schemaVersion=1, dispatched=True, repository='boardx/workspacex', source=SOURCE,
             baseline='b' * 40, attempt='gha-1-1', tag=f'cn-prepared-{SOURCE}-gha-1-1',
             requestedAt='2026-10-08T00:00:00+00:00', previousRunIds=[1])
RUN = dict(id=2, head_branch=VALUE['tag'], head_sha=SOURCE, event='workflow_dispatch',
           created_at='2026-10-08T00:00:01Z', run_attempt=1, status='completed', conclusion='success')


class TerminalTests(unittest.TestCase):
    def fixture(self, runs=None, jobs=None, ref=SOURCE):
        def call(args):
            path = args[0]
            if '/jobs?' in path:
                return dict(total_count=len(jobs or []), jobs=jobs if jobs is not None else [
                    dict(name=n, status='completed', conclusion='success') for n in ('readiness', 'admit', 'promote')])
            if '/git/ref/' in path:
                return {'object': {'sha': ref}}
            return {'workflow_runs': [copy.deepcopy(RUN)] if runs is None else runs}
        return call

    def test_success_requires_existing_full_gate_jobs_and_committed_ref(self):
        result = m.observe(VALUE, call=self.fixture())
        self.assertEqual(result['runId'], 2)
        self.assertTrue(result['mainCnVerified'])

    def test_failure_cancelled_timed_out_rejected(self):
        for conclusion in ('failure', 'cancelled', 'timed_out', 'skipped', None):
            with self.subTest(conclusion=conclusion), self.assertRaisesRegex(ValueError, 'DOWNSTREAM_FAILED'):
                m.observe(VALUE, call=self.fixture([dict(RUN, conclusion=conclusion)]))

    def test_duplicate_and_rerun_rejected(self):
        for runs, error in (([RUN, dict(RUN, id=3)], 'DUPLICATE'), ([dict(RUN, run_attempt=2)], 'RERUN')):
            with self.assertRaisesRegex(ValueError, error):
                m.observe(VALUE, call=self.fixture(runs))

    def test_missing_skipped_or_failed_business_gate_rejected(self):
        for jobs in ([], [dict(name='promote', status='completed', conclusion='success')],
                     [dict(name=n, status='completed', conclusion='failure' if n == 'promote' else 'success')
                      for n in ('readiness', 'admit', 'promote')]):
            with self.assertRaisesRegex(ValueError, 'BUSINESS_GATE'):
                m.observe(VALUE, call=self.fixture(jobs=jobs))

    def test_ref_mismatch_rejected_after_successful_run(self):
        with self.assertRaisesRegex(ValueError, 'REF_NOT_COMMITTED'):
            m.observe(VALUE, call=self.fixture(ref='b' * 40))

    def test_wrong_source_tag_old_or_absent_run_times_out(self):
        for runs in ([], [dict(RUN, id=1)], [dict(RUN, head_sha='b' * 40)],
                     [dict(RUN, head_branch='main')], [dict(RUN, created_at='2026-10-07T00:00:00Z')]):
            now = [0]
            def sleep(seconds): now[0] += seconds
            with self.assertRaisesRegex(ValueError, 'TIMEOUT'):
                m.observe(VALUE, call=self.fixture(runs), timeout=2, interval=1,
                          clock=lambda: now[0], sleep=sleep)

    def test_invalid_identity_never_calls_github(self):
        for field, value in (('repository', 'evil/repo'), ('source', 'main'), ('tag', 'main'),
                             ('attempt', '../x'), ('requestedAt', '2026-10-08T00:00:00')):
            with self.assertRaises(ValueError):
                m.observe(dict(VALUE, **{field: value}), call=lambda _: self.fail('network called'))

    def test_dispatch_correlation_and_duplicate_refusal(self):
        frozen = dict(tag=VALUE['tag'], object=dict(type='commit', sha=SOURCE),
                      message=__import__('json').dumps(dict(releaseSourceSha=SOURCE,
                          expectedMainCnSha=VALUE['baseline'], attemptId=VALUE['attempt'])))
        for previous in ([], [RUN]):
            responses = iter([{'object': {'sha': VALUE['baseline']}},
                              {'object': {'type': 'tag', 'sha': 'c' * 40}}, frozen,
                              {'workflow_runs': previous}, None])
            calls = []
            def call(args, payload=None):
                calls.append(args)
                return next(responses)
            args = ('full-release', VALUE['repository'], SOURCE, VALUE['baseline'], VALUE['attempt'], VALUE['tag'])
            if previous:
                with self.assertRaisesRegex(ValueError, 'ALREADY_DISPATCHED'):
                    m.dispatch.dispatch(*args, call=call, correlate=True)
                self.assertFalse(any('--method' in c for c in calls))
            else:
                result = m.dispatch.dispatch(*args, call=call, correlate=True)
                self.assertEqual(result['previousRunIds'], [])
                self.assertEqual(result['tag'], VALUE['tag'])
                self.assertTrue(result['dispatched'])

    def test_hundred_historical_runs_and_target_on_second_page(self):
        historical = [dict(RUN, id=100+i, head_branch='other-frozen-tag',
                           created_at='2026-10-07T00:00:00Z') for i in range(100)]
        normal = self.fixture()
        pages = []
        def call(args):
            if '/runs?' in args[0]:
                pages.append(args[0])
                return dict(total_count=101, workflow_runs=historical if args[0].endswith('&page=1') else [RUN])
            return normal(args)
        self.assertEqual(m.observe(VALUE, call=call)['runId'], 2)
        self.assertEqual(len(pages), 2)
        self.assertTrue(all('head_sha='+SOURCE in p for p in pages))

    def test_duplicate_on_second_page_not_hidden(self):
        first = [dict(RUN, id=100+i, head_branch='other') for i in range(99)] + [RUN]
        def call(args):
            return dict(total_count=101, workflow_runs=first if args[0].endswith('&page=1') else [dict(RUN, id=3)])
        with self.assertRaisesRegex(ValueError, 'DUPLICATE_RUN'):
            m.observe(VALUE, call=call)

    def test_incomplete_or_oversized_run_window_rejected(self):
        for listing in (dict(total_count=2, workflow_runs=[RUN]),
                        dict(total_count=1000, workflow_runs=[RUN])):
            with self.assertRaisesRegex(ValueError, 'WINDOW_'):
                m.dispatch.promotion_runs('repos/boardx/workspacex', SOURCE, lambda _: listing)

    def test_request_failure_does_not_dispatch_or_repair(self):
        calls = []
        def call(args):
            calls.append(args)
            raise ValueError('PROMOTION_GITHUB_REQUEST_FAILED')
        with self.assertRaises(ValueError): m.observe(VALUE, call=call)
        self.assertEqual(len(calls), 1)
        self.assertNotIn('--method', calls[0])


if __name__ == '__main__': unittest.main()
