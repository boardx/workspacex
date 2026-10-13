"""Fixed source SQL engine, used only by the independently authorized clone supervisor."""
import hashlib,json,sys,tempfile,os,time,math
import psycopg
SQL_SHA='7440c6dcccddfc1857fe3461344be4efb4794201bd6ffcfaac86da9a2f26d85f'
SOURCE='5285bef9a6c91bbb9857ede42779aafa64b98f32'
KEYS=('accountId','regionId','attemptId','candidateSha','targetInstanceId','providerCreatedUtc','peerSha256')
def need(ok,code):
 if not ok:raise ValueError(code)
def remaining(p):
 values=(p['deadlineEpoch'],p['monotonicDeadline'])
 need(all(type(v)in(int,float) and math.isfinite(v) for v in values),'ADMISSION_DEADLINE')
 left=min(values[0]-time.time(),values[1]-time.monotonic());need(left>0,'ADMISSION_EXPIRED');return left
def run(p):
 remaining(p)
 b=p['binding'];s=p['secret'];mode=p.get('mode','check')
 need(mode in ('check','commit') and b['candidateSha']==SOURCE and b['targetInstanceId']!='pgm-uf6rg214cp381l49' and b['host']==b['targetInstanceId']+'.rwlb.rds.aliyuncs.com','TARGET_BINDING')
 need(s['host']==b['host'] and s['user']=='migration_admin' and s['port']==5432 and all(s.get(k)==b[k] for k in ('targetInstanceId','attemptId','peer','peerSha256','providerCreatedUtc')),'SECRET_BINDING')
 need(p['sqlSha256']==SQL_SHA and hashlib.sha256(p['sql'].encode()).hexdigest()==SQL_SHA,'FIXED_SQL')
 # Execute only this compiled, independently pinned SQL. No caller SQL fragments or archive SQL.
 body=p['sql'];need(body.rstrip().endswith('ROLLBACK;') and '\nBEGIN;\n' in body,'FIXED_TRANSACTION')
 body=body.replace('\nBEGIN;\n','\n',1).rsplit('ROLLBACK;',1)[0]
 sslmode=b['tls']['sslmode'];need(sslmode in ('disable','verify-full'),'TLS')
 kwargs=dict(host=b['host'],hostaddr=b['peer'],port=5432,dbname='workspacex',user='migration_admin',password=s['password'],sslmode=sslmode,connect_timeout=5,autocommit=True,options='-c statement_timeout=60000 -c lock_timeout=5000')
 ca=None
 if sslmode=='verify-full':
  need(hashlib.sha256(p['caPem'].encode()).hexdigest()==b['tls']['ca']['sha256'],'CA_BINDING')
  ca=tempfile.NamedTemporaryFile(mode='w',delete=False);ca.write(p['caPem']);ca.close();kwargs['sslrootcert']=ca.name
 else:need(b['tls'].get('approvedException')=='aliyun-postgresql-serverless-no-tls','TLS_EXCEPTION')
 try:
  return transact(p,b,mode,body,kwargs)
 finally:
  if ca:os.unlink(ca.name)
COUNTS="""SELECT
(SELECT count(*) FROM agent_runs WHERE status NOT IN ('failed','cancelled','succeeded')),
(SELECT count(*) FROM agent_run_interjections WHERE status IN ('queued','staged','carry_over_pending')),
(SELECT count(*) FROM thread_message_queue WHERE status='pending'),
(SELECT count(*) FROM standard_schedules WHERE status<>'cancelled' OR notification_pending),
(SELECT count(*) FROM workflow_instances WHERE status NOT IN ('succeeded','failed','cancelled','rejected','needs_attention')),
(SELECT count(*) FROM mail_outbox WHERE status IN ('pending','delivering','retryable')),
(SELECT count(*) FROM kg_extraction_state WHERE enabled),
(SELECT count(*) FROM kg_extraction_queue WHERE attempts<3),
(SELECT count(*) FROM kg_embedding_outbox WHERE attempts<kg_embedding_max_attempts()),
(SELECT count(*) FROM projects p LEFT JOIN project_ai_settings s ON s.project_id=p.id WHERE s.project_id IS NULL OR cardinality(s.allowed_sources)<>0),
(SELECT count(*) FROM product_feedback WHERE github_issue_number IS NOT NULL OR github_issue_url IS NOT NULL)"""
def transact(p,b,mode,body,kwargs):
 with psycopg.connect(**kwargs) as c:
  identity=c.execute("SELECT current_database(),current_user,host(inet_server_addr()),inet_server_port(),rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user").fetchone()
  need(identity==('workspacex','migration_admin',b['peer'],5432,False,True),'ACTUAL_SQL_IDENTITY')
  c.execute('BEGIN')
  try:
   c.execute("SELECT set_config('wsx.clone_database','workspacex',true),set_config('wsx.clone_peer',%s,true),set_config('wsx.fixture_actor',%s,true)",(b['peer'],p['fixtureActor']))
   c.execute("SELECT set_config('statement_timeout',%s,true)",(str(max(1,int(min(60,remaining(p))*1000))),))
   before=list(c.execute(COUNTS).fetchone())
   c.execute(body)
   after=list(c.execute(COUNTS).fetchone());need(after==[0]*11,'POSTCONDITION_COUNTS')
   remaining(p)
   c.execute('COMMIT' if mode=='commit' else 'ROLLBACK')
  except BaseException:
   c.execute('ROLLBACK');raise
 return {'kind':'clone-quiescence-result-v1','binding':{k:b[k] for k in KEYS},'sqlSha256':SQL_SHA,'committed':mode=='commit','rolledBack':mode=='check','a3Accepted':False,'beforeCounts':before,'afterCounts':after}
if __name__=='__main__':
 try:print(json.dumps(run(json.load(sys.stdin))))
 except BaseException:print('CLONE_QUIESCENCE_REJECTED',file=sys.stderr);sys.exit(1)
