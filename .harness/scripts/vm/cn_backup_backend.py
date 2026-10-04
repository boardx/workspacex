"""Read-only pg_dump backend attribution. No service or SQL executes at import.

Trusted source owns protected backup approval/provider/runtime verification and
fixed diagnostic query dispatch. noTLS is allowed only by its compiled authority
method verifying the existing exception against the ACTUAL bound session.
transaction_read_only of another backend is not exposed by pg_stat_activity:
this reports pinned-pg_dump implementation attestation, never SQL-observed on.
"""
import hashlib
import os
import pathlib
import re
import time
from candidate_backend_collector import tcp_rows, process_snapshot, CANDIDATE_SESSION_SQL
from cn_backup_package import IMAGE, ROLE, validate
from writer_fence import DATABASES, digest, require

BACKUP_SESSION_SQL = CANDIDATE_SESSION_SQL.replace("'state',state",
                    "'applicationName',application_name,'state',state").replace("FROM pg_stat_activity WHERE datname=current_database()", "FROM pg_stat_activity WHERE datname=current_database() AND usename='wsx_release_backup_ro'")

PG_DUMP_ARGV = ('--format=custom', '--serializable-deferrable',
                '--lock-wait-timeout=5000', '--no-password')

class BackupBackendCollector:
    def __init__(self, source, proc_root='/proc'):
        self.source=source; self.proc=pathlib.Path(proc_root)

    def collect(self, plan, db, container_id, process_pid, application_name,
                require_sql_observed_read_only=False):
        started=time.time();identity=validate(plan)
        require(require_sql_observed_read_only is False, 'BACKUP_OTHER_SESSION_READONLY_NOT_OBSERVABLE')
        require(db in DATABASES and type(process_pid) is int and process_pid>1 and
                type(container_id) is str and re.fullmatch('[a-f0-9]{64}',container_id) and
                type(application_name) is str and application_name and len(application_name)<=63,
                'BACKUP_BACKEND_CONTEXT')
        # This authority MUST verify protected owner/application-name approval and
        # provider binding; user-supplied strings do not establish ownership.
        self.source.verify_backup_context(plan,db,container_id,process_pid,application_name)
        pinned=self.source.verified_pg_dump16()
        require(pinned['imageId']==IMAGE and pinned['versionMajor']==16 and
                re.fullmatch('[a-f0-9]{64}',pinned['sha256']) and
                pinned['exePath'].startswith('/') and '..' not in pathlib.Path(pinned['exePath']).parts,
                'BACKUP_PINNED_PGDUMP16_REQUIRED')
        p=self.proc/str(process_pid);before=process_snapshot(p)
        require(before['cgroupContainerId']==container_id and
                before['networkNamespace']==os.readlink(self.proc/'1/ns/net'),
                'BACKUP_HOST_NETWORK_PROCESS')
        exe=os.readlink(p/'exe')
        require(exe==pinned['exePath'] and not exe.endswith(' (deleted)'), 'BACKUP_EXE_IDENTITY')
        binary=p/'root'/exe.lstrip('/')
        require(hashlib.sha256(binary.read_bytes()).hexdigest()==pinned['sha256'], 'BACKUP_EXE_HASH')
        argv=(p/'cmdline').read_bytes().split(b'\0')
        require(argv[-1]==b'' and tuple(a.decode() for a in argv[1:-1])==PG_DUMP_ARGV and
                argv[0].decode() in ('pg_dump',exe), 'BACKUP_PGDUMP_CMDLINE')
        containers=self.source.docker_inventory()
        live=[c for c in containers if c['Id']==container_id]
        require(len(live)==1 and live[0]['Image']==IMAGE and
                live[0]['HostConfig']['NetworkMode']=='host' and
                live[0]['State']['Running'] is True and live[0]['State']['Paused'] is False,
                'BACKUP_CONTAINER_IMAGE_NETWORK_STATE')
        observed=self.source.read_backup_database_sessions(db)  # fixed BACKUP_SESSION_SQL only
        peer=observed['peer']
        require(peer['database']==db and peer['serverAddr']=='192.168.100.44' and
                peer['serverPort']==5432 and observed['preparedTransactions']==[], 'BACKUP_DATABASE_PEER')
        rows=[r for r in observed['sessions'] if r['role']==ROLE and r['applicationName']==application_name]
        require(len(rows)==1,'BACKUP_DUMP_BACKEND_UNIQUE')
        row=rows[0]
        require(type(row['pid']) is int and row['pid']>1 and row['backendStart'] and
                row['backendType']=='client backend' and row['clientAddr']=='192.168.100.40',
                'BACKUP_DUMP_SESSION_IDENTITY')
        tcp=tcp_rows((self.proc/'net/tcp').read_text())
        sockets=[s for s in tcp if s['localAddr']==row['clientAddr'] and
                 s['localPort']==row['clientPort'] and s['remoteAddr']==peer['serverAddr'] and
                 s['remotePort']==5432]
        require(len(sockets)==1,'BACKUP_DIRECT_SOCKET_REQUIRED');sock=sockets[0]
        expected='socket:['+str(sock['socketInode'])+']';owners=[];fd_links=[]
        for path in self.proc.iterdir():
            if not path.name.isdecimal() or int(path.name)<=1:continue
            for fd in (path/'fd').iterdir():
                link=os.readlink(fd)
                if link==expected:
                    owners.append(int(path.name));fd_links.append((fd,link))
        require(set(owners)=={process_pid},'BACKUP_SOCKET_NOT_EXCLUSIVELY_PGDUMP')
        facts=dict(database=db,peer=peer,session=row,containerId=container_id,
                   processPid=process_pid,processStart=before['processStart'],socket=sock,
                   identity=identity,applicationName=application_name)
        require(type(row['ssl']) is bool,'BACKUP_SESSION_TLS_SCHEMA')
        if not row['ssl']:
            authority=getattr(self.source,'verify_existing_no_tls_exception',None)
            require(callable(authority) and authority(plan,facts) is True,
                    'BACKUP_EXISTING_NO_TLS_AUTHORITY_REQUIRED')
        self.source.verify_backup_peer(plan,peer)  # actual systemIdentifier/provider match
        require(process_snapshot(p)==before and os.readlink(p/'exe')==exe and
                (p/'cmdline').read_bytes().split(b'\0')==argv and
                hashlib.sha256(binary.read_bytes()).hexdigest()==pinned['sha256'], 'BACKUP_PROCESS_RACE')
        require(all(os.readlink(fd)==link for fd,link in fd_links) and
                tcp_rows((self.proc/'net/tcp').read_text())==tcp,'BACKUP_SOCKET_RACE')
        require(self.source.read_backup_database_sessions(db)==observed and
                self.source.docker_inventory()==containers,'BACKUP_BACKEND_OR_CONTAINER_RACE')
        self.source.verify_backup_context(plan,db,container_id,process_pid,application_name)
        require(0<=time.time()-started<=30,'BACKUP_BACKEND_OBSERVATION_STALE')
        return dict(kind='live-owned-pgdump-backend',identity=identity,observedAt=started,
                    facts=facts,evidenceSha256=digest(facts),
                    readOnlyEvidence={'kind':'pinned-pgdump16-implementation-attestation',
                    'sqlObserved':False,'imageId':IMAGE,'exeSha256':pinned['sha256'],
                    'contract':'pg_dump serializable-deferrable read-only snapshot; precheck PID excluded'})
