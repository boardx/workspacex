"""Official LangChain embeddings behind the existing infrastructure secret boundary."""
import asyncio
import hmac
import json
import math
import os
import time
from pathlib import Path
import httpx
from .model_request_accounting import AsyncAccountingTransport, retrieval_accounting_scope, admission_enabled
from jsonschema import Draft7Validator, ValidationError
from langchain_openai import OpenAIEmbeddings
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

_SCHEMA=json.loads((Path(__file__).parent/'generated/retrieval_embedding_schema.json').read_text())
_L=_SCHEMA['limits']

# One provider request carries at most this many texts. The API side batches up to
# limits.maxBatch (32), but DashScope's OpenAI-compatible text-embedding-v3/v4 reject more
# than 10 inputs per request ("batch size is invalid"). 10 is accepted by every
# OpenAI-compatible provider, so the adapter always splits; order is preserved.
_PROVIDER_BATCH=10

_KEEPALIVE_S=300
# Idle longer than this ⇒ the warm-up loop sends one tiny embedding so the next real query rides a
# warm connection (a cold TLS handshake alone exceeds the API's 400ms vector recall budget).
_WARM_IDLE_S=60
_last_provider_use=0.0

class RetrievalEmbeddingUnavailable(RuntimeError):
    pass

class _BoundedStream(httpx.AsyncByteStream):
    def __init__(self, response):
        self.response=response
    async def __aiter__(self):
        total=0
        try:
            async for chunk in self.response.aiter_raw():
                total+=len(chunk)
                if total>_L['maxResponseBytes']:
                    raise RetrievalEmbeddingUnavailable('embedding_unavailable')
                yield chunk
        finally:
            await self.response.aclose()
    async def aclose(self):
        await self.response.aclose()

class _BoundedTransport(httpx.AsyncBaseTransport):
    def __init__(self):
        # httpx drops an idle pooled connection after 5s by default; the provider keeps it open for
        # at least 90s (devapp-probe 2026-09-30: ~250ms after 15/45/90s idle vs ~550ms cold). Limits must
        # be set on the inner transport: a client-level `limits` is ignored when a transport is passed.
        self.transport=httpx.AsyncHTTPTransport(retries=0,limits=httpx.Limits(keepalive_expiry=_KEEPALIVE_S))
    async def handle_async_request(self, request):
        response=await self.transport.handle_async_request(request)
        if response.headers.get('content-encoding','identity').lower()!='identity':
            await response.aclose()
            raise RetrievalEmbeddingUnavailable('embedding_unavailable')
        return httpx.Response(response.status_code,headers=response.headers,stream=_BoundedStream(response),extensions=response.extensions)
    async def aclose(self):
        await self.transport.aclose()

# One pooled client per event loop, reused across requests. A fresh client per request paid a
# new TCP + TLS handshake every time: devapp-probe (2026-09-30) measured ~530ms per single-text
# query on a fresh connection vs ~220ms kept alive, while the API's vector recall budget is
# KG_VECTOR_RECALL_TIMEOUT_MS=400 — so every recall turn timed out and degraded to text only.
_CLIENT=None
_CLIENT_LOOP=None

def _provider_client():
    global _CLIENT,_CLIENT_LOOP
    loop=asyncio.get_running_loop()
    if _CLIENT is None or _CLIENT.is_closed or _CLIENT_LOOP is not loop:
        _CLIENT=httpx.AsyncClient(transport=AsyncAccountingTransport(_BoundedTransport(),scoped_only=True),headers={'accept-encoding':'identity'},timeout=_L['deadlineMs']/1000,follow_redirects=False,trust_env=False)
        _CLIENT_LOOP=loop
    return _CLIENT

async def embed_texts(texts, accounting=None):
    with retrieval_accounting_scope(accounting,"retrieval-embedding"):
        # Reuse the deployment model connection. Never accept provider configuration from input.
        base=os.environ.get('KERNEL_MODEL_BASE_URL','')
        key=os.environ.get('KERNEL_MODEL_API_KEY','')
        model=os.environ.get('KERNEL_EMBEDDING_MODEL_ID','')
        revision=os.environ.get('KERNEL_EMBEDDING_MODEL_VERSION','')
        if not all((base,key,model,revision)):
            raise RetrievalEmbeddingUnavailable('embedding_not_configured')
        global _last_provider_use
        _last_provider_use=time.monotonic()
        try:
            provider=OpenAIEmbeddings(model=model,api_key=key,base_url=base,max_retries=0,check_embedding_ctx_length=False,chunk_size=_PROVIDER_BATCH,http_async_client=_provider_client())
            vectors=await provider.aembed_documents(texts)
            output={'model':model,'modelVersion':revision,'vectors':vectors}
            Draft7Validator(_SCHEMA['output']).validate(output)
            if len(vectors)!=len(texts) or len({len(v) for v in vectors})!=1 or any(not math.isfinite(x) for v in vectors for x in v):
                raise ValueError('invalid embedding')
            return output
        except Exception:
            raise RetrievalEmbeddingUnavailable('embedding_unavailable') from None


def embeddings_configured():
    return all(os.environ.get(k,'') for k in ('KERNEL_MODEL_BASE_URL','KERNEL_MODEL_API_KEY','KERNEL_EMBEDDING_MODEL_ID','KERNEL_EMBEDDING_MODEL_VERSION'))

async def keep_provider_connection_warm(check_every=15.0,idle_after=_WARM_IDLE_S):
    """Keep one pooled provider connection warm while embeddings are configured.

    Runs for the life of the service (started from the HTTP app lifespan). Warms right after start —
    the first recall after a deploy would otherwise pay the cold handshake — and again whenever the
    connection has been idle for `idle_after` seconds. Failures are ignored: this only affects latency.
    """
    while True:
        if embeddings_configured() and time.monotonic()-_last_provider_use>=idle_after:
            try:
                await embed_texts(['ping'])
            except Exception:
                pass
        await asyncio.sleep(check_every)

async def embedding_endpoint(request:Request):
    secret=os.environ.get('DEEP_AGENT_SERVICE_INTERNAL_KEY','')
    supplied=request.headers.get('x-deep-agent-internal-key','')
    if not secret or not hmac.compare_digest(secret.encode(),supplied.encode()):
        return JSONResponse({'error':'unauthorized'},status_code=401)
    try:
        async with asyncio.timeout(_L['deadlineMs']/1000):
            body=bytearray()
            async for chunk in request.stream():
                if len(body)+len(chunk)>_L['maxRequestBytes']:
                    return JSONResponse({'error':'invalid_embedding_input'},status_code=400)
                body.extend(chunk)
            data=json.loads(body)
            Draft7Validator(_SCHEMA['input']).validate(data)
            if any(len(text.encode('utf-8'))>_L['maxTextBytes'] for text in data['texts']):
                return JSONResponse({'error':'invalid_embedding_input'},status_code=400)
            result=await embed_texts(data['texts'],data['accounting']) if 'accounting' in data else await embed_texts(data['texts'])
            encoded=json.dumps(result,separators=(',',':'),allow_nan=False).encode()
            if len(encoded)>_L['maxResponseBytes']:
                raise RetrievalEmbeddingUnavailable('embedding_unavailable')
            return JSONResponse(result)
    except (ValueError,UnicodeError,ValidationError):
        return JSONResponse({'error':'invalid_embedding_input'},status_code=400)
    except Exception:
        return JSONResponse({'error':'embedding_unavailable'},status_code=503)

from .retrieval_rerank import rerank_endpoint

app=Starlette(routes=[Route('/internal/retrieval/rerank',rerank_endpoint,methods=['POST']),Route('/internal/retrieval/embeddings',embedding_endpoint,methods=['POST'])])
