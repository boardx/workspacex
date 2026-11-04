"""Preserve our typed admission refusal after the SDK wraps transport exceptions."""
from langchain_openai import ChatOpenAI
from .model_request_accounting import CreditRuntimeUsageError


def rethrow_credit_failure(error):
    seen = set()
    cause = error
    while isinstance(cause, BaseException) and id(cause) not in seen:
        seen.add(id(cause))
        if isinstance(cause, CreditRuntimeUsageError):
            raise cause from None
        cause = cause.__cause__


class CreditAwareChatOpenAI(ChatOpenAI):
    # The HTTP transport rejects before vendor dispatch. OpenAI wraps that error as
    # APIConnectionError; LangGraph must receive the original dedicated error class.
    # Provider text never participates in this classification.
    def _generate(self, *args, **kwargs):
        try:
            return super()._generate(*args, **kwargs)
        except Exception as error:
            rethrow_credit_failure(error)
            raise

    async def _agenerate(self, *args, **kwargs):
        try:
            return await super()._agenerate(*args, **kwargs)
        except Exception as error:
            rethrow_credit_failure(error)
            raise

    def _stream(self, *args, **kwargs):
        try:
            yield from super()._stream(*args, **kwargs)
        except Exception as error:
            rethrow_credit_failure(error)
            raise

    async def _astream(self, *args, **kwargs):
        try:
            async for chunk in super()._astream(*args, **kwargs):
                yield chunk
        except Exception as error:
            rethrow_credit_failure(error)
            raise
