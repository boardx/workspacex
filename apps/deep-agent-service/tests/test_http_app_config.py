import importlib
import importlib.util
import json
from pathlib import Path

from starlette.applications import Starlette


def test_configured_http_app_loads_with_langgraph_import_semantics():
    service_root = Path(__file__).parents[1]
    config = json.loads((service_root / "langgraph.json").read_text())
    target, attribute = config["http"]["app"].rsplit(":", 1)

    if target.endswith(".py"):
        spec = importlib.util.spec_from_file_location(
            "user_router_module", service_root / target
        )
        assert spec is not None and spec.loader is not None
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
    else:
        module = importlib.import_module(target)

    assert isinstance(getattr(module, attribute), Starlette)
