"""A persisted binding's policy keys bound model visibility and tool dispatch."""
from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import ToolMessage
from .native_tool_authority import ToolAuthorityError


class NativeToolSnapshot(AgentMiddleware):
    def __init__(self, names, authority):
        self.names = frozenset(names)
        self.authority = authority
        self.registered = None

    def validate(self, registered):
        if not self.names <= set(registered):
            raise ToolAuthorityError('Persisted native tool snapshot contains an unavailable tool')
        self.registered = frozenset(registered)

    def _request(self, request):
        def name(tool):
            if isinstance(tool, dict):
                return tool.get('name') or tool.get('function', {}).get('name')
            return tool.name
        return request.override(tools=[tool for tool in request.tools if name(tool) in self.names])

    def wrap_model_call(self, request, handler):
        return handler(self._request(request))

    async def awrap_model_call(self, request, handler):
        return await handler(self._request(request))

    def _allow(self, call):
        if call.get('name') not in self.names:
            raise ToolAuthorityError('Tool is outside the persisted native snapshot')

    def check(self, call):
        self._allow(call)
        return self.authority.check(call)

    async def acheck(self, call):
        self._allow(call)
        return await self.authority.acheck(call)

    def _unknown_tool_result(self, request):
        # An invented name has no executable handler. Refuse it before authority
        # or sandbox dispatch, but let the model correct its call (issue #4869).
        # A real handler outside the snapshot remains an authorization violation.
        if self.registered is None:
            raise ToolAuthorityError('Native tool registry not validated')
        call = request.tool_call
        if call.get('name') in self.registered:
            return None
        return ToolMessage(
            content=("This is not a registered tool; nothing was executed. "
                     "A skill name is not a callable tool. Read the skill's SKILL.md "
                     "with read_file when available, then use its documented tool and schema. "
                     "Available tools: " + ", ".join(sorted(self.names))),
            tool_call_id=call['id'], name=call.get('name'), status='error')

    def wrap_tool_call(self, request, handler):
        result = self._unknown_tool_result(request)
        return result if result is not None else handler(request)

    async def awrap_tool_call(self, request, handler):
        result = self._unknown_tool_result(request)
        return result if result is not None else await handler(request)
