import json
import unittest
from pathlib import Path
from runtime_audit import audit

class RuntimeAuditTests(unittest.TestCase):
    def test_exact_source_full_scan_is_reproducible_and_gaps_preserved(self):
        saved=json.loads(Path(__file__).with_name('runtime-reference-audit.json').read_text())
        self.assertEqual(saved, audit())
        self.assertFalse(saved['complete'])
        self.assertFalse(saved['ready'])
        self.assertGreater(saved['coverage']['scannedFileCount'], saved['coverage']['matchedFileCount'])
        kinds={finding['kind'] for finding in saved['semanticFindings']}
        self.assertTrue({'extracted_markdown','gc_history','pending_output_json',
                         'image_generation_durable_objects','audio_generation_durable_objects',
                         'secondary_backup_store','vfs_indirect_uri','export_url_and_manifest'}.issubset(kinds))
        self.assertTrue(saved['remainingGaps'])
        self.assertTrue(saved['missingMetadataRecovery']['canObserveInitialSnapshotBytes'])
        self.assertFalse(saved['missingMetadataRecovery']['ready'])

if __name__=='__main__': unittest.main()
