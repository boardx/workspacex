import hashlib,json,math,random,subprocess,tempfile,wave
from pathlib import Path
root=Path('/inputs')
if not root.is_dir(): raise SystemExit('requires an isolated /inputs mount; see the document/file acceptance report')
script=str(Path(__file__).resolve().parents[1]/'scripts'/'decode-audio.py')
results=[]
owned=set()
try:
 with tempfile.TemporaryDirectory(prefix='skills-all-synthetic-',dir=root) as temporary:
  original=Path(temporary)/'synthetic.wav'
  seed=random.randrange(500,900)
  with wave.open(str(original),'wb') as wav:
   wav.setnchannels(1);wav.setsampwidth(2);wav.setframerate(16000)
   wav.writeframes(b''.join(int(5000*math.sin(2*math.pi*seed*i/16000)).to_bytes(2,'little',signed=True) for i in range(32000)))
  digest=hashlib.sha256(original.read_bytes()).hexdigest()
  expected=list(Path('/workspace').glob(f'audio-{digest}-*.pcm'));assert not expected,'synthetic fixture hash collision'
  owned.add(digest)
  def call(source,source_hash=digest,limit=3000,size=100000):
   return subprocess.run(['python',script,'--source',str(source),'--source-hash',source_hash,'--max-source-bytes',str(size),'--max-duration-ms',str(limit),'--chunk-duration-ms','1000','--max-chunks','3'],capture_output=True,text=True,timeout=30)
  success=call(original);assert success.returncode==0,success.stderr
  chunks=json.loads(success.stdout);assert len(chunks)==2
  for index,chunk in enumerate(chunks):
   payload=Path(chunk['path']).read_bytes();assert len(payload)==32000;assert hashlib.sha256(payload).hexdigest()==chunk['sha256'];assert chunk['startMs']==index*1000;assert chunk['endMs']==(index+1)*1000;Path(chunk['path']).unlink()
  results.append('real WAV decode: two bounded source-bound chunks, exact hashes/times')
  for reason,source,args in [('hash mismatch',original,{'source_hash':'0'*64}),('source byte limit',original,{'size':1}),('duration limit',original,{'limit':1000}),('outside inputs',Path('/tmp/not-original.wav'),{})]:
   failure=call(source,**args);assert failure.returncode!=0;assert not list(Path('/workspace').glob(f'audio-{digest}-*.pcm'));results.append(reason+' rejected; no derived output retained')
  mp3=Path(temporary)/'synthetic.mp3'
  subprocess.run(['/usr/bin/ffmpeg','-nostdin','-v','error','-i',str(original),'-c:a','libmp3lame',str(mp3)],check=True,timeout=30)
  mp3_digest=hashlib.sha256(mp3.read_bytes()).hexdigest()
  assert not list(Path('/workspace').glob(f'audio-{mp3_digest}-*.pcm')),'synthetic MP3 hash collision'
  owned.add(mp3_digest)
  converted=call(mp3,source_hash=mp3_digest);assert converted.returncode==0,converted.stderr
  mp3_chunks=json.loads(converted.stdout);assert len(mp3_chunks)==2
  for chunk in mp3_chunks:
   path=Path(chunk['path']);assert hashlib.sha256(path.read_bytes()).hexdigest()==chunk['sha256'];path.unlink()
  assert hashlib.sha256(mp3.read_bytes()).hexdigest()==mp3_digest
  results.append('real MP3 decode: bounded chunks and source/output hashes')
  corrupt=Path(temporary)/'corrupt.wav';corrupt.write_bytes(b'RIFFbroken WAV');bad_digest=hashlib.sha256(corrupt.read_bytes()).hexdigest();assert not list(Path('/workspace').glob(f'audio-{bad_digest}-*.pcm'));owned.add(bad_digest);failure=call(corrupt,source_hash=bad_digest);assert failure.returncode!=0;assert not list(Path('/workspace').glob(f'audio-{bad_digest}-*.pcm'));results.append('corrupt audio rejected')
  assert hashlib.sha256(original.read_bytes()).hexdigest()==digest
 print(json.dumps({'passed':results,'originalUnchanged':True,'providerASR':'not run; requires native service/model'},ensure_ascii=False))
finally:
 # Cleanup only this verifier's output prefixes, whose absence was checked before execution.
 for prefix in owned:
  for output in Path('/workspace').glob(f'audio-{prefix}-*.pcm'): output.unlink(missing_ok=True)
