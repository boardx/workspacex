"""Validate trusted pinned packages before mounting them in the native backend.

Structural rules come from @repo/contracts. Integrity and aggregate byte checks
are deliberately performed here too: transport is trusted, contents are not.
No package body or asset is copied into model messages by this module.
"""
from __future__ import annotations

import base64
import hashlib
import json
import re
from pathlib import Path
from typing import Any

from jsonschema import Draft7Validator

_SCHEMA = json.loads((Path(__file__).parent / "generated/standard_capabilities_schema.json").read_text())
_VALIDATOR = Draft7Validator(_SCHEMA["package"])
_LIMITS = _SCHEMA["limits"]


def package_mount_files(skills: list[dict[str, Any]]) -> list[dict[str, str]]:
    """Return validated /skills/<stable_name> files for one trusted run.

    Native mode requires full packages. Callers explicitly select the legacy
    runtime for legacy snapshots, rather than silently losing scripts/assets.
    """
    mounted: list[dict[str, str]] = []
    names: set[str] = set()
    total = 0
    for skill in skills:
        name = skill.get("stable_name")
        if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,159}", name):
            raise ValueError("invalid skill namespace")
        if name in names:
            raise ValueError("duplicate skill namespace")
        names.add(name)
        package = skill.get("package")
        if not isinstance(package, dict):
            raise ValueError("native execution requires a complete package")
        if not _VALIDATOR.is_valid(package):
            raise ValueError("invalid skill package manifest")
        paths: set[str] = set()
        for file in package["files"]:
            path = file["path"]
            if path in paths:
                raise ValueError("duplicate skill file")
            paths.add(path)
            content = file["contentBase64"]
            data = base64.b64decode(content, validate=True)
            if base64.b64encode(data).decode("ascii") != content:
                raise ValueError("noncanonical skill encoding")
            if len(data) > _LIMITS["maxFileBytes"] or hashlib.sha256(data).hexdigest() != file["digest"]:
                raise ValueError("skill file integrity check failed")
            total += len(data)
            if total > _LIMITS["maxPackageBytes"] or len(mounted) >= _LIMITS["maxFiles"]:
                raise ValueError("mounted skill set exceeds session limit")
            if path == "SKILL.md":
                try:
                    data.decode("utf-8", errors="strict")
                except UnicodeDecodeError as error:
                    raise ValueError("SKILL.md must be UTF-8") from error
            mounted.append({"path": f"/skills/{name}/{path}", "contentBase64": content})
        if "SKILL.md" not in paths:
            raise ValueError("SKILL.md required")
    return mounted
