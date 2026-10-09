#!/usr/bin/env python3
"""Offline input consistency only; never authenticates registration or authorizes execution."""
import argparse
import json
import re
import subprocess
import sys

SHA = re.compile(r'^[0-9a-f]{40}$')


def dispatch_only(text):
    """Recognize only the current simple dispatch mapping, rejecting ambiguity."""
    lines = text.splitlines()
    # Do not accept comments, inline forms, quoted/anchored keys, or a dispatch
    # string inside job commands. This deliberately supports a narrow spelling.
    ons = [i for i, line in enumerate(lines) if line == 'on:']
    if len(ons) != 1:
        return False
    start = ons[0] + 1
    events = []
    for line in lines[start:]:
        if line and not line[0].isspace() and not line.startswith('#'):
            break
        if not line.strip() or line.lstrip().startswith('#'):
            continue
        match = re.fullmatch(r'  ([a-z_]+):', line)
        if match:
            events.append(match.group(1))
        elif not line.startswith('    '):
            return False
    return events == ['workflow_dispatch']


def verify(facts, git):
    if set(facts) != {'repository', 'observedMain', 'controlRevision', 'sourceRevision', 'prepareState', 'pr'}:
        raise ValueError('REGISTRATION_SCHEMA')
    if facts['repository'] != 'boardx/workspacex' or any(not SHA.fullmatch(facts[k]) for k in ('observedMain', 'controlRevision', 'sourceRevision')):
        raise ValueError('REGISTRATION_IDENTITY')
    blockers = []
    if facts['prepareState'] != 'disabled_manually':
        blockers.append('LEGACY_PREPARE_NOT_DISABLED')
    pr = facts['pr']
    if set(pr) != {'number', 'state', 'draft', 'head', 'merged', 'mergeCommit'} or type(pr['number']) is not int or pr['number'] != 5512 or not SHA.fullmatch(pr['head']) or type(pr['draft']) is not bool or type(pr['merged']) is not bool:
        raise ValueError('REGISTRATION_PR_SCHEMA')
    if not pr['merged'] or pr['state'] != 'closed':
        blockers.append('CONTROL_PR_NOT_MERGED')
    if pr['draft']:
        blockers.append('CONTROL_PR_STILL_DRAFT')
    if pr['mergeCommit'] != facts['controlRevision']:
        blockers.append('CONTROL_NOT_EXACT_MERGE_COMMIT')
    if facts['controlRevision'] != facts['observedMain']:
        blockers.append('CONTROL_NOT_CURRENT_MAIN')
    try:
        for key in ('observedMain', 'controlRevision', 'sourceRevision'):
            git(['cat-file', '-e', facts[key] + '^{commit}'])
        git(['merge-base', '--is-ancestor', facts['sourceRevision'], facts['controlRevision']])
        text = git(['show', facts['controlRevision'] + ':.github/workflows/export-cn-image-archives.yml'])
        # Necessary registration identity, not a replacement for workflow/security review.
        if not dispatch_only(text):
            blockers.append('CONTROL_EXPORT_ENTRY_UNPROVEN')
    except (OSError, subprocess.SubprocessError):
        blockers.append('COMMIT_OR_ANCESTRY_PROOF_UNAVAILABLE')
    return {'schemaVersion': 1, 'evidenceClass': 'OFFLINE_INPUT_CONSISTENCY', 'ready': False,
            'inputConsistent': not blockers, 'registrationCandidate': not blockers, 'blockers': blockers,
            'sourceRevision': facts['sourceRevision'], 'controlRevision': facts['controlRevision'],
            'observedMain': facts['observedMain'], 'productionAuthorized': False,
            'limitations': ['caller-supplied facts are unauthenticated and freshness is not established', 'registrationCandidate describes consistent offline inputs only; not actual registration', 'does not prove CI, external hooks, DevApp identity, plan inputs or production readiness']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('facts', help='offline snapshot JSON; not authenticated or freshness verified; no credentials')
    args = parser.parse_args()
    def git(argv):
        return subprocess.check_output(['git', *argv], text=True, stderr=subprocess.DEVNULL, timeout=10)
    with open(args.facts, encoding='utf8') as file:
        result = verify(json.load(file), git)
    print(json.dumps(result, sort_keys=True))
    return 0 if result['inputConsistent'] else 2


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, TypeError, KeyError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
