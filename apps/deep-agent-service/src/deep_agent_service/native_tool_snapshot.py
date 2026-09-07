"""A persisted binding's policy keys bound model visibility and tool dispatch."""
from langchain.agents.middleware import AgentMiddleware
from .native_tool_authority import ToolAuthorityError


class NativeToolSnapshot(AgentMiddleware):
    def __init__(self, names, authority):
        self.names = frozenset(names)
        self.authority = authority

    def validate(self, registered):
        if not self.names <= set(registered):
            raise ToolAuthorityError('Persisted native tool snapshot contains an unavailable tool')

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
