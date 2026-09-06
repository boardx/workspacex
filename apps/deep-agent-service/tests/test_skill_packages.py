"""Trusted full package transport: byte integrity, namespace and legacy boundary."""
import base64
import hashlib

import pytest

from deep_agent_service.skill_packages import package_mount_files


def skill(name="example", files=None):
    files = files or {"SKILL.md": b"---\nname: example\ndescription: test\n---\n", "assets/blob.bin": bytes(range(256))}
    return {"stable_name": name, "name": "Example", "content": "legacy",
            "package": {"skillId": "s1", "versionId": "v1", "files": [
                {"path": path, "contentBase64": base64.b64encode(data).decode(),
                 "mediaType": "application/octet-stream", "digest": hashlib.sha256(data).hexdigest()}
                for path, data in files.items()]}}


def test_preserves_binary_bytes_and_uses_readonly_skill_namespace():
    mounted = package_mount_files([skill()])
    assert mounted[0]["path"] == "/skills/example/SKILL.md"
    assert base64.b64decode(mounted[1]["contentBase64"]) == bytes(range(256))


@pytest.mark.parametrize("mutation", ["digest", "path", "duplicate", "missing_entry", "authority"])
def test_rejects_corrupt_or_ambiguous_packages(mutation):
    value = skill()
    package = value["package"]
    if mutation == "digest":
        package["files"][0]["digest"] = "0" * 64
    elif mutation == "path":
        package["files"][1]["path"] = "../secret"
    elif mutation == "duplicate":
        package["files"].append(package["files"][0])
    elif mutation == "missing_entry":
        package["files"] = package["files"][1:]
    else:
        package["orgId"] = "another-org"
    with pytest.raises(ValueError):
        package_mount_files([value])


@pytest.mark.parametrize("name", ["../other", "/root", "a/b", "a\\b", "", ".."]) 
def test_rejects_namespace_escape(name):
    with pytest.raises(ValueError):
        package_mount_files([skill(name)])


def test_native_mode_does_not_silently_rebuild_legacy_packages():
    with pytest.raises(ValueError, match="complete package"):
        package_mount_files([{"stable_name": "old", "content": "SKILL.md only"}])
    with pytest.raises(ValueError, match="duplicate"):
        package_mount_files([skill(), skill()])
    assert package_mount_files([]) == []
