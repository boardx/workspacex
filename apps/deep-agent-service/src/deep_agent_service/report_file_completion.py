"""Recognize only host-issued report completion receipts, never model prose or filenames."""
import json
from pathlib import Path
from jsonschema import Draft7Validator, FormatChecker
from langchain_core.messages import AIMessage, ToolMessage

_SCHEMA=json.loads((Path(__file__).parent/'generated/native_artifact_schema.json').read_text())
_RECEIPT=Draft7Validator(_SCHEMA['output'],format_checker=FormatChecker())
POST_PUBLISH_TOOLS=frozenset(_SCHEMA['postPublishTools'])

def published_report(messages):
    calls={}
    for message in messages:
        if isinstance(message,AIMessage):
            calls.update({call['id']:call.get('name') for call in message.tool_calls})
        if not isinstance(message,ToolMessage) or message.status=='error' or message.name!=_SCHEMA['toolName'] or calls.get(message.tool_call_id)!=_SCHEMA['toolName']:
            continue
        try:
            value=json.loads(message.content)
            if _RECEIPT.is_valid(value) and value.get('completion'):
                return value['completion']['jobId']
        except (ValueError,TypeError):
            pass
    return None
