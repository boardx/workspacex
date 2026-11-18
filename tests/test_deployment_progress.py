"""Only safe structured worker progress crosses the root journal boundary."""
import contextlib
import importlib.util
import io
from pathlib import Path
import subprocess
import threading
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('deploy_progress',ROOT/'scripts/deploy-registry-images.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class WorkerProgress(unittest.TestCase):
    def test_relays_stage_records_but_not_other_journal_content(self):
        stop=threading.Event();output=io.StringIO()
        def journal(*args,**kwargs):
            stop.set()
            return subprocess.CompletedProcess([],0,'sensitive worker stderr\nIMAGE_DEPLOY_STAGE stage=schema-preflight status=started elapsed_seconds=1\n','')
        with patch.object(m.subprocess,'run',side_effect=journal),contextlib.redirect_stderr(output):
            m.relay_progress('wsx-image-cn-test',stop)
        self.assertNotIn('sensitive',output.getvalue());self.assertIn('stage=schema-preflight',output.getvalue())
