import ctypes, os, pathlib, subprocess, tempfile
lib = ctypes.CDLL('libseccomp.so.2', use_errno=True)
lib.seccomp_init.argtypes=[ctypes.c_uint32]; lib.seccomp_init.restype=ctypes.c_void_p
lib.seccomp_syscall_resolve_name.argtypes=[ctypes.c_char_p];lib.seccomp_syscall_resolve_name.restype=ctypes.c_int
class Cmp(ctypes.Structure):
    _fields_=[('arg',ctypes.c_uint),('op',ctypes.c_uint),('a',ctypes.c_uint64),('b',ctypes.c_uint64)]
lib.seccomp_rule_add_array.argtypes=[ctypes.c_void_p,ctypes.c_uint32,ctypes.c_int,ctypes.c_uint,ctypes.POINTER(Cmp)]
lib.seccomp_export_bpf.argtypes=[ctypes.c_void_p,ctypes.c_int]
lib.seccomp_release.argtypes=[ctypes.c_void_p]
ctx=lib.seccomp_init(0x7fff0000)
assert ctx
for name in ['unshare','mount','umount2','pivot_root','chroot','setns']:
    n=lib.seccomp_syscall_resolve_name(name.encode())
    if n>=0: assert lib.seccomp_rule_add_array(ctx,0x50001,n,0,None)==0
clone=lib.seccomp_syscall_resolve_name(b'clone')
for bit in [0x00020000,0x02000000,0x04000000,0x08000000,0x10000000,0x20000000,0x40000000]:
    cmp=Cmp(0,7,bit,bit)
    assert lib.seccomp_rule_add_array(ctx,0x50001,clone,1,ctypes.byref(cmp))==0
n=lib.seccomp_syscall_resolve_name(b'clone3')
if n>=0: assert lib.seccomp_rule_add_array(ctx,0x50026,n,0,None)==0
root=pathlib.Path(tempfile.mkdtemp(prefix='session-probe-'))
work=root/'workspace';skills=root/'skills';work.mkdir();skills.mkdir()
(skills/'SKILL.md').write_text('readonly')
(root/'secret').write_text('hidden')
with open(root/'filter.bpf','wb') as out: assert lib.seccomp_export_bpf(ctx,out.fileno())==0
lib.seccomp_release(ctx)
script='''import pathlib,ctypes,socket
p=pathlib.Path('/workspace/result.txt'); p.write_text('python-real')
assert p.read_text()=='python-real'
assert not pathlib.Path('/run/sandbox').exists()
assert not pathlib.Path('/tmp/secret').exists()
try: pathlib.Path('/skills/SKILL.md').write_text('bad'); raise AssertionError('skills writable')
except OSError: pass
lib=ctypes.CDLL(None,use_errno=True)
assert lib.unshare(0x10000000)==-1 and ctypes.get_errno()==1
assert lib.setns(-1,0)==-1 and ctypes.get_errno()==1
assert lib.mount(b'none',b'/tmp',b'tmpfs',0,None)==-1 and ctypes.get_errno()==1
sec=ctypes.CDLL('libseccomp.so.2'); sec.seccomp_syscall_resolve_name.argtypes=[ctypes.c_char_p]
clone=sec.seccomp_syscall_resolve_name(b'clone')
for bit in [0x00020000,0x02000000,0x04000000,0x08000000,0x10000000,0x20000000,0x40000000]:
    assert lib.syscall(clone,bit|17,0,0,0,0)==-1 and ctypes.get_errno()==1
clone3=sec.seccomp_syscall_resolve_name(b'clone3')
assert lib.syscall(clone3,0,0)==-1 and ctypes.get_errno()==38
assert not pathlib.Path('/proc').exists()
print('UNSHARE_SETNS_MOUNT_CLONE_FLAGS_EPERM_CLONE3_ENOSYS')
s=socket.socket(); s.settimeout(.2)
try: s.connect(('1.1.1.1',80)); raise AssertionError('network open')
except OSError: pass
print('PYTHON_FILE_READONLY_SOCKET_NETWORK_SECCOMP_OK')
'''
(work/'probe.py').write_text(script)
with open(root/'filter.bpf','rb') as f:
    args=['/usr/bin/bwrap','--unshare-all','--unshare-user','--die-with-parent','--new-session',
      '--cap-drop','ALL','--clearenv','--ro-bind','/usr','/usr','--ro-bind','/lib','/lib','--ro-bind-try','/lib64','/lib64',
      '--ro-bind','/bin','/bin','--dev','/dev','--tmpfs','/tmp',
      '--bind',str(work),'/workspace','--ro-bind',str(skills),'/skills','--setenv','PATH','/usr/local/bin:/usr/bin:/bin',
      '--chdir','/workspace','--seccomp',str(f.fileno()),'--','/bin/sh','-c',
      'python3 /workspace/probe.py && node -e "require(\'fs\').writeFileSync(\'/workspace/node.txt\',\'node-real\'); console.log(\'NODE_OK\')"']
    r=subprocess.run(args,pass_fds=(f.fileno(),),capture_output=True,text=True,timeout=10)
    print(r.stdout,r.stderr,'exit',r.returncode)
    raise SystemExit(r.returncode)
