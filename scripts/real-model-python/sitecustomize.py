"""Explicit developer preload: preserve accounting, proxy only the model origin."""
import os

if os.environ.get("WORKSPACEX_REAL_MODEL_DEV_OPT_IN") == "1" and os.environ.get("KERNEL_MODEL_BASE_URL") and (os.environ.get("HTTPS_PROXY") or os.environ.get("HTTP_PROXY")):
    import httpx
    from deep_agent_service import model_request_accounting as accounting

    _base = httpx.URL(os.environ["KERNEL_MODEL_BASE_URL"])
    _origin = (_base.scheme, _base.host, _base.port)
    _proxy = os.environ.get("HTTPS_PROXY") or os.environ["HTTP_PROXY"]

    def _matches(url):
        return (url.scheme, url.host, url.port) == _origin

    class ModelOriginTransport(httpx.BaseTransport):
        def __init__(self):
            self.direct = httpx.HTTPTransport()
            self.proxy = httpx.HTTPTransport(proxy=_proxy)

        def handle_request(self, request):
            return (self.proxy if _matches(request.url) else self.direct).handle_request(request)

        def close(self):
            self.direct.close()
            self.proxy.close()

    class ModelOriginAsyncTransport(httpx.AsyncBaseTransport):
        def __init__(self):
            self.direct = httpx.AsyncHTTPTransport()
            self.proxy = httpx.AsyncHTTPTransport(proxy=_proxy)

        async def handle_async_request(self, request):
            return await (self.proxy if _matches(request.url) else self.direct).handle_async_request(request)

        async def aclose(self):
            await self.direct.aclose()
            await self.proxy.aclose()

    _sync_init = accounting.AccountingTransport.__init__
    _async_init = accounting.AsyncAccountingTransport.__init__

    def _init_sync(self, inner=None):
        _sync_init(self, inner if inner is not None else ModelOriginTransport())

    def _init_async(self, inner=None, *, scoped_only=False):
        _async_init(self, inner if inner is not None else ModelOriginAsyncTransport(), scoped_only=scoped_only)

    accounting.AccountingTransport.__init__ = _init_sync
    accounting.AsyncAccountingTransport.__init__ = _init_async
