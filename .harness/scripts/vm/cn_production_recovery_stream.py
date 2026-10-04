"""Bounded-memory subprocess pipe with a wall deadline and full exit accounting."""
import subprocess,threading,time,os,signal
from cn_production_recovery_executor import require
MAX_OUTPUT=16*1024*1024
def stream(producer_args,consumer_args,prefix=b'',producer_input=None,timeout=3600,pass_fds=(9,)):
 producer=consumer=None;failures=[];outputs=[];threads=[]
 started=time.monotonic()
 try:
  producer=subprocess.Popen(producer_args,stdin=producer_input if producer_input is not None else subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,pass_fds=pass_fds,start_new_session=True)
  consumer=subprocess.Popen(consumer_args,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,pass_fds=pass_fds,start_new_session=True)
  def pump():
   try:
    consumer.stdin.write(prefix)
    while True:
     raw=producer.stdout.read(1024*1024)
     if not raw:break
     consumer.stdin.write(raw)
    consumer.stdin.close()
   except BaseException:
    failures.append('STREAM_FAILED')
    try:consumer.stdin.close()
    except BaseException:pass
  def collect():
   try:
    output=consumer.stdout.read(MAX_OUTPUT+1)
    if len(output)>MAX_OUTPUT:failures.append('OUTPUT_BOUND');consumer.kill()
    else:outputs.append(output)
   except BaseException:failures.append('OUTPUT_FAILED')
  threads=[threading.Thread(target=pump,daemon=True),threading.Thread(target=collect,daemon=True)]
  for thread in threads:thread.start()
  def remaining():return max(0.001,timeout-(time.monotonic()-started))
  consumer.wait(timeout=remaining());producer.wait(timeout=remaining())
  for thread in threads:thread.join(timeout=remaining())
  require(not any(t.is_alive() for t in threads) and not failures and len(outputs)==1 and producer.returncode==0 and consumer.returncode==0,'RECOVERY_STREAM_FAILED')
  return outputs[0]
 except subprocess.TimeoutExpired:raise RuntimeError('RECOVERY_STREAM_TIMEOUT') from None
 finally:
  for child in (producer,consumer):
   if child:
    try:os.killpg(child.pid,signal.SIGKILL)
    except ProcessLookupError:pass
  for child in (producer,consumer):
   if child:
    child.wait(timeout=10)
    for pipe in (child.stdin,child.stdout):
     if pipe:
      try:pipe.close()
      except BaseException:pass
  for thread in threads:thread.join(timeout=2)
