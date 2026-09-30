#!/usr/bin/env python3
"""Count release processes outside our live ancestry (Linux /proc only)."""
import os
import re
from pathlib import Path

def orphan_pids(records, self_pid):
    ancestry = set()
    current = self_pid
    while current in records and current not in ancestry:
        ancestry.add(current)
        current = records[current][0]
    pattern = re.compile(r"publish-cn-release|docker buildx build|workspacex-cn-deploy|workspacex-cn-build-candidate")
    return [pid for pid, (_, command) in records.items() if pid not in ancestry and pattern.search(command)]

def main():
    records = {}
    for directory in Path("/proc").iterdir():
        if not directory.name.isdigit(): continue
        try:
            # comm can contain spaces/parentheses; fields begin after final ')'.
            stat = (directory / "stat").read_text().rsplit(")", 1)[1].split()
            command = (directory / "cmdline").read_bytes().replace(b"\0", b" ").decode("utf-8", "replace")
            records[int(directory.name)] = (int(stat[1]), command)
        except FileNotFoundError: continue  # normal exited-process race
    print(len(orphan_pids(records, os.getpid())))

if __name__ == "__main__": main()
