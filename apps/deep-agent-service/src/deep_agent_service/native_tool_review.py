"""Checkpoint the exact calls actually approved by the official HITL middleware."""
import json
from contextvars import ContextVar
from typing import Annotated
from typing_extensions import NotRequired
from langchain.agents.middleware import HumanInTheLoopMiddleware
from langchain.agents.middleware.types import AgentState, PrivateStateAttr

class NativeToolReviewState(AgentState):
    native_hitl_reviewed_calls: NotRequired[Annotated[list[str], PrivateStateAttr]]

_processed_reviews: ContextVar[list[str] | None] = ContextVar('native_processed_reviews', default=None)

def call_identity(call):
    return json.dumps({key: call.get(key) for key in ('id', 'name', 'args')}, sort_keys=True, separators=(',', ':'))

def reviewed_by_hitl(request):
    state = getattr(request, 'state', None)
    return isinstance(state, dict) and call_identity(request.tool_call) in state.get('native_hitl_reviewed_calls', [])

class NativeHumanInTheLoop(HumanInTheLoopMiddleware):
    state_schema = NativeToolReviewState

    # Private upstream adapter point: real graph contract tests pin approve/edit/reject/respond.
    def _process_decision(self, decision, tool_call, config):
        call, message = super()._process_decision(decision, tool_call, config)
        processed = _processed_reviews.get()
        if processed is not None and call is not None and message is None and decision['type'] in ('approve', 'edit'):
            processed.append(call_identity(call))
        return call, message

    def after_model(self, state, runtime):
        # Scope collection to this graph task; no process-wide approval cache.
        processed = []
        token = _processed_reviews.set(processed)
        try:
            update = super().after_model(state, runtime)
            # Replace on every model turn, including turns with no review.
            return {**(update or {}), 'native_hitl_reviewed_calls': processed}
        finally:
            _processed_reviews.reset(token)
