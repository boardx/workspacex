"""Official listwise Runnable, with trusted configuration and bounded async transport."""
import asyncio
import hmac
import json
import os
from pathlib import Path
import httpx
from jsonschema import Draft7Validator,ValidationError
from langchain_core.documents import Document
from langchain_classic.retrievers.document_compressors.listwise_rerank import LLMListwiseRerank
from langchain_openai import ChatOpenAI
from starlette.responses import JSONResponse
_SCHEMA=json.loads((Path(__file__).parent/'generated/retrieval_rerank_schema.json').read_text())
_L=_SCHEMA['limits']
class RetrievalRerankUnavailable(RuntimeError):
    pass
async def rerank_documents(query,candidates):
    base=os.environ.get('KERNEL_MODEL_BASE_URL','')
    key=os.environ.get('KERNEL_MODEL_API_KEY','')
    model=os.environ.get('KERNEL_RERANK_MODEL_ID','')
    revision=os.environ.get('KERNEL_RERANK_MODEL_VERSION','')
    if not all((base,key,model,revision)):
        raise RetrievalRerankUnavailable('rerank_not_configured')
    try:
        if not candidates:
            return {'model':model,'modelVersion':revision,'ids':[]}
        # Reuse the existing bounded provider transport. Import after the app is initialized.
        from .retrieval_embeddings import _BoundedTransport
        async with httpx.AsyncClient(transport=_BoundedTransport(),headers={'accept-encoding':'identity'},timeout=_L['deadlineMs']/1000,follow_redirects=False,trust_env=False) as client:
            llm=ChatOpenAI(model=model,api_key=key,base_url=base,max_retries=0,http_async_client=client)
            compressor=LLMListwiseRerank.from_llm(llm,top_n=len(candidates))
            docs=[Document(page_content=c['content'],metadata={'source_id':c['id']}) for c in candidates]
            # Public Runnable uses async model invocation. acompress_documents in 1.0.8
            # delegates to an uncancellable sync executor, so do not use that entry point.
            ordered=await compressor.reranker.ainvoke({'documents':docs,'query':query})
        ids=[d.metadata['source_id'] for d in ordered]
        if len(ids)!=len(candidates) or len(set(ids))!=len(ids) or set(ids)!={c['id'] for c in candidates}:
            raise ValueError('invalid ranking')
        return {'model':model,'modelVersion':revision,'ids':ids}
    except Exception:
        raise RetrievalRerankUnavailable('rerank_unavailable') from None
async def rerank_endpoint(request):
    secret=os.environ.get('DEEP_AGENT_SERVICE_INTERNAL_KEY','')
    if not secret or not hmac.compare_digest(secret.encode(),request.headers.get('x-deep-agent-internal-key','').encode()):
        return JSONResponse({'error':'unauthorized'},status_code=401)
    try:
        async with asyncio.timeout(_L['deadlineMs']/1000):
            body=bytearray()
            async for chunk in request.stream():
                if len(body)+len(chunk)>_L['maxRequestBytes']:
                    return JSONResponse({'error':'invalid_rerank_input'},status_code=400)
                body.extend(chunk)
            data=json.loads(body)
            Draft7Validator(_SCHEMA['input']).validate(data)
            candidates=data['candidates']
            if len({c['id'] for c in candidates})!=len(candidates) or any(len(c['content'].encode())>_L['maxTextBytes'] for c in candidates):
                return JSONResponse({'error':'invalid_rerank_input'},status_code=400)
            result=await rerank_documents(data['query'],candidates)
            Draft7Validator(_SCHEMA['output']).validate(result)
            if len(json.dumps(result).encode())>_L['maxResponseBytes']:
                raise RetrievalRerankUnavailable('rerank_unavailable')
            return JSONResponse(result)
    except (ValidationError,ValueError,UnicodeError):
        return JSONResponse({'error':'invalid_rerank_input'},status_code=400)
    except Exception:
        return JSONResponse({'error':'rerank_unavailable'},status_code=503)
