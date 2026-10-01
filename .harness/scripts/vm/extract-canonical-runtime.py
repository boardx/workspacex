#!/usr/bin/env python3
"""Run only in root-verified immutable Agent image with --network none, no config mounts."""
import os,json,hashlib,re,socket
os.environ.clear()
network_attempts=0
def deny(*args,**kwargs):
 global network_attempts
 network_attempts+=1
 raise RuntimeError('NETWORK_DISABLED_FOR_INVENTORY')
socket.socket.connect=deny
socket.socket.connect_ex=deny
socket.create_connection=deny
import importlib.metadata as metadata

def normalized(name):return re.sub(r'[-_.]+','-',name).lower()
def collect(distributions):
 rows=[];names=set()
 for dist in distributions:
  name=dist.metadata['Name'];version=dist.version
  assert isinstance(name,str) and name and isinstance(version,str) and version
  key=normalized(name);assert key not in names;names.add(key)
  rows.append({'name':name,'normalizedName':key,'version':version})
 rows.sort(key=lambda row:row['normalizedName'])
 assert rows
 return rows

def main():
 rows=collect(metadata.distributions())
 versions={r['normalizedName']:r['version'] for r in rows}
 manifest=json.load(open('/probe/canonical-source-manifest.json'));assert all(versions[n]==v for n,v in manifest['expectedPackageVersions'].items())
 payload={'candidateSha':manifest['sourceSha'],'candidateUvLockSha256':manifest['filesSha256']['apps/deep-agent-service/uv.lock'],'packageVersions':manifest['expectedPackageVersions'],'schemaVersion':1,'distributionCount':len(rows),'distributions':rows,'distributionsCanonicalSha256':hashlib.sha256(json.dumps(rows,sort_keys=True,separators=(',',':')).encode()).hexdigest(),'networkConnectionsAttempted':network_attempts,'sourceQueriesAttempted':0,'runtimeEnvironmentRead':False,'productionReady':False}
 assert network_attempts==0
 print(json.dumps(payload,sort_keys=True,separators=(',',':')))
if __name__=='__main__':main()
