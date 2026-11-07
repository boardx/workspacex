"""Private test storage without weakening production's sticky-parent rejection."""
import os
import sys
import tempfile


def private_temporary_directory():
    # Linux root CI must not place a root-authority fixture under sticky /tmp.
    # TemporaryDirectory creates mode 0700 and cleanup remains test-owned.
    base = '/var/lib' if sys.platform == 'linux' and os.geteuid() == 0 else None
    return tempfile.TemporaryDirectory(prefix='wsx-writer-fixture-', dir=base)
