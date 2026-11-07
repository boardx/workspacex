"""Run ONLY in a disposable root Linux container. GitHub metadata is a fixture.

Exercises actual uid separation, fixed filesystem paths, lock and Git commands;
does not prove live GitHub authority, host installation or production readiness.
"""
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

assert sys.platform == 'linux' and os.geteuid() == 0
assert not Path('/var/lib/workspacex-cn').exists(), 'disposable container required'
subprocess.run(['useradd', '-m', 'ghrunner'], check=True)
installed = Path('/usr/local/lib/workspacex-cn/cn_auto_source.py')
installed.parent.mkdir(parents=True)
shutil.copyfile(Path(__file__).resolve().parents[1] / 'cn_auto_source.py', installed)
installed.chmod(0o755)
hold_helper = installed.parent / 'cn_maintenance_hold.py'
shutil.copyfile(Path(__file__).resolve().parents[1] / 'cn_maintenance_hold.py', hold_helper)
hold_helper.chmod(0o700)
spec = importlib.util.spec_from_file_location('cn_auto_source', installed)
M = importlib.util.module_from_spec(spec)
spec.loader.exec_module(M)
producer = Path('/tmp/producer')
producer.mkdir()
M.git(producer, 'init')
M.git(producer, 'config', 'user.name', 'source integration')
M.git(producer, 'config', 'user.email', 'test@example.invalid')
tool = producer / '.harness/scripts/vm/cn_auto_source.py'
tool.parent.mkdir(parents=True)
shutil.copyfile(installed, tool)
shutil.copyfile(hold_helper, tool.with_name('cn_maintenance_hold.py'))
M.git(producer, 'add', '.')
M.git(producer, 'commit', '-m', 'baseline')
baseline = M.git(producer, 'rev-parse', 'HEAD')
M.git(producer, 'branch', '-M', 'main')
M.git(producer, 'branch', 'main-cn', baseline)
root_cache = Path('/var/lib/workspacex-cn/source-cache.git')
root_cache.parent.mkdir(mode=0o700)
runtime = root_cache.parent / 'runtime'
runtime.mkdir(mode=0o700)
(runtime / 'release.lock').write_text('')
(runtime / 'release.lock').chmod(0o600)
(runtime / 'hold.json').write_text(json.dumps({'schemaVersion': 1, 'state': 'cleared',
    'generation': 'a' * 32, 'identity': dict(sourceRevision=baseline,
    baselineRevision=baseline, migrationPlanSha256='b' * 64, attemptId='source-integration')}))
(runtime / 'hold.json').chmod(0o600)
profile = Path('/etc/workspacex-cn')
profile.mkdir(mode=0o700)
binding = profile / 'trusted-tool-binding.json'
binding.write_text(json.dumps(dict(toolRevision=baseline, filesSha256={
    '.harness/scripts/vm/cn_maintenance_hold.py': hashlib.sha256(hold_helper.read_bytes()).hexdigest()})))
binding.chmod(0o600)
M.git(producer, 'clone', '--bare', '--no-local', str(producer), str(root_cache))
root_cache.chmod(0o700)
runner_parent = Path('/opt/workspacex-cn')
runner_parent.mkdir()
runner_cache = runner_parent / 'release-origin-cache.git'
repo = runner_parent / 'repository'
M.git(producer, 'clone', '--bare', '--no-local', str(producer), str(runner_cache))
M.git(producer, 'clone', str(runner_cache), str(repo))
subprocess.run(['chown', '-R', 'ghrunner:ghrunner', str(runner_parent)], check=True)

def bundle_for_round(number):
    (producer / 'version').write_text(str(number))
    M.git(producer, 'add', '.')
    M.git(producer, 'commit', '-m', 'candidate ' + str(number))
    revision = M.git(producer, 'rev-parse', 'HEAD')
    M.git(producer, 'update-ref', M.REMOTE_REF, revision)
    bundle = Path('/tmp/source-' + str(number) + '.bundle')
    M.git(producer, 'bundle', 'create', str(bundle), M.REMOTE_REF)
    return revision, bundle

def perform(revision, bundle, attempt):
    M.verify_desired = lambda actual: M.require(actual == revision, 'fixture remote rejected')
    with bundle.open('rb') as stream:
        sys.stdin = io.TextIOWrapper(stream)
        M.main([revision, attempt, hashlib.sha256(bundle.read_bytes()).hexdigest()])
    assert M.git(repo, 'rev-parse', 'HEAD', user='ghrunner') == baseline
    assert M.git(root_cache, 'rev-parse', 'refs/heads/main-cn') == baseline
    assert M.git(root_cache, 'rev-parse', 'refs/heads/main') == revision
    assert M.git(runner_cache, 'rev-parse', 'refs/heads/main', user='ghrunner') == revision
    assert M.git(repo, 'rev-parse', 'origin/main', user='ghrunner') == revision

first, first_bundle = bundle_for_round(1)
perform(first, first_bundle, 'gha-1-1')
assert M.git(runner_cache, 'rev-parse', 'refs/heads/main-cn', user='ghrunner') == baseline
assert M.git(repo, 'rev-parse', 'origin/main-cn', user='ghrunner') == baseline
# Mimic the existing promotion ref update. Root main-cn deliberately stays stale.
M.git(runner_cache, 'update-ref', 'refs/heads/main-cn', first, baseline, user='ghrunner')
M.git(repo, 'update-ref', 'refs/remotes/origin/main-cn', first, baseline, user='ghrunner')
second, second_bundle = bundle_for_round(2)
perform(second, second_bundle, 'gha-2-1')
assert M.git(runner_cache, 'rev-parse', 'refs/heads/main-cn', user='ghrunner') == first
assert M.git(repo, 'rev-parse', 'origin/main-cn', user='ghrunner') == first
# Maintenance admission stops even source staging and preserves all authorities.
hold = json.loads((runtime / 'hold.json').read_text())
hold['state'] = 'held'
(runtime / 'hold.json').write_text(json.dumps(hold))
try:
    perform(second, second_bundle, 'gha-3-1')
    raise AssertionError('held import admitted')
except M.Rejected as error:
    assert str(error) == 'CN_AUTO_SOURCE_MAINTENANCE_HOLD'
# A damaged record saying cleared must also reject, rather than bypass hold.lock.
(runtime / 'hold.json').write_text(json.dumps({'schemaVersion': 1, 'state': 'cleared'}))
try:
    perform(second, second_bundle, 'gha-4-1')
    raise AssertionError('damaged cleared record admitted')
except M.Rejected as error:
    assert str(error) == 'CN_AUTO_SOURCE_MAINTENANCE_HOLD'
assert not list(runtime.glob('.auto-source-*'))
assert not list(Path('/run').glob('workspacex-cn-auto-source-*'))
print('PASS: two actual root/ghrunner imports, stale root ref, HEAD preservation, maintenance rejection, cleanup')
