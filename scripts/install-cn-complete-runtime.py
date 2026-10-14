#!/usr/bin/env python3
"""Offline complete-runtime installer adapter. Never executes packaged code.

Library validation/transaction tests are isolated. CLI authority must be supplied
as a root-private approval binding package, summary, absent targets and entries.
"""
import hashlib,importlib.util,io,json,os,posixpath,re,stat,tarfile,shutil,tempfile,subprocess,fcntl,sys
from pathlib import Path
s=importlib.util.spec_from_file_location('candidate_installer',Path(__file__).with_name('install-cn-candidate-runtime.py'))
old=importlib.util.module_from_spec(s);s.loader.exec_module(old)
need=old.need;decode=old.decode;sha=old.sha
MAX_FILE=33554432;MAX_TOTAL=2147483648
TARGET={'accountId':'1177216024653153','region':'cn-shanghai','ecsInstanceId':'i-uf6ga92ewloganobbln6'}
ENTRY_NAMES={'release':'workspacex-cn-fixed-release','evidence':'workspacex-cn-mvp-evidence','prepare':'workspacex-cn-mvp-prepare-approved'}
META={'control-runtime.json':'runtimeManifestSha256','source-files.json':'sourceFilesSha256','git-files.json':'gitManifestSha256'}


def relative(name):
    need(type(name)is str and name and not name.startswith('/') and '\\'not in name and posixpath.normpath(name)==name and all(p not in ('','..','.')for p in name.split('/')),'PACKAGE_PATH')
    return name


def targets(summary):
    return {'control':Path('/usr/local/lib/workspacex-cn/release-control'),
        'source':Path('/usr/local/lib/workspacex-cn/release-source')/summary['sourceRevision'],
        'entry-control':Path('/usr/local/lib/workspacex-cn/continuation-control')/summary['fixedControlBundleSha256']}


def validate_authority(summary_raw,approval):
    summary=decode(summary_raw)
    fields={'kind','target','producerRevision','controlRevision','sourceRevision','runId','runAttempt','artifactId','summarySha256','archiveSha256','archiveBytes','unpackedBytes','wrapperSha256','sudoSha256','expectedAbsent','activationApproved'}
    need(set(approval)==fields and approval['kind']=='cn-complete-runtime-install-approval-v1' and approval['target']==TARGET,'INSTALL_APPROVAL_SCHEMA')
    need(sha(summary_raw)==approval['summarySha256'],'SUMMARY_HASH')
    for key in ('producerRevision','controlRevision','sourceRevision','archiveSha256','archiveBytes','unpackedBytes'):
        need(summary[key]==approval[key],'PACKAGE_IDENTITY')
    need(type(approval['runId'])is int and approval['runId']>0 and type(approval['artifactId'])is int and approval['artifactId']>0
        and type(approval['runAttempt'])is int and str(summary['runId'])==str(approval['runId'])and str(summary['runAttempt'])=='1'and approval['runAttempt']==1,'PRODUCER_RUN')
    for key in ('producerRevision','controlRevision','sourceRevision'):need(re.fullmatch('[a-f0-9]{40}',summary[key]),'REVISION')
    need(summary.get('platform')=='linux-x64' and summary.get('credentialsIncluded')is False,'PACKAGE_PLATFORM_SCOPE')
    need(type(summary['archiveBytes'])is int and 0<summary['archiveBytes']<=MAX_TOTAL and type(summary['unpackedBytes'])is int and 0<summary['unpackedBytes']<=MAX_TOTAL,'PACKAGE_LIMIT')
    need(set(approval['wrapperSha256'])==set(ENTRY_NAMES) and all(re.fullmatch('[a-f0-9]{64}',h)for h in approval['wrapperSha256'].values()),'WRAPPER_PINS')
    need(re.fullmatch('[a-f0-9]{64}',summary['fixedControlBundleSha256'])and re.fullmatch('[a-f0-9]{64}',approval['sudoSha256']),'INSTALL_PINS')
    destinations={str(p)for p in targets(summary).values()}|{'/usr/local/bin/'+n for n in ENTRY_NAMES.values()}|{'/etc/sudoers.d/workspacex-cn-mvp-fixed-entries'}
    need(set(approval['expectedAbsent'])==destinations and approval['activationApproved']is True,'INSTALL_ABSENT_CAS_SCOPE')
    return summary


def inspect_archive(stream,summary,approval,staging=None):
    """Read bounded members; tar extraction is never delegated to tarfile."""
    stream.seek(0);h=hashlib.sha256();size=0
    while True:
        block=stream.read(1048576)
        if not block:break
        size+=len(block);need(size<=summary['archiveBytes'],'ARCHIVE_SIZE');h.update(block)
    need(size==summary['archiveBytes'] and h.hexdigest()==summary['archiveSha256'],'ARCHIVE_HASH');stream.seek(0)
    regular={};links={};directories=set();modes={};total=0
    if staging is not None:need(Path(staging).is_dir() and not Path(staging).is_symlink(),'STAGING_ROOT')
    with tarfile.open(fileobj=stream,mode='r|gz')as archive:
        for member in archive:
            name=relative(member.name.rstrip('/')if member.isdir()else member.name)
            need(name.split('/')[0]in{'control','source','entry-control','entries','manifests'} and member.uid==member.gid==0,'PACKAGE_SCOPE')
            need(name not in regular and name not in links and name not in directories,'DUPLICATE_MEMBER')
            need(set(member.pax_headers)<={'path','linkpath'},'PACKAGE_PAX')
            if member.isdir():
                need(member.mode in (0o700,0o755),'PACKAGE_DIRECTORY_MODE');directories.add(name);continue
            if member.issym():
                need(name.startswith('control/')and not member.linkname.startswith('/')and '\\'not in member.linkname,'LINK_SCOPE')
                resolved=posixpath.normpath(posixpath.join(posixpath.dirname(name),member.linkname))
                need(resolved.startswith('control/')and resolved!='control','LINK_ESCAPE');links[name]=member.linkname;continue
            limit=MAX_TOTAL if re.fullmatch(r'control/\.git/objects/pack/pack-[a-f0-9]{40}\.pack',name)else MAX_FILE
            need(member.isfile()and 0<=member.size<=limit and not member.islnk(),'PACKAGE_MEMBER')
            metadata=name.startswith(('control/.git/','manifests/'))
            need(member.mode in ((0o600,0o644,0o444)if metadata else(0o600,0o700)),'PACKAGE_FILE_MODE')
            modes[name]=0o600 if metadata else member.mode
            if name.startswith('entries/'):need(member.mode==0o700,'WRAPPER_EXECUTABLE_MODE')
            total+=member.size;need(total<=summary['unpackedBytes'],'UNPACKED_LIMIT')
            source=archive.extractfile(member)
            if staging is None:
                need(member.size<=MAX_FILE and total<=128*1024**2,'STREAM_STAGING_REQUIRED')
                raw=source.read(member.size+1);need(len(raw)==member.size,'MEMBER_SIZE');regular[name]=raw
            else:
                target=Path(staging)/name;target.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
                count=0
                fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,modes[name])
                with os.fdopen(fd,'wb')as output:
                    os.fchmod(output.fileno(),modes[name])
                    while True:
                        block=source.read(1048576)
                        if not block:break
                        count+=len(block);need(count<=member.size,'MEMBER_SIZE');output.write(block)
                    output.flush();os.fsync(output.fileno())
                need(count==member.size,'MEMBER_SIZE');regular[name]=target
    need(total==summary['unpackedBytes'],'UNPACKED_SIZE')
    for name in regular|links:
        for prefix in Path(name).parents:
            need(str(prefix)not in regular and str(prefix)not in links,'MEMBER_PARENT_NOT_DIRECTORY')
    def content(name):
        item=regular[name]
        return item.read_bytes()if isinstance(item,Path)else item
    def digest(name):
        item=regular[name]
        if not isinstance(item,Path):return sha(item)
        h=hashlib.sha256()
        with item.open('rb')as source:
            while True:
                block=source.read(1048576)
                if not block:break
                h.update(block)
        return h.hexdigest()
    maps={}
    for filename,pin in META.items():
        raw=content('manifests/'+filename);need(sha(raw)==summary[pin],'MANIFEST_HASH');maps[filename]=decode(raw)
    linkmap=decode(content('manifests/links.json'));need({'control/'+k:v for k,v in linkmap.items()}==links,'LINK_MANIFEST')
    need(decode(content('manifests/dynamic-bindings.json'))==summary['dynamicBindings'],'DYNAMIC_BINDINGS')
    def resolve(name):
        seen=set()
        while True:
            parts=name.split('/');changed=False
            for i in range(1,len(parts)+1):
                prefix='/'.join(parts[:i])
                if prefix in links:
                    need(prefix not in seen,'LINK_CYCLE');seen.add(prefix)
                    name=posixpath.normpath(posixpath.join(posixpath.dirname(prefix),links[prefix],*parts[i:]));need(name.startswith('control/'),'LINK_ESCAPE');changed=True;break
            if not changed:return name
    for name in links:
        resolved=resolve(name);need(resolved in regular or resolved in directories,'LINK_TARGET_MISSING')
    runtime=maps['control-runtime.json'];git=maps['git-files.json'];source=maps['source-files.json']
    for mapping,prefix in ((runtime,'control/'),(git,'control/.git/'),(source,'source/')):
        need(type(mapping)is dict and mapping,'EMPTY_MANIFEST')
        if prefix=='control/.git/':
            need(all(name in {'HEAD','config','shallow','index'}or re.fullmatch(r'objects/pack/pack-[a-f0-9]{40}\.(pack|idx)',name)for name in mapping),'GIT_MANIFEST_SCOPE')
            need(content('control/.git/HEAD')==(summary['controlRevision']+'\n').encode(),'GIT_HEAD_IDENTITY')
            config=b'[core]\nrepositoryformatversion = 0\nbare = false\nfilemode = true\n'
            need(content('control/.git/config')==config,'GIT_CONFIG_SCOPE')
            if 'shallow'in mapping:need(content('control/.git/shallow')==(summary['controlRevision']+'\n').encode(),'GIT_SHALLOW_IDENTITY')
        for name,pin in mapping.items():
            relative(name);actual=resolve(prefix+name);need(actual in regular and digest(actual)==pin,'DECLARED_FILE_HASH')
    expected_control={resolve('control/'+n)for n in runtime}|{'control/.git/'+n for n in git}
    need({n for n in regular if n.startswith('control/')}==expected_control,'CONTROL_MANIFEST_COMPLETE')
    need({n[7:]for n in regular if n.startswith('source/')}==set(source),'SOURCE_MANIFEST_COMPLETE')
    entry={n[14:]:digest(n)for n,raw in regular.items()if n.startswith('entry-control/')}
    need(entry and sha((json.dumps(entry,sort_keys=True,separators=(',',':'))+'\n').encode())==summary['fixedControlBundleSha256'],'ENTRY_BUNDLE_HASH')
    for name,raw in regular.items():
        if name.startswith('entry-control/'):need(digest('control/'+name[14:])==digest(name),'ENTRY_CONTROL_MATCH')
    need({n for n in regular if n.startswith('entries/')}=={'entries/'+n for n in ENTRY_NAMES},'ENTRY_SET')
    for name,pin in approval['wrapperSha256'].items():need(digest('entries/'+name)==pin,'WRAPPER_HASH')
    need({n for n in regular if n.startswith('manifests/')}=={'manifests/'+n for n in (*META,'links.json','dynamic-bindings.json')},'META_SET')
    # Recheck the compressed bytes after parsing before publishing any content.
    stream.seek(0);after=hashlib.sha256()
    while True:
        block=stream.read(1048576)
        if not block:break
        after.update(block)
    need(after.hexdigest()==summary['archiveSha256'],'ARCHIVE_CHANGED')
    return {'summary':summary,'regular':regular,'links':links,'directories':directories,'modes':modes,'targets':targets(summary)}


def sudo_bytes():
    return b'ghrunner ALL=(root) NOPASSWD: /usr/local/bin/workspacex-cn-fixed-release ^(run|status|reconcile) [a-f0-9]{64}$\nghrunner ALL=(root) NOPASSWD: /usr/local/bin/workspacex-cn-mvp-evidence ^(approval|terminal) [a-f0-9]{64}$\nghrunner ALL=(root) NOPASSWD: /usr/local/bin/workspacex-cn-mvp-prepare-approved ^(prepare|terminal) [a-f0-9]{64}$\n'


def transaction(plan,approval,*,publish,observe_absent,validate_sudo,receipt):
    """Explicit adapter sequence; publication primitive must be NOREPLACE.

    Injectable adapters are isolated test seams, not production CLI callbacks.
    This module does not expose a CLI until the pinned host adapter is supplied.
    """
    expected=set(approval['expectedAbsent'])
    need(all(observe_absent(path)for path in expected),'INSTALL_CAS_CHANGED')
    receipt('intent',{'archiveSha256':plan['summary']['archiveSha256'],'retryAllowed':False})
    for domain,target in plan['targets'].items():
        files={n[len(domain)+1:]:v for n,v in plan['regular'].items()if n.startswith(domain+'/')}
        links={n[8:]:v for n,v in plan['links'].items()}if domain=='control'else{}
        need(observe_absent(str(target)),'INSTALL_CAS_CHANGED');publish(str(target),files,links,{n[len(domain)+1:]:m for n,m in plan['modes'].items()if n.startswith(domain+'/')},[n[len(domain)+1:]for n in plan['directories']if n.startswith(domain+'/')]);receipt(domain,{'target':str(target),'complete':True})
    for name,target in ENTRY_NAMES.items():
        path='/usr/local/bin/'+target;need(observe_absent(path),'INSTALL_CAS_CHANGED');publish(path,plan['regular']['entries/'+name],{},0o700,[]);receipt(name,{'target':path})
    raw=sudo_bytes();need(sha(raw)==approval['sudoSha256'],'SUDO_HASH');need(validate_sudo(raw)is True,'SUDO_VALIDATION_FAILED')
    path='/etc/sudoers.d/workspacex-cn-mvp-fixed-entries';need(observe_absent(path),'INSTALL_CAS_CHANGED');publish(path,raw,{},0o440,[]);receipt('sudo-active',{'target':path})
    return {'installed':True,'productionExecuted':False,'credentialsChanged':False}



def publish_noreplace(target,files,links,modes,directories=()):
    """Stage on destination filesystem; Linux renameat2 prevents replacement."""
    target=Path(target);parent=old.directory(target.parent);temp='.complete-stage-'+os.urandom(12).hex()
    os.mkdir(temp,0o700,dir_fd=parent);stage=os.open(temp,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=parent)
    try:
        root=Path('/proc/self/fd')/str(stage)
        folder=isinstance(files,dict)
        destination=root/target.name
        if folder:
            destination.mkdir(mode=0o700)
            for name in sorted(directories):relative(name);(destination/name).mkdir(parents=True,exist_ok=True,mode=0o700)
        rows=files.items()if folder else [(target.name,files)]
        for name,data in rows:
            relative(name);file=(destination/name)if folder else root/name
            file.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
            mode=modes[name]if folder else modes
            fd=os.open(file,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,mode)
            with os.fdopen(fd,'wb')as output:
                os.fchmod(output.fileno(),mode)
                if isinstance(data,Path):
                    with data.open('rb')as source:shutil.copyfileobj(source,output,1048576)
                else:output.write(data)
                output.flush();os.fsync(output.fileno())
        for name,link in links.items():
            relative(name);file=destination/name;file.parent.mkdir(parents=True,exist_ok=True,mode=0o700);file.symlink_to(link)
        for directory in sorted([p for p in destination.rglob('*')if p.is_dir()and not p.is_symlink()],reverse=True)if folder else []:
            fd=os.open(directory,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
            try:os.fsync(fd)
            finally:os.close(fd)
        if folder:
            fd=os.open(destination,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
            try:os.fsync(fd)
            finally:os.close(fd)
        os.fsync(stage);old.no_replace(parent,stage,target.name);os.fsync(parent)
    finally:
        # Only this invocation's root-private random stage is removed.
        held=os.fstat(stage);visible=os.stat(temp,dir_fd=parent,follow_symlinks=False)
        need((held.st_dev,held.st_ino)==(visible.st_dev,visible.st_ino),'STAGE_REPLACED')
        shutil.rmtree(Path('/proc/self/fd')/str(parent)/temp);os.close(stage);os.close(parent)


def assert_archive_identity(before,fd,parent,name='runtime.tar.gz'):
    """Even unchanged bytes cannot hide a swap or concurrent metadata change."""
    signature=lambda value:(value.st_dev,value.st_ino,value.st_size,value.st_mtime_ns,value.st_ctime_ns)
    after=os.fstat(fd);named=os.stat(name,dir_fd=parent,follow_symlinks=False)
    need(signature(before)==signature(after)==signature(named),'ARCHIVE_IDENTITY_CHANGED')


def assert_lock_identity(held,parent):
    named=os.stat('release.lock',dir_fd=parent,follow_symlinks=False)
    need((held.st_dev,held.st_ino)==(named.st_dev,named.st_ino),'LOCK_CHANGED')


def main():
    need(len(sys.argv)==2 and re.fullmatch('[a-f0-9]{64}',sys.argv[1])and os.geteuid()==os.getegid()==0
        and sys.flags.isolated and sys.flags.no_site and sys.dont_write_bytecode,'EXPLICIT_ROOT_APPROVAL_REQUIRED')
    approval_sha=sys.argv[1];parent=old.directory('/etc/workspacex-cn/complete-runtime-install-approvals')
    try:raw=old.read(parent,approval_sha+'.json',maximum=1048576)
    finally:os.close(parent)
    need(sha(raw)==approval_sha,'INSTALL_APPROVAL_HASH');approval=decode(raw)
    identity_parent=old.directory('/var/lib/cloud/data')
    try:identity=old.read(identity_parent,'instance-id',mode=0o644,maximum=128)
    finally:os.close(identity_parent)
    need(identity.decode('ascii').strip()==TARGET['ecsInstanceId'],'HOST_INSTANCE_IDENTITY')
    inbox=old.directory('/var/lib/workspacex-cn/complete-runtime-inbox/'+approval['archiveSha256'])
    try:
        summary_raw=old.read(inbox,'summary.json',maximum=1048576);summary=validate_authority(summary_raw,approval)
        fd=os.open('runtime.tar.gz',os.O_RDONLY|os.O_NOFOLLOW,dir_fd=inbox)
        st=os.fstat(fd);need(stat.S_ISREG(st.st_mode)and st.st_uid==st.st_gid==0 and st.st_nlink==1 and stat.S_IMODE(st.st_mode)==0o600,'ARCHIVE_TRUST')
        with os.fdopen(fd,'rb')as archive,tempfile.TemporaryDirectory(prefix='complete-verified-',dir='/var/lib/workspacex-cn')as stage:
            plan=inspect_archive(archive,summary,approval,Path(stage))
            assert_archive_identity(st,archive.fileno(),inbox)
            journal=Path('/var/lib/workspacex-cn/complete-runtime-install')/approval_sha
            parent_fd=old.directory(journal.parent)
            try:os.mkdir(journal.name,0o700,dir_fd=parent_fd);os.fsync(parent_fd)
            except FileExistsError:raise ValueError('INSTALL_INTENT_ALREADY_EXISTS')
            finally:os.close(parent_fd)
            def receipt(name,value):
                fd=os.open(journal/(name+'.json'),os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
                with os.fdopen(fd,'wb')as output:output.write((json.dumps(value,sort_keys=True)+'\n').encode());output.flush();os.fsync(output.fileno())
                fd=os.open(journal,os.O_RDONLY|os.O_DIRECTORY)
                try:os.fsync(fd)
                finally:os.close(fd)
            def absent(path):
                fd=old.directory(Path(path).parent)
                try:
                    try:os.stat(Path(path).name,dir_fd=fd,follow_symlinks=False);return False
                    except FileNotFoundError:return True
                finally:os.close(fd)
            def sudo_check(data):
                file=Path(stage)/'sudo-approved';file.write_bytes(data);file.chmod(0o440)
                return subprocess.run(['/usr/sbin/visudo','-c','-f',str(file)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=False,env={'PATH':'/usr/sbin:/usr/bin:/bin'},timeout=15).returncode==0
            lock_parent=old.directory('/var/lib/workspacex-cn/runtime');lock=os.open('release.lock',os.O_RDONLY|os.O_NOFOLLOW,dir_fd=lock_parent)
            try:
                st=os.fstat(lock);need(stat.S_ISREG(st.st_mode)and st.st_uid==st.st_gid==0 and stat.S_IMODE(st.st_mode)==0o600 and st.st_nlink==1,'LOCK_TRUST')
                fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
                assert_lock_identity(st,lock_parent)
                result=transaction(plan,approval,publish=publish_noreplace,observe_absent=absent,validate_sudo=sudo_check,receipt=receipt)
                receipt('complete',result);print(json.dumps(result))
            finally:os.close(lock);os.close(lock_parent)
    finally:os.close(inbox)


if __name__=='__main__':
    try:main()
    except Exception as error:
        code=str(error)if isinstance(error,ValueError)and re.fullmatch('[A-Z][A-Z0-9_]{1,80}',str(error))else 'UNCLASSIFIED_FAILURE'
        print('CN_COMPLETE_RUNTIME_INSTALL_REJECTED:'+code,file=sys.stderr);raise SystemExit(20)
