"""Run extracted real rollback functions with process-local shell stubs only."""
import pathlib
import subprocess
import tempfile
import unittest

SOURCE = pathlib.Path(__file__).with_name('deploy-cn-production.sh')

def extract_function(source, name):
    start = source.index(name + '() {\n')
    end = source.index('\n}\n', start) + 3
    return source[start:end]

class RollbackBrowserTests(unittest.TestCase):
    def run_case(self, browser_status=0, restore_status=0, activation_started=1, missing_credentials=False, auto=True):
        source = SOURCE.read_text()
        functions = '\n'.join(extract_function(source, name) for name in ['verify_baseline_browser', 'activation_failure'])
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            (root/'baseline').mkdir()
            if not missing_credentials:
                (root/'baseline/bootstrap.env').write_text('TEST_FIXTURE_ONLY=1\n')
            script = '''set -euo pipefail
RUNTIME_ROOT=$1
release_checkout=$1
baseline_state=unused
CONFIG_FILE=unused
log=$1/calls
browser_status=$2
restore_status=$3
activation_started=$4
fail() { echo "CN_DEPLOY_REJECTED: $1" >&2; exit 1; }
restore_baseline() { echo restore >> "$log"; return "$restore_status"; }
resolve_browser_executable() { echo /test/browser; }
node() {
  case "$2" in
    *dirname*) echo "$RUNTIME_ROOT/baseline" ;;
    *environment.publicUrl*) echo https://example.invalid ;;
    *) echo browser >> "$log"; return "$browser_status" ;;
  esac
}
timeout() { shift; "$@"; }
'''+functions+'\n'
            if auto:
                script += 'trap activation_failure EXIT\n(exit 42)\n'
            else:
                script += '(verify_baseline_browser)\n'
            result = subprocess.run(['bash', '-c', script, 'fixture', directory, str(browser_status), str(restore_status), str(activation_started)], capture_output=True, text=True)
            calls = (root/'calls').read_text().splitlines() if (root/'calls').exists() else []
            return result, calls

    def test_automatic_restore_then_browser_preserves_activation_error(self):
        result, calls = self.run_case()
        self.assertEqual(result.returncode, 42)
        self.assertEqual(calls, ['restore', 'browser'])
        self.assertNotIn('ROLLBACK_UNPROVEN', result.stderr)

    def test_browser_failure_marks_automatic_rollback_unproven(self):
        result, calls = self.run_case(browser_status=1)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(calls, ['restore', 'browser'])
        self.assertIn('CN_DEPLOY_ROLLBACK_UNPROVEN', result.stderr)

    def test_restore_failure_does_not_claim_browser_acceptance(self):
        result, calls = self.run_case(restore_status=1)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(calls, ['restore'])
        self.assertIn('CN_DEPLOY_ROLLBACK_UNPROVEN', result.stderr)

    def test_missing_baseline_credentials_fails_closed(self):
        result, calls = self.run_case(missing_credentials=True)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(calls, ['restore'])
        self.assertIn('CN_DEPLOY_ROLLBACK_UNPROVEN', result.stderr)

    def test_before_activation_no_restore_or_browser(self):
        result, calls = self.run_case(activation_started=0)
        self.assertEqual(result.returncode, 42)
        self.assertEqual(calls, [])

    def test_explicit_rollback_uses_same_browser_helper(self):
        source = SOURCE.read_text()
        block = source[source.index('if [[ "$mode" == rollback ]]'):source.index('if [[ "$mode" == verify-active ]]')]
        self.assertIn('(verify_baseline_browser)', block)
        result, calls = self.run_case(auto=False)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(calls, ['browser'])

if __name__ == '__main__':
    unittest.main()
