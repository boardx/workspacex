"""Actual owned sandbox: concurrent reads must not contend for its execution slot."""
import asyncio
from native_sandbox_fixture import real_native_session


def test_parallel_reads_keep_capture_and_cleanup_atomic():
    with real_native_session([]) as (adapter, _):
        assert adapter.upload_files([('/workspace/synthetic.txt', b'SYNTHETIC_ONLY\n')])[0].error is None
        async def read_all():
            return await asyncio.gather(*(adapter.aread('/workspace/synthetic.txt') for _ in range(6)), return_exceptions=True)
        results = asyncio.run(read_all())
        assert all(not isinstance(result, BaseException) and result.error is None for result in results), repr(results)
        listing = adapter.execute("find /workspace -name '.native-read-*'")
        assert listing.exit_code == 0 and listing.output == ''
