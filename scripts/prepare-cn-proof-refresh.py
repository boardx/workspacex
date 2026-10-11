"""Local only; bind reviewed original acquisition authority to a new refresh window."""
import argparse,datetime,importlib.util
from pathlib import Path
s=importlib.util.spec_from_file_location('runner',Path(__file__).with_name('runner.py') if Path(__file__).with_name('runner.py').exists() else Path(__file__).with_name('cn-proof-only-refresh.py'));r=importlib.util.module_from_spec(s);s.loader.exec_module(r)
p=argparse.ArgumentParser();p.add_argument('--acquisition-request',type=Path,required=True);p.add_argument('--acquisition-sha256',required=True);p.add_argument('--issued-at',required=True);p.add_argument('--expires-at',required=True);p.add_argument('--output',type=Path,required=True);x=p.parse_args()
raw=x.acquisition_request.read_bytes();r.need(r.sha(raw)==x.acquisition_sha256,'ORIGINAL_REQUEST_HASH');q=r.parse(raw)
r.need(q['kind']=='candidate-byte-acquisition-request-v1','ACQUISITION_KIND')
v={'kind':'cn-proof-only-refresh-plan-v1',**{k:q[k]for k in ('selection','artifacts','verifierRevision','verifierFiles')},'issuedAt':x.issued_at,'expiresAt':x.expires_at,'maxSeconds':1200}
r.validate(v,datetime.datetime.now(datetime.timezone.utc));digest=r.put(x.output,r.encode(v));print(r.encode({'path':str(x.output),'sha256':digest,'localOnly':True,'dispatchExecuted':False}).decode(),end='')
