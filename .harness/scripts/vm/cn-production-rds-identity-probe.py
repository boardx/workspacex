#!/usr/bin/env python3
"""Read-only provider identity probe. No credential is accepted in argv/output."""
import json,os,subprocess,sys,time
TARGET='pgm-uf6rg214cp381l49'
def main(args):
 if args!=['--read-only',TARGET] or os.geteuid()!=0:raise RuntimeError('USAGE')
 # Installed host CLI credential authority remains the host's rootprivate profile.
 result=subprocess.run(['/usr/bin/aliyun','rds','DescribeDBInstanceAttribute','--DBInstanceId',TARGET],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=30,env={'PATH':'/usr/bin:/bin','HOME':'/root','LANG':'C'})
 if result.returncode or len(result.stdout)>1024*1024:raise RuntimeError('PROVIDER_REJECTED')
 value=json.loads(result.stdout);items=value['Items']['DBInstanceAttribute']
 if len(items)!=1:raise RuntimeError('INSTANCE_CARDINALITY')
 item=items[0]
 if item['DBInstanceId']!=TARGET or item['Engine']!='PostgreSQL':raise RuntimeError('INSTANCE_IDENTITY')
 return {'schemaVersion':1,'kind':'actual-rds-identity','instanceId':item['DBInstanceId'],'regionId':item['RegionId'],'connectionString':item['ConnectionString'],'engine':item['Engine'],'engineVersion':item['EngineVersion'],'observedAt':time.time()}
if __name__=='__main__':
 try:print(json.dumps(main(sys.argv[1:]),sort_keys=True))
 except BaseException:print('{"error":"PROVIDER_IDENTITY_REJECTED"}');sys.exit(1)
