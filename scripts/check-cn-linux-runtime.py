#!/usr/bin/env python3
"""Offline imports and localhost browser smoke against the actual built package."""
import importlib
import importlib.metadata
import json
from pathlib import Path
import socket
import subprocess
import sys
from packaging.requirements import Requirement
from packaging.utils import canonicalize_name


def main():
    root = Path(sys.argv[1]).resolve()
    sdk = root / 'rds-sdk'
    sys.path.insert(0, str(sdk))
    def denied(*args, **kwargs):
        raise RuntimeError('NETWORK_DISABLED_FOR_IMPORT_SMOKE')
    socket.create_connection = denied
    socket.socket.connect = denied
    socket.socket.connect_ex = denied
    for module in ['alibabacloud_credentials.client', 'alibabacloud_credentials.models',
                   'aliyunsdkcore.client', 'aliyunsdkcore.auth.credentials',
                   'aliyunsdkcore.request', 'requests.adapters']:
        importlib.import_module(module)
    packages = {canonicalize_name(d.metadata['Name']): d for d in importlib.metadata.distributions(path=[str(sdk)])}
    for dist in packages.values():
        for raw in dist.requires or []:
            req = Requirement(raw)
            if req.marker and not req.marker.evaluate({'extra': ''}):
                continue
            actual = packages.get(canonicalize_name(req.name))
            if actual is None or actual.version not in req.specifier:
                raise RuntimeError('DEPENDENCY_CLOSURE: ' + req.name)
    node = root / 'node/node'
    entry = root / 'business/scripts/cn-release-business-entry.mjs'
    # Exercise real bundled entry's input parser, module imports and failure protocol.
    result = subprocess.run([str(node), str(entry)], input='{}\n', text=True, capture_output=True, timeout=30)
    expected = {'type': 'failed', 'reason': 'BUSINESS_UNKNOWN_RECONCILE_REQUIRED'}
    if result.returncode != 2 or json.loads(result.stdout) != expected or result.stderr:
        raise RuntimeError('BUILT_ENTRY_PROTOCOL_SMOKE')
    chrome = root / 'chromium/chrome'
    libs = subprocess.run(['ldd', str(chrome)], text=True, capture_output=True, check=True, timeout=30)
    if 'not found' in libs.stdout:
        raise RuntimeError('CHROMIUM_HOST_LIBRARY_MISSING')
    # Actual copied binary executes on Ubuntu host, outside the Playwright source image.
    script = """
const {chromium}=require(process.argv[1]);
(async()=>{const browser=await chromium.launch({executablePath:process.argv[2],headless:true,args:['--no-sandbox']});
try{const page=await browser.newPage();await page.route('**/*',r=>r.abort());
await page.setContent('<title>runtime-fixture</title><button id="b">before</button><script>document.querySelector("#b").onclick=()=>document.querySelector("#b").textContent="after"</script>');
await page.locator('#b').click();if(await page.title()!=='runtime-fixture'||await page.locator('#b').textContent()!=='after')throw Error('SMOKE');
}finally{await browser.close();}})().catch(()=>process.exitCode=1);
"""
    subprocess.run([str(node), '-e', script, str(root / 'business/node_modules/playwright'), str(chrome)],
                   check=True, timeout=60, capture_output=True, text=True)

if __name__ == '__main__':
    main()
