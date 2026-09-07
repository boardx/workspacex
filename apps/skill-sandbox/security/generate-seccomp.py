# Build-time libseccomp compiler; native architecture BPF, never run by untrusted code.
import ctypes, os, platform
if platform.machine() not in ("aarch64", "x86_64"):
    raise RuntimeError("Unreviewed clone ABI: refuse building sandbox policy")
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
for name in ['unshare','mount','umount2','pivot_root','chroot','setns','fsopen','fsconfig','fsmount','move_mount','open_tree','mount_setattr']:
    n=lib.seccomp_syscall_resolve_name(name.encode())
    if n>=0: assert lib.seccomp_rule_add_array(ctx,0x50001,n,0,None)==0
clone=lib.seccomp_syscall_resolve_name(b'clone')
for bit in [0x00000080,0x00020000,0x02000000,0x04000000,0x08000000,0x10000000,0x20000000,0x40000000]:
    cmp=Cmp(0,7,bit,bit)
    assert lib.seccomp_rule_add_array(ctx,0x50001,clone,1,ctypes.byref(cmp))==0
n=lib.seccomp_syscall_resolve_name(b'clone3')
if n>=0: assert lib.seccomp_rule_add_array(ctx,0x50026,n,0,None)==0
with open('/opt/sandbox/session-seccomp.bpf','wb') as out:
    assert lib.seccomp_export_bpf(ctx,out.fileno())==0
lib.seccomp_release(ctx)
os.chmod('/opt/sandbox/session-seccomp.bpf', 0o444)
