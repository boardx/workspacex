#!/usr/bin/env python3
"""Offline platform catalog admission/planning. No database/network/write executor."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import sys

KINDS = {"agent", "skill", "workflow"}
SHA = re.compile(r"[a-f0-9]{64}\Z")
REV = re.compile(r"[a-f0-9]{40}\Z")
TOKEN = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}\Z")


class Rejected(Exception):
    def __init__(self, code):
        self.code = code


def require(ok, code):
    if not ok:
        raise Rejected(code)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False,
                      separators=(",", ":"), allow_nan=False).encode("utf-8")


def no_duplicate_keys(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "JSON_DUPLICATE_KEY")
        result[key] = value
    return result


def load_bound(path, expected):
    require(isinstance(expected, str) and SHA.fullmatch(expected), "INVALID_RAW_SHA")
    data = Path(path).read_bytes()
    require(len(data) <= 8 * 1024 * 1024, "INPUT_TOO_LARGE")
    require(digest(data) == expected, "RAW_SHA_MISMATCH")
    try:
        return json.loads(data, object_pairs_hook=no_duplicate_keys,
                          parse_constant=lambda _: (_ for _ in ()).throw(Rejected("INVALID_JSON")))
    except (ValueError, UnicodeError):
        raise Rejected("INVALID_JSON") from None


def coordinate(value):
    require(isinstance(value, dict), "INVALID_COORDINATE")
    require(value.get("kind") in KINDS, "INVALID_KIND")
    require(isinstance(value.get("key"), str) and TOKEN.fullmatch(value["key"]), "INVALID_KEY")
    require(isinstance(value.get("version"), str) and TOKEN.fullmatch(value["version"]), "INVALID_VERSION")
    return (value["kind"], value["key"], value["version"])


def checked_sha(value, code):
    require(isinstance(value, str) and SHA.fullmatch(value), code)


def closure_digest(entities):
    rows = [{k: e[k] for k in ("kind", "key", "version", "contentDigest")} for e in entities]
    return digest(canonical(sorted(rows, key=lambda e: coordinate(e))))


def artifact_bytes(root, relative):
    require(isinstance(relative, str) and relative and "\\" not in relative and "\x00" not in relative,
            "UNSAFE_ARTIFACT_PATH")
    parts = relative.split("/")
    require(not PurePosixPath(relative).is_absolute() and all(p not in ("", ".", "..") for p in parts),
            "UNSAFE_ARTIFACT_PATH")
    base = Path(root).resolve(strict=True)
    current = base
    for part in parts:
        current = current / part
        require(not current.is_symlink(), "ARTIFACT_SYMLINK")
    require(current.is_file() and current.resolve().is_relative_to(base), "ARTIFACT_MISSING")
    require(current.stat().st_size <= 32 * 1024 * 1024, "ARTIFACT_TOO_LARGE")
    return current.read_bytes()


def dependency_order(by_id):
    visiting, done, ordered = set(), set(), []

    def visit(key):
        require(key not in visiting, "DEPENDENCY_CYCLE")
        if key in done:
            return
        visiting.add(key)
        for ref in sorted(coordinate(x) for x in by_id[key]["dependencies"]):
            require(ref in by_id, "DEPENDENCY_MISSING")
            visit(ref)
        visiting.remove(key)
        done.add(key)
        ordered.append(key)

    for key in sorted(by_id):
        visit(key)
    return ordered


def admit(manifest, source, reviewed_closure, bundle_root):
    require(isinstance(manifest, dict) and type(manifest.get("schemaVersion")) is int
            and manifest["schemaVersion"] == 1, "MANIFEST_SCHEMA")
    require(isinstance(source, str) and REV.fullmatch(source)
            and manifest.get("sourceRevision") == source, "SOURCE_MISMATCH")
    require(isinstance(manifest.get("controlRevision"), str)
            and REV.fullmatch(manifest["controlRevision"]), "CONTROL_REVISION_INVALID")
    checked_sha(manifest.get("sourceArtifactSha256"), "SOURCE_ARTIFACT_SHA_INVALID")
    require(manifest.get("targetOrgId") == "org-platform", "TARGET_SCOPE_INVALID")
    scope = manifest.get("acceptanceScope")
    require(scope in ("full-catalog", "mvp-non-model"), "ACCEPTANCE_SCOPE_INVALID")
    require(manifest.get("catalogVersion") == ("v2" if scope == "full-catalog" else "implemented-mvp"),
            "CATALOG_SCOPE_INVALID")
    if scope == "mvp-non-model":
        require(manifest.get("skippedTests") == ["real-model", "ai-output-quality"]
                and manifest.get("notApplicableContents") == ["future-catalog-v2"], "MVP_EXCLUSIONS_REQUIRED")
    require(isinstance(manifest.get("releaseId"), str) and TOKEN.fullmatch(manifest["releaseId"]),
            "RELEASE_ID_INVALID")
    entities = manifest.get("entities")
    require(isinstance(entities, list) and 0 < len(entities) <= 2000, "ENTITY_LIST_INVALID")
    by_id = {}
    for e in entities:
        key = coordinate(e)
        require(key not in by_id, "DUPLICATE_ENTITY")
        checked_sha(e.get("contentDigest"), "CONTENT_DIGEST_INVALID")
        checked_sha(e.get("artifactSha256"), "ARTIFACT_SHA_INVALID")
        require(digest(artifact_bytes(bundle_root, e.get("artifactPath"))) == e["artifactSha256"],
                "ARTIFACT_SHA_MISMATCH")
        require(isinstance(e.get("dependencies"), list), "DEPENDENCIES_INVALID")
        refs = [coordinate(x) for x in e["dependencies"]]
        require(len(refs) == len(set(refs)), "DUPLICATE_DEPENDENCY")
        legacy = e.get("legacyAdoption")
        if legacy is not None:
            require(e["kind"] == "agent" and isinstance(legacy, dict), "LEGACY_ADOPTION_INVALID")
            require(isinstance(legacy.get("fromVersion"), str) and TOKEN.fullmatch(legacy["fromVersion"]),
                    "LEGACY_ADOPTION_INVALID")
            checked_sha(legacy.get("fromDigest"), "LEGACY_ADOPTION_INVALID")
            checked_sha(legacy.get("expectedStateDigest"), "LEGACY_ADOPTION_INVALID")
        by_id[key] = e
    counts = manifest.get("expectedCounts")
    actual = Counter(e["kind"] for e in entities)
    require(isinstance(counts, dict) and set(counts) == KINDS and
            all(type(counts[k]) is int and counts[k] > 0 and counts[k] == actual[k] for k in KINDS),
            "CATALOG_COUNT_MISMATCH")
    checked_sha(reviewed_closure, "REVIEWED_CLOSURE_INVALID")
    require(manifest.get("catalogClosureSha256") == reviewed_closure == closure_digest(entities),
            "CATALOG_CLOSURE_MISMATCH")
    order = dependency_order(by_id)
    tests = manifest.get("requiredTests")
    require(isinstance(tests, list), "TEST_REQUIREMENTS_MISSING")
    ids, coverage = set(), set()
    for test in tests:
        require(isinstance(test, dict) and isinstance(test.get("id"), str)
                and TOKEN.fullmatch(test["id"]) and test["id"] not in ids, "TEST_ID_INVALID")
        key = coordinate(test.get("entity"))
        require(key in by_id, "TEST_ENTITY_INVALID")
        gate = test.get("gate")
        require(gate in ("G0", "G1", "G2", "business", "content-readback"), "TEST_GATE_INVALID")
        require((key, gate) not in coverage, "DUPLICATE_TEST_COVERAGE")
        ids.add(test["id"])
        coverage.add((key, gate))
    for key in by_id:
        gates = (("G0", "G1", "G2") if key[0] == "skill" else ("business",)) if scope == "full-catalog" else ("content-readback",)
        require(all((key, gate) in coverage for gate in gates), "REQUIRED_TEST_COVERAGE_MISSING")
    return by_id, order


def plan(manifest, by_id, order, inventory):
    require(isinstance(inventory, dict) and type(inventory.get("schemaVersion")) is int
            and inventory["schemaVersion"] == 1, "INVENTORY_SCHEMA")
    require(inventory.get("targetOrgId") == manifest["targetOrgId"], "INVENTORY_SCOPE_MISMATCH")
    require(isinstance(inventory.get("observedAt"), str), "INVENTORY_TIME_MISSING")
    rows = inventory.get("entities")
    require(isinstance(rows, list), "INVENTORY_ROWS_INVALID")
    existing, names = {}, {}
    for row in rows:
        key = coordinate(row)
        require(row.get("orgId") == "org-platform", "TENANT_ROW_REJECTED")
        require(row.get("origin") in ("official", "custom"), "INVENTORY_ORIGIN_INVALID")
        require(row.get("status") in ("published", "retired"), "INVENTORY_STATUS_INVALID")
        checked_sha(row.get("contentDigest"), "INVENTORY_DIGEST_INVALID")
        checked_sha(row.get("stateDigest"), "INVENTORY_STATE_INVALID")
        require(key not in existing, "INVENTORY_DUPLICATE")
        existing[key] = row
        names.setdefault(key[:2], []).append(row)
    operations = []
    for key in order:
        target = by_id[key]
        current = existing.get(key)
        named = names.get(key[:2], [])
        require(not any(x["origin"] == "custom" for x in named), "CUSTOM_CONTENT_CONFLICT")
        if current:
            require(current["contentDigest"] == target["contentDigest"], "IMMUTABLE_VERSION_CONFLICT")
            require(current["status"] == "published", "TARGET_VERSION_RETIRED")
            action, expected_state = "reuse", current["stateDigest"]
        elif target.get("legacyAdoption"):
            legacy = target["legacyAdoption"]
            old = existing.get((key[0], key[1], legacy["fromVersion"]))
            require(old is not None and old["origin"] == "official"
                    and old["status"] == "published" and old["contentDigest"] == legacy["fromDigest"]
                    and old["stateDigest"] == legacy["expectedStateDigest"], "LEGACY_CAS_MISMATCH")
            action, expected_state = "append-legacy-compatible", old["stateDigest"]
        else:
            require(not named or key[0] != "agent", "AGENT_LEGACY_ADOPTION_REQUIRED")
            action, expected_state = ("append" if named else "create"), None
        operations.append({"entity": {"kind": key[0], "key": key[1], "version": key[2]},
                           "contentDigest": target["contentDigest"], "action": action,
                           "expectedStateDigest": expected_state})
    return {"schemaVersion": 1, "operation": "plan", "sourceRevision": manifest["sourceRevision"],
            "releaseId": manifest["releaseId"], "targetOrgId": "org-platform",
            "catalogClosureSha256": manifest["catalogClosureSha256"], "acceptanceScope": manifest["acceptanceScope"], "operations": operations,
            "planSha256": digest(canonical(operations)), "productionWrites": False,
            "executionReady": False, "businessAccepted": False,
            "remainingExecutionGates": ["verified-source-and-adapter", "fresh-live-inventory-and-CAS",
                                        "backup", "approval-binding", "skill-gates", "independent-readback",
                                        "per-entity-business-evidence"]}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("validate", "plan"))
    for flag in ("manifest", "manifest-sha256", "source", "catalog-sha256", "bundle-root"):
        parser.add_argument("--" + flag, required=True)
    parser.add_argument("--inventory")
    parser.add_argument("--inventory-sha256")
    args = parser.parse_args(argv)
    try:
        manifest = load_bound(args.manifest, args.manifest_sha256)
        by_id, order = admit(manifest, args.source, args.catalog_sha256, args.bundle_root)
        if args.operation == "plan":
            require(args.inventory is not None and args.inventory_sha256 is not None, "INVENTORY_REQUIRED")
            result = plan(manifest, by_id, order, load_bound(args.inventory, args.inventory_sha256))
        else:
            result = {"schemaVersion": 1, "operation": "validate", "manifestAdmitted": True,
                      "sourceRevision": args.source, "entityCount": len(by_id),
                      "productionWrites": False, "executionReady": False, "businessAccepted": False}
        print(json.dumps(result, sort_keys=True, separators=(",", ":")))
        return 0
    except Rejected as e:
        print(json.dumps({"ok": False, "code": e.code, "productionWrites": False}, sort_keys=True))
        return 20
    except (OSError, TypeError, KeyError, RecursionError, ValueError):
        print('{"code":"LOCAL_INPUT_FAILURE","ok":false,"productionWrites":false}')
        return 70


if __name__ == "__main__":
    sys.exit(main())
