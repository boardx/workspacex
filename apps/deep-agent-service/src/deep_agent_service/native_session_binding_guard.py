"""Re-resolve a trusted binding; reuse gateway source authorization, not a new ACL."""
import asyncio
import json
from pathlib import Path
import time
from jsonschema import Draft7Validator, FormatChecker
from .native_tool_authority import ToolAuthorityError

_SCHEMA=json.loads((Path(__file__).parent/'generated/native_session_binding_schema.json').read_text())
_OUTPUT=Draft7Validator(_SCHEMA['output'],format_checker=FormatChecker())


def _identity(value):
    _OUTPUT.validate(value)
    # The transient token is neither retained nor returned to graph state/logs.
    return json.dumps({key:value[key] for key in ('sessionId','packageDigest','interruptOn')} |
                      {'inputs':sorted(value.get('inputs',[]),key=lambda item:item['path'])},sort_keys=True,separators=(',',':'))


class NativeSessionBindingGuard:
    def __init__(self, expected, resolve_current):
        try:
            self._expected=_identity(expected)
            if not callable(resolve_current):raise ValueError()
            self._resolve=resolve_current
        except Exception:
            raise ToolAuthorityError('Invalid trusted native binding guard') from None

    async def acheck(self):
        try:
            current=await self._resolve()
            if _identity(current)!=self._expected or current['expiresAt']<=time.time()*1000:
                raise ValueError()
        except Exception:
            raise ToolAuthorityError('Native binding or current sources unavailable; result refused') from None

    def check(self):
        try:
            asyncio.get_running_loop()
        except RuntimeError:
            return asyncio.run(self.acheck())
        raise ToolAuthorityError('Use asynchronous binding checks inside an active event loop')
