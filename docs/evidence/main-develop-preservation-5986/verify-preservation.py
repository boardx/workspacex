"""Read-only merge preservation audit; use --revision for committed evidence."""
import argparse
import json
from pathlib import Path
import subprocess


def git(*args):
    return subprocess.check_output(["git", *args])


def tree(revision):
    result = {}
    for entry in git("ls-tree", "-rz", revision).split(b"\0"):
        if not entry:
            continue
        metadata, path = entry.split(b"\t", 1)
        mode, kind, oid = metadata.decode().split()
        result[path.decode()] = (mode, kind, oid)
    return result


def changed(base, revision):
    return set(git("diff", "--no-renames", "--name-only", "-z", base, revision).decode().strip("\0").split("\0")) - {""}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--revision", default="HEAD")
    parser.add_argument("--worktree", action="store_true")
    args = parser.parse_args()
    baseline = json.loads(Path(__file__).with_name("baselines.json").read_text())
    base = git("merge-base", baseline["main"], baseline["develop"]).decode().strip()
    sources = {name: tree(baseline[name]) for name in ("main", "develop")}
    changes = {name: changed(base, baseline[name]) for name in sources}
    actual = tree(args.revision)
    original = tree(base)
    root = Path(git("rev-parse", "--show-toplevel").decode().strip())
    errors = []
    counts = {}
    fixes = baseline.get("additionalTestFixes", {})
    for side, other in (("main", "develop"), ("develop", "main")):
        paths = changes[side] - changes[other]
        counts[side + "Only"] = len(paths)
        for path in sorted(paths):
            expected = sources[side].get(path)
            if args.worktree:
                file = root / path
                oid = git("hash-object", str(file)).decode().strip() if file.is_file() else None
                if oid != (expected[2] if expected else None):
                    errors.append(path)
            elif actual.get(path) != expected:
                errors.append(path)
    overlap = changes["main"] & changes["develop"]
    if overlap != set(baseline["conflictResolution"]):
        errors.append("unreviewed overlap: " + repr(sorted(overlap)))
    for path, side in baseline["conflictResolution"].items():
        expected = sources[side][path]
        if args.worktree:
            if git("hash-object", str(root / path)).decode().strip() != expected[2]:
                errors.append("conflict resolution: " + path)
        elif actual.get(path) != expected:
            errors.append("conflict resolution: " + path)
    for path, fix in fixes.items():
        if path in changes["main"] | changes["develop"] or not path.startswith("apps/web/tests/"):
            errors.append("invalid test-only exception: " + path)
            continue
        expected = (*sources["develop"][path][:2], fix["blob"])
        if args.worktree:
            if git("hash-object", str(root / path)).decode().strip() != expected[2]:
                errors.append("reviewed test fix: " + path)
        elif actual.get(path) != expected:
            errors.append("reviewed test fix: " + path)
    if not args.worktree:
        untouched = set(original) - changes["main"] - changes["develop"] - set(fixes)
        counts["unchangedBaseFiles"] = len(untouched)
        for path in sorted(untouched):
            if actual.get(path) != original[path]:
                errors.append("unexpected modification: " + path)
        evidence_prefix = str(Path(__file__).resolve().parent.relative_to(root)) + "/"
        for path in sorted(set(actual) - set(sources["main"]) - set(sources["develop"])):
            if not path.startswith(evidence_prefix):
                errors.append("unexpected addition: " + path)
        for side in sources:
            if subprocess.run(["git", "merge-base", "--is-ancestor", baseline[side], args.revision]).returncode:
                errors.append("missing ancestor: " + side)
    print(json.dumps({"revision": args.revision, "worktree": args.worktree, **counts,
                      "reviewedOverlap": len(overlap), "reviewedTestFixes": len(fixes),
                      "errors": errors}, ensure_ascii=False, indent=2))
    raise SystemExit(1 if errors else 0)


if __name__ == "__main__":
    main()
