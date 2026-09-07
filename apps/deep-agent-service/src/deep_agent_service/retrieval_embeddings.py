"""Official LangChain embeddings behind the existing infrastructure secret boundary."""
import asyncio
import hmac
import json
import math
import os
from pathlib import Path
import httpx
from jsonschema import Draft7Validator, ValidationError
from langchain_openai import OpenAIEmbeddings
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

_SCHEMA=json.loads((Path(__file__).parent/'generated/retrieval_embedding_schema.json').read_text())
_L=_SCHEMA['limits']

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
        self.transport=httpx.AsyncHTTPTransport(retries=0)
    async def handle_async_request(self, request):
        response=await self.transport.handle_async_request(request)
        if response.headers.get('content-encoding','identity').lower()!='identity':
            await response.aclose()
            raise RetrievalEmbeddingUnavailable('embedding_unavailable')
        return httpx.Response(response.status_code,headers=response.headers,stream=_BoundedStream(response),extensions=response.extensions)
    async def aclose(self):
        await self.transport.aclose()

async def embed_texts(texts):
    # Reuse the deployment model connection. Never accept provider configuration from input.
    base=os.environ.get('KERNEL_MODEL_BASE_URL','')
    key=os.environ.get('KERNEL_MODEL_API_KEY','')
    model=os.environ.get('KERNEL_EMBEDDING_MODEL_ID','')
    revision=os.environ.get('KERNEL_EMBEDDING_MODEL_VERSION','')
    if not all((base,key,model,revision)):
        raise RetrievalEmbeddingUnavailable('embedding_not_configured')
    try:
        async with httpx.AsyncClient(transport=_BoundedTransport(),headers={'accept-encoding':'identity'},timeout=_L['deadlineMs']/1000,follow_redirects=False,trust_env=False) as client:
            provider=OpenAIEmbeddings(model=model,api_key=key,base_url=base,max_retries=0,check_embedding_ctx_length=False,http_async_client=client)
            vectors=await provider.aembed_documents(texts)
        output={'model':model,'modelVersion':revision,'vectors':vectors}
        Draft7Validator(_SCHEMA['output']).validate(output)
        if len(vectors)!=len(texts) or len({len(v) for v in vectors})!=1 or any(not math.isfinite(x) for v in vectors for x in v):
            raise ValueError('invalid embedding')
        return output
    except Exception:
        raise RetrievalEmbeddingUnavailable('embedding_unavailable') from None

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
            result=await embed_texts(data['texts'])
            encoded=json.dumps(result,separators=(',',':'),allow_nan=False).encode()
            if len(encoded)>_L['maxResponseBytes']:
                raise RetrievalEmbeddingUnavailable('embedding_unavailable')
            return JSONResponse(result)
    except (ValueError,UnicodeError,ValidationError):
        return JSONResponse({'error':'invalid_embedding_input'},status_code=400)
    except Exception:
        return JSONResponse({'error':'embedding_unavailable'},status_code=503)

app=Starlette(routes=[Route('/internal/retrieval/embeddings',embedding_endpoint,methods=['POST'])])
