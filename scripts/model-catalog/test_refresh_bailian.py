"""Offline behavior checks for public documentation extraction. No account/network access."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("refresh_bailian", Path(__file__).with_name("refresh-bailian.py"))
refresh = importlib.util.module_from_spec(spec)
spec.loader.exec_module(refresh)


class RefreshCatalogTest(unittest.TestCase):
    def snapshot(self, documents):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            for slug in refresh.GUIDES:
                (directory / (slug + ".json")).write_text(json.dumps({"title": slug, "content": documents.get(slug, "<p>No model table</p>")}))
            return refresh.make_snapshot(directory, "2026-10-05T00:00:00Z")

    def test_model_tables_do_not_import_migration_representatives(self):
        snapshot = self.snapshot({"text-generation-model": """
          <table><tr><th>档位</th><th>闭源模型代表</th><th>推荐</th></tr>
          <tr><td>高能力</td><td>GPT-5.5</td><td>qwen3.8-max</td></tr></table>
          <h2>推荐模型</h2><table><tr><th>模型ID</th><th>上下文</th><th>API Key</th></tr>
          <tr><td>qwen3.8-max查看快照版本qwen3.8-max-0902</td><td>1M</td><td>secret-example</td></tr></table>"""})
        self.assertEqual([m["modelId"] for m in snapshot["models"]], ["qwen3.8-max", "qwen3.8-max-0902"])
        self.assertEqual(snapshot["models"][0]["contextWindow"], 1000000)
        self.assertNotIn("secret-example", json.dumps(snapshot))

    def test_conflicting_context_scopes_remain_unknown(self):
        def table(value):
            return f'<table><tr><th>模型ID</th><th>上下文</th></tr><tr><td>qwen3.8-max</td><td>{value}</td></tr></table>'
        snapshot = self.snapshot({"text-generation-model": table("1M"), "vision-model": table("128k"), "omni": table("1M")})
        model = snapshot["models"][0]
        self.assertIsNone(model["contextWindow"])
        self.assertEqual({p["value"] for p in model["parameters"]}, {"1M", "128k"})
        self.assertEqual(len(model["sources"]), 3)

    def test_namespace_ids_and_unverified_billing_are_preserved(self):
        snapshot = self.snapshot({"tts-model": '<table><tr><th>模型ID</th><th>API</th></tr><tr><td>MiniMax/speech-2.8-hd</td><td>HTTP</td></tr></table>'})
        model = snapshot["models"][0]
        self.assertEqual(model["modelId"], "MiniMax/speech-2.8-hd")
        self.assertEqual(model["originalVendor"], "MiniMax")
        self.assertIsNone(model["billing"]["price"])
        self.assertIsNone(model["billing"]["unit"])
        self.assertEqual(model["availability"], "unknown")
        self.assertEqual(model["regionCoverage"], "unknown")

    def test_vision_category_alone_does_not_prove_video_input(self):
        snapshot = self.snapshot({"vision-model": '<table><tr><th>模型ID</th><th>上下文</th></tr><tr><td>qwen3.8-max</td><td>1M</td></tr></table>'})
        model = snapshot["models"][0]
        self.assertEqual(model["inputModalities"], [])
        self.assertEqual(model["outputModalities"], [])
        self.assertEqual(model["modalityCoverage"], "unknown")

    def test_console_links_are_metadata_without_account_admission(self):
        snapshot = self.snapshot({"models": '<a href="https://bailian.console.aliyun.com/cn-beijing/model/market/detail/ZHIPU%2FGLM-5.3">GLM</a>'})
        model = snapshot["models"][0]
        self.assertEqual(model["modelId"], "ZHIPU/GLM-5.3")
        self.assertEqual(model["originalVendor"], "Zhipu AI")
        self.assertEqual(model["adapterStatus"], "requires-configuration-and-verification")
        self.assertEqual(model["regions"], [])
        self.assertEqual(model["parameters"], [])


if __name__ == "__main__":
    unittest.main()
