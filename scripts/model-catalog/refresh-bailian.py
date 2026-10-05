#!/usr/bin/env python3
"""Refresh a public documentation snapshot, not an authenticated account inventory.

Network is explicit (--fetch). Review the resulting JSON diff before publication.
Only model-table identifiers and short technical facts are retained, never page prose,
examples, credentials, or access permissions. No vendor inference calls are made.
"""
import argparse
import concurrent.futures
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import urllib.request
from datetime import datetime, timezone

BASE = "https://help.aliyun.com/zh/model-studio/"
GUIDES = {
    "text-generation-model": "text-generation", "vision-model": "vision-understanding",
    "image-model": "image-generation", "video-generate-edit-model": "video-generation",
    "tts-model": "speech-synthesis", "asr-model": "speech-recognition",
    "embedding-rerank-model": "embedding", "s2s-model": "speech-to-speech",
    "omni": "text-generation", "fun-music": "music-generation",
    "happyoyster-overview": "world-model", "tripo-3d-generation-guide": "3d-generation",
    "decision-model-preview": "decision", "models": None,
}
MODEL = re.compile(r"MiniMax/speech[A-Za-z0-9_.-]*|(?:xiaomi/)?(?:MiniMax/|Tripo/|ZHIPU/|kimi/)?(?:qwen|qwq|qvq|deepseek|glm|GLM|MiniMax|Moonshot|kimi|mimo|wanx?|z-image|text-embedding|tongyi|gte|cosyvoice|fun-asr|paraformer|gummy|sensevoice|happyhorse|happyoyster|Tripo|decision-model|fun-music)[A-Za-z0-9_.-]*")
MODALITIES = {"文本": "text", "图片": "image", "图像": "image", "音频": "audio", "视频": "video"}
FACT_COLUMNS = {
    "API", "Function Calling", "上下文", "产物最高面数", "内置工具", "向量维度", "声音复刻", "声音设计",
    "大小/时长", "思考模式", "情感识别", "指令控制", "支持语言", "文件大小/时长", "文生图", "最大Token数",
    "最大像素/图", "最大分辨率", "最大图片数", "最大时长", "最大视频大小", "最大视频数", "最大视频时长",
    "最大输出", "最大输出数", "模式", "精度增强", "结构化输出", "编辑", "翻译", "联网搜索", "语言数",
    "说话人分离", "输入", "输入方式", "输出", "输出规格", "速度", "采样率", "音频最大时长/大小", "音频格式",
}



class ModelTables(HTMLParser):
    def __init__(self):
        super().__init__()
        self.scope = ""
        self.heading = None
        self.headers = []
        self.row = None
        self.cell = None
        self.rows = []
        self.table = False
        self.links = []

    def handle_starttag(self, tag, attrs):
        if tag in ("h2", "h3", "h4"):
            self.heading = ""
        if tag == "table":
            self.table = True
            self.headers = []
        if tag == "tr" and self.table:
            self.row = []
        if tag in ("td", "th") and self.row is not None:
            self.cell = ""
        if tag == "a":
            self.links.append(dict(attrs).get("href", ""))

    def handle_data(self, data):
        if self.cell is not None:
            self.cell += data
        if self.heading is not None:
            self.heading += data

    def handle_endtag(self, tag):
        if tag in ("h2", "h3", "h4") and self.heading is not None:
            self.scope = self.heading.strip()
            self.heading = None
        if tag in ("td", "th") and self.cell is not None:
            self.row.append(re.sub(r"\s+", " ", self.cell).strip())
            self.cell = None
        if tag == "tr" and self.row is not None:
            row = self.row
            if row and (row[0].startswith(("模型ID", "模型 ID", "模型名称")) or row[0] == "模型"):
                self.headers = row
            elif self.headers and row:
                self.rows.append((self.scope, self.headers, row))
            self.row = None
        if tag == "table":
            self.table = False


def vendor(model_id):
    lower = model_id.lower()
    for prefix, name in [("deepseek", "DeepSeek"), ("glm", "Zhipu AI"), ("zhipu/", "Zhipu AI"),
                         ("minimax", "MiniMax"), ("kimi", "Moonshot AI"), ("moonshot", "Moonshot AI"),
                         ("mimo", "Xiaomi"), ("xiaomi/", "Xiaomi"), ("tripo", "Tripo")]:
        if lower.startswith(prefix):
            return name
    return "Alibaba"


def context_number(value):
    match = re.fullmatch(r"([\d,.]+)\s*([kKmM]?)", value.strip())
    if not match:
        return None
    return int(float(match[1].replace(",", "")) * {"": 1, "k": 1000, "m": 1000000}[match[2].lower()])


def fetch(slug, directory):
    with urllib.request.urlopen(BASE + slug, timeout=30) as response:
        html = response.read().decode("utf-8")
    scripts = re.findall(r"<script[^>]*>(.*?)</script>", html, re.S)
    script = next(item for item in scripts if "window.__ICE_PAGE_PROPS__=" in item)
    document = json.loads(script.split("window.__ICE_PAGE_PROPS__=", 1)[1].strip().removesuffix(";"))
    data = document["docDetailData"]["storeData"]["data"]
    if not data.get("content"):
        raise ValueError("No document content: " + slug)
    (directory / (slug + ".json")).write_text(json.dumps(data, ensure_ascii=False))


def make_snapshot(directory, observed_at):
    models = {}
    context_values = {}
    sources = []
    for slug, capability in GUIDES.items():
        data = json.loads((directory / (slug + ".json")).read_text())
        content = data["content"]
        source = {"url": BASE + slug, "title": data["title"], "observedAt": observed_at,
                  "contentSha256": hashlib.sha256(content.encode()).hexdigest()}
        sources.append(source)
        parser = ModelTables()
        parser.feed(content)
        rows = parser.rows
        # These guides list IDs in model links/headings instead of model-table rows.
        explicit = {"fun-music": ["fun-music-v1", "fun-music-preview"],
                    "happyoyster-overview": ["happyoyster-1.0-adventure", "happyoyster-1.0-directing", "happyoyster-1.0-acting"],
                    "decision-model-preview": ["decision-model-preview"]}
        if slug in explicit:
            rows += [("模型", ["模型ID"], [model_id]) for model_id in explicit[slug] if model_id in content]
        if slug == "models":
            rows = []
            from urllib.parse import unquote
            for href in parser.links:
                if "bailian.console.aliyun.com" not in href or "/detail/" not in href:
                    continue
                model_id = unquote(href.split("/detail/", 1)[1].split("?", 1)[0])
                rows.append(("模型广场链接", ["模型ID"], [model_id]))
            # This invite-only identifier is published as text, without a console link.
            if "happyoyster-1.0-acting" in content:
                rows.append(("模型目录", ["模型ID"], ["happyoyster-1.0-acting"]))
        for scope, headers, row in rows:
            if "系列" in row[0] or "（" in row[0] and "仅支持" not in row[0]:
                continue  # Family-level audio tables are not individual model identifiers.
            for model_id in dict.fromkeys(MODEL.findall(row[0])):
                if "-" not in model_id or model_id.lower().startswith("qwen-audio-3.x"):
                    continue
                # Public landing-page links add new IDs but cannot invent modality parameters.
                cap = capability
                if cap is None:
                    lower = model_id.lower()
                    if lower.startswith("happyoyster"):
                        cap = "world-model"
                    elif lower.startswith("tripo"):
                        cap = "3d-generation"
                    elif "speech-" in lower or "tts" in lower:
                        cap = "speech-synthesis"
                    elif "asr" in lower:
                        cap = "speech-recognition"
                    elif "embedding" in lower:
                        cap = "embedding"
                    elif "rerank" in lower:
                        cap = "rerank"
                    elif "image" in lower:
                        cap = "image-generation"
                    elif lower.startswith(("wan", "happyhorse")):
                        cap = "video-generation"
                    elif "realtime" in lower:
                        cap = "speech-to-speech"
                    elif lower.startswith("fun-music"):
                        cap = "music-generation"
                    elif lower.startswith("decision"):
                        cap = "decision"
                    else:
                        cap = "text-generation"
                fields = dict(zip(headers[1:], row[1:]))
                if slug == "embedding-rerank-model" and fields.get("类型") == "重排序":
                    cap = "rerank"
                if slug == "image-model" and fields.get("文生图") == "不支持":
                    cap = "image-editing"
                model = models.setdefault(model_id, {
                    "modelId": model_id, "displayName": model_id, "platform": "aliyun-bailian",
                    "originalVendor": vendor(model_id), "capabilities": [], "inputModalities": [],
                    "outputModalities": [], "modalityCoverage": "unknown", "contextWindow": None, "regions": [], "regionCoverage": "unknown",
                    "parameters": [], "parameterCoverage": "published-summary",
                    "billing": {"unit": None, "price": None, "currency": None,
                                "scope": "地域、计费模式与阶梯价格尚待核验，不可用于报价或费用预留。", "sourceUrl": None},
                    "availability": "unknown", "adapterStatus": "requires-configuration-and-verification", "sources": [],
                })
                if cap not in model["capabilities"]:
                    model["capabilities"].append(cap)
                if slug == "image-model" and fields.get("编辑") == "支持" and "image-editing" not in model["capabilities"]:
                    model["capabilities"].append("image-editing")
                if source not in model["sources"]:
                    model["sources"].append(source)
                inputs, outputs = [], []
                # Keep per-model evidence: a category is not proof of every modality.
                if slug == "text-generation-model":
                    inputs, outputs = ["text"], ["text"]
                elif slug == "vision-model":
                    if fields.get("最大像素/图", "--") not in ("--", "-", ""):
                        inputs += ["image"]
                    if fields.get("最大视频时长", "--") not in ("--", "-", ""):
                        inputs += ["video"]
                elif slug == "image-model":
                    if fields.get("文生图") == "支持":
                        inputs += ["text"]
                    if fields.get("编辑") == "支持":
                        inputs += ["text", "image"]
                    outputs = ["image"]
                elif slug in ("tts-model", "asr-model"):
                    # Individually named rows in the synthesis/recognition model matrix.
                    inputs, outputs = (["text"], ["audio"]) if slug == "tts-model" else (["audio"], ["text"])
                elif slug == "embedding-rerank-model":
                    if "文本" in fields.get("类型", "") or "文本" in fields.get("适用场景", ""):
                        inputs = ["text"]
                    outputs = ["structured" if cap == "rerank" else "vector"]
                elif slug == "tripo-3d-generation-guide":
                    support = fields.get("能力支持", "")
                    if "文生3D" in support:
                        inputs += ["text"]
                    if "图生3D" in support:
                        inputs += ["image"]
                    if support:
                        outputs = ["3d"]
                elif slug == "video-generate-edit-model":
                    description = fields.get("类型", "") + fields.get("适用场景", "")
                    if "文生视频" in description:
                        inputs += ["text"]
                    if "图生视频" in description or "首帧" in description:
                        inputs += ["image"]
                    if "MP4" in fields.get("输出规格", "") or "最大分辨率" in fields:
                        outputs = ["video"]
                elif slug == "fun-music":
                    # The guide explicitly names both models and their prompt/lyrics inputs.
                    inputs, outputs = ["text"], ["audio"]
                for direction, current in (("输入", inputs), ("输出", outputs)):
                    if direction in fields:
                        current[:] = [modality for word, modality in MODALITIES.items() if word in fields[direction]]
                for name, values in (("inputModalities", inputs), ("outputModalities", outputs)):
                    model[name] = sorted(set(model[name] + values))
                model["modalityCoverage"] = (
                    "documented" if model["inputModalities"] and model["outputModalities"]
                    else "partial" if model["inputModalities"] or model["outputModalities"] else "unknown"
                )
                if "上下文" in fields:
                    value = context_number(fields["上下文"])
                    if value is not None:
                        context_values.setdefault(model_id, set()).add(value)
                        values = context_values[model_id]
                        model["contextWindow"] = next(iter(values)) if len(values) == 1 else None
                for name, value in fields.items():
                    if name not in FACT_COLUMNS or not value or len(value) > 160:
                        continue
                    fact = {"name": name, "value": value, "scope": scope, "sourceUrl": source["url"]}
                    if fact not in model["parameters"]:
                        model["parameters"].append(fact)
                if model_id == "wanx2.1-imageedit":
                    model["regions"], model["regionCoverage"] = ["cn-beijing"], "documented"
                if slug == "fun-music":
                    model["regions"], model["regionCoverage"] = ["cn-beijing"], "documented"
                if slug == "tts-model" and "按 Token 计费" in scope:
                    model["billing"].update(unit="token", sourceUrl=source["url"], scope="旧版 Qwen-TTS，价格与地域阶梯尚待核验。")
    return {"schemaVersion": 1, "platform": "aliyun-bailian", "observedAt": observed_at,
            "coverage": {"kind": "public-documentation-snapshot", "accountInventoryVerified": False,
                         "allHistoricalVersionsVerified": False, "sources": sources,
                         "notes": ["覆盖公开分类指南列出的模型与明确快照；不代表账号可用模型全量。",
                                   "未逐一核验模型广场中的所有历史版本、地域价格和完整 API 参数；未知值保持空。",
                                   "收录不等于接入、测试通过或启用；Skills 与 workflow 仍使用组织模型准入。"]},
            "models": sorted(models.values(), key=lambda model: model["modelId"].lower())}


def main():
    args = argparse.ArgumentParser(description=__doc__)
    args.add_argument("--sources", type=Path, required=True)
    args.add_argument("--output", type=Path, required=True)
    args.add_argument("--observed-at", default=datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"))
    args.add_argument("--fetch", action="store_true")
    options = args.parse_args()
    if options.fetch:
        options.sources.mkdir(parents=True, exist_ok=True)
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            list(pool.map(lambda slug: fetch(slug, options.sources), GUIDES))
    snapshot = make_snapshot(options.sources, options.observed_at)
    options.output.parent.mkdir(parents=True, exist_ok=True)
    options.output.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"models": len(snapshot["models"]), "sources": len(snapshot["coverage"]["sources"]),
                      "capabilities": sorted(set(cap for model in snapshot["models"] for cap in model["capabilities"]))}))


if __name__ == "__main__":
    main()
