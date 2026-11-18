"""Exercise real subprocess output: progress must appear before process completion."""
import contextlib
import importlib.util
import io
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('registry_progress',ROOT/'scripts/registry-images.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class Progress(unittest.TestCase):
    def test_streams_redacted_output_before_exit_and_retains_push_digest(self):
        with tempfile.TemporaryDirectory() as tmp:
            done=Path(tmp)/'done'; observations=[]
            class Capture(io.StringIO):
                def write(self,text):
                    if 'layer uploaded' in text: observations.append(done.exists())
                    return super().write(text)
            output=Capture()
            script="import pathlib,time; print('layer uploaded secret-password',flush=True); time.sleep(.5); pathlib.Path("+repr(str(done))+").touch(); print('digest: sha256:'+'a'*64,flush=True)"
            with patch.dict(os.environ,{'ACR_PASSWORD':'secret-password'}),contextlib.redirect_stdout(output):
                result=m.run_release_stage('web','push',[sys.executable,'-c',script],3)
            self.assertEqual(observations,[False]);self.assertNotIn('secret-password',output.getvalue())
            self.assertIn('digest: sha256:',result)
            self.assertIn('status=completed elapsed_seconds=',output.getvalue())

    def test_timeout_reports_stage_and_does_not_mark_complete(self):
        output=io.StringIO()
        with contextlib.redirect_stdout(output):
            with self.assertRaisesRegex(ValueError,'BUILD_TIMEOUT_WEB'):
                m.run_release_stage('web','build',[sys.executable,'-c','import time; time.sleep(5)'],.1)
        self.assertIn('status=failed code=timeout',output.getvalue())
        self.assertNotIn('status=completed',output.getvalue())

    def test_failed_child_keeps_nonzero_status_and_diagnostics(self):
        output=io.StringIO()
        with contextlib.redirect_stdout(output):
            with self.assertRaisesRegex(ValueError,'COMMAND_FAILED'):
                m.run_release_stage('web','push',[sys.executable,'-c',"import sys; print('push denied',flush=True); sys.exit(2)"],3)
        self.assertIn('push denied',output.getvalue());self.assertIn('status=failed',output.getvalue())

    def test_legacy_switch_does_not_change_new_tag_format(self):
        self.assertEqual(m.release_tag('a'*40,'44217491801','1',True),'44217491801-1')
        self.assertEqual(m.release_tag('a'*40,'44217491801','2',False),'44217491801-2')
        m.coordinates('registry.example/team','44217491801-90000000000000000001')
