"""WX-T001–T008: upstream file operations over the real E003 HTTP sandbox.

These tests require an explicitly owned integration container. They do not
replace public event-ID mapping or production graph integration acceptance.
"""
import hashlib

from deepagents.backends.sandbox import BaseSandbox

from native_sandbox_fixture import real_native_session


def test_t001_unicode_listing_missing_path_and_sibling_isolation():
    with real_native_session() as (first, _), real_native_session([]) as (second, _):
        assert first.write('/workspace/中文 notes.txt', 'hello').error is None
        listing = first.ls('/workspace')
        assert listing.error is None
        assert '/workspace/中文 notes.txt' in [entry['path'] for entry in listing.entries]
        assert second.read('/workspace/中文 notes.txt').error
        assert first.ls('/workspace/missing').error
        assert type(first).ls is BaseSandbox.ls


def test_t002_read_exact_line_window():
    with real_native_session() as (adapter, _):
        assert adapter.write('/workspace/lines.txt', 'first\n第二行\nthird\nfourth').error is None
        result = adapter.read('/workspace/lines.txt', offset=1, limit=2)
        assert result.error is None
        assert result.file_data['content'] == '第二行\nthird'
        assert (result.start_line, result.end_line, result.next_offset) == (2, 3, 3)
        assert adapter.read('/run/sessions/skill-sandbox.sock').error
        assert type(adapter).read is BaseSandbox.read


def test_t003_utf8_roundtrip_and_readonly_skill():
    with real_native_session() as (adapter, _):
        content = '研究结果\nCafé — 测试\n'
        assert adapter.write('/workspace/研究/output.txt', content).error is None
        downloaded = adapter.download_files(['/workspace/研究/output.txt'])[0]
        assert downloaded.error is None
        assert hashlib.sha256(downloaded.content).digest() == hashlib.sha256(content.encode()).digest()
        original = adapter.download_files(['/skills/example/SKILL.md'])[0].content
        assert adapter.write('/skills/example/SKILL.md', 'overwrite').error
        assert adapter.download_files(['/skills/example/SKILL.md'])[0].content == original
        assert type(adapter).write is BaseSandbox.write


def test_t004_edit_ambiguity_and_missing_match_do_not_change_file():
    with real_native_session() as (adapter, _):
        path = '/workspace/edit.txt'
        assert adapter.write(path, 'same\nsame\nunique').error is None
        assert adapter.edit(path, 'same', 'changed').error
        assert adapter.edit(path, 'absent', 'changed').error
        assert adapter.download_files([path])[0].content == b'same\nsame\nunique'
        edited = adapter.edit(path, 'unique', '唯一')
        assert edited.error is None and edited.occurrences == 1
        assert adapter.download_files([path])[0].content == 'same\nsame\n唯一'.encode()
        assert type(adapter).edit is BaseSandbox.edit


def test_t005_recursive_glob_and_traversal_rejection():
    with real_native_session() as (adapter, _):
        assert adapter.write('/workspace/嵌套/report.txt', 'data').error is None
        assert adapter.write('/workspace/top.txt', 'top').error is None
        result = adapter.glob('**/*.txt', '/workspace')
        assert result.error is None
        assert {item['path'] for item in result.matches} == {'嵌套/report.txt', 'top.txt'}
        assert adapter.glob('../skills/**', '/workspace').error
        assert type(adapter).glob is BaseSandbox.glob


def test_t006_literal_grep_and_explicit_cap():
    with real_native_session() as (adapter, _):
        assert adapter.write('/workspace/搜索/notes.txt', 'needle.*\nneedle.*\nneedle.*\nother').error is None
        found = adapter.grep('needle.*', '/workspace', glob='**/*.txt', max_count=2)
        assert found.error is None and found.truncated
        assert len(found.matches) == 2
        assert [match['line'] for match in found.matches] == [1, 2]
        absent = adapter.grep('not present', '/workspace')
        assert absent.error is None and absent.matches == [] and not absent.truncated
        assert type(adapter).grep is BaseSandbox.grep


def test_t007_delete_only_workspace_file():
    with real_native_session() as (adapter, _):
        assert adapter.write('/workspace/delete.txt', 'temporary').error is None
        assert adapter.delete('/workspace/delete.txt').error is None
        assert '/workspace/delete.txt' not in [item['path'] for item in adapter.ls('/workspace').entries]
        assert adapter.delete('/skills/example/SKILL.md').error
        assert adapter.download_files(['/skills/example/SKILL.md'])[0].error is None
        assert type(adapter).delete is BaseSandbox.delete


def test_t008_python_calculation_and_nonzero_execution():
    with real_native_session() as (adapter, _):
        result = adapter.execute("python3 -c \"from pathlib import Path; Path('/workspace/sum.txt').write_text(str(sum(range(101))))\"")
        assert result.exit_code == 0 and not result.truncated
        assert adapter.download_files(['/workspace/sum.txt'])[0].content == b'5050'
        failed = adapter.execute("python3 -c 'raise SystemExit(7)'")
        assert failed.exit_code == 7
