"""Read-only IPv4 host-network backend collector; no command runs at import.

Trusted source must supply require_lock/read_hold/read_host/docker_inventory and
read_candidate_database_sessions(db). The latter is a NEW fixed diagnostic query
operation below, not arbitrary SQL. Current HostTransport has no such operation.
/proc reads require complete visibility; permissions, races, NAT, shared socket
ownership and unsupported network modes fail closed. No TLS exception supported.
"""
import copy
import os
import pathlib
import re
import socket
import time
from candidate_writer import verify_candidate_backend_seal
from writer_fence import DATABASES, digest, require

CANDIDATE_SESSION_SQL = """BEGIN TRANSACTION READ ONLY;
SELECT json_build_object('peer',json_build_object('database',current_database(),
 'serverAddr',inet_server_addr()::text,'serverPort',inet_server_port(),
 'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system())),
 'sessions',coalesce((SELECT json_agg(json_build_object('role',usename,
 'clientAddr',client_addr::text,'clientPort',client_port,'pid',pid,
 'backendStart',backend_start,'backendType',backend_type,'state',state,
 'ssl',(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_stat_activity.pid)))
 FROM pg_stat_activity WHERE datname=current_database()),'[]'::json),
 'preparedTransactions',coalesce((SELECT json_agg(json_build_object('gid',gid,
 'owner',owner,'database',database)) FROM pg_prepared_xacts
 WHERE database=current_database()),'[]'::json)); ROLLBACK;"""


def endpoint(raw):
    addr, port = raw.split(':')
    require(re.fullmatch('[A-Fa-f0-9]{8}', addr) is not None, 'COLLECTOR_IPV4_ONLY')
    return socket.inet_ntoa(bytes.fromhex(addr)[::-1]), int(port, 16)


def tcp_rows(raw):
    rows = []
    for line in raw.splitlines()[1:]:
        fields = line.split()
        require(len(fields) >= 10, 'COLLECTOR_TCP_SCHEMA')
        if fields[3] != '01': continue  # ESTABLISHED
        local, remote = endpoint(fields[1]), endpoint(fields[2])
        inode = int(fields[9])
        require(inode > 0, 'COLLECTOR_TCP_INODE')
        rows.append(dict(localAddr=local[0], localPort=local[1],
                         remoteAddr=remote[0], remotePort=remote[1], socketInode=inode))
    return rows


def process_snapshot(path):
    raw = (path / 'stat').read_text()
    tail = raw[raw.rfind(')') + 2:].split()
    require(len(tail) > 19 and tail[0] not in ('Z', 'X'), 'COLLECTOR_PROCESS_STAT')
    start = tail[19]
    require(start.isdecimal(), 'COLLECTOR_PROCESS_START')
    cgroup = (path / 'cgroup').read_text()
    ids = set(re.findall(r'(?:/docker/|/docker-)([a-f0-9]{64})(?:\.scope|(?:/|$))', cgroup, re.M))
    require(len(ids) <= 1, 'COLLECTOR_CGROUP_AMBIGUOUS')
    return dict(processStart=start, cgroupContainerId=next(iter(ids), None), cgroup=cgroup,
                networkNamespace=os.readlink(path / 'ns/net'))


class CandidateBackendCollector:
    def __init__(self, source, proc_root='/proc'):
        self.source = source
        self.proc = pathlib.Path(proc_root)

    def _guard(self, plan):
        self.source.require_lock()
        hold = self.source.read_hold()
        require(hold == dict(schemaVersion=1, state='held', generation=plan['holdGeneration'],
                            identity=plan['identity']), 'COLLECTOR_HOLD_DRIFT')
        require(self.source.read_host() == plan['host'], 'COLLECTOR_HOST_DRIFT')

    def _containers(self, plan):
        inventory = self.source.docker_inventory()
        require(type(inventory) is list and len({v['Id'] for v in inventory}) == len(inventory),
                'COLLECTOR_CONTAINER_INVENTORY')
        indexed = {v['Id']: v for v in inventory}
        bindings = {}
        for writer in plan['candidateWriters'] + plan['baselineWriters']:
            b = writer['binding']; live = indexed.get(b['containerId'])
            require(live is not None and live['Image'] == b['imageId'] and
                    digest(live['Config']) == b['configSha256'], 'COLLECTOR_CONTAINER_IDENTITY')
            if writer in plan['baselineWriters']:
                require(not live['State']['Running'] or live['State']['Paused'],
                        'COLLECTOR_BASELINE_RUNNING')
            else:
                require(live['HostConfig']['NetworkMode'] == 'host' and
                        live['State']['Running'] is True and live['State']['Paused'] is False,
                        'COLLECTOR_HOST_NETWORK_REQUIRED')
                labels = live['Config'].get('Labels', {})
                require(labels.get('com.docker.compose.service') == b['service'] and
                        labels.get('com.docker.compose.project.config_files') == b['composePath'],
                        'COLLECTOR_COMPOSE_IDENTITY')
                bindings[b['containerId']] = writer
        return bindings

    def collect(self, plan, nonce):
        started = time.time()
        self._guard(plan)
        require(type(nonce) is str and re.fullmatch('[a-f0-9]{64}', nonce), 'COLLECTOR_NONCE')
        bindings = self._containers(plan)
        netns = os.readlink(self.proc / '1/ns/net')
        tcp = tcp_rows((self.proc / 'net/tcp').read_text())
        owners = {}
        fd_links = []
        process_reads = []
        database_reads = {}
        # Complete scan: permission errors are intentionally not ignored.
        for path in self.proc.iterdir():
            if not path.name.isdecimal() or int(path.name) <= 1: continue
            before = process_snapshot(path)
            process_reads.append((path, before))
            for fd in (path / 'fd').iterdir():
                link = os.readlink(fd)
                match = re.fullmatch(r'socket:\[([0-9]+)\]', link)
                if match:
                    fd_links.append((fd, link))
                    inode = int(match[1]); owner = dict(before, processPid=int(path.name))
                    if owner not in owners.setdefault(inode, []): owners[inode].append(owner)
            require(process_snapshot(path) == before, 'COLLECTOR_PROCESS_RACE')
        sessions = {db: [] for db in DATABASES}
        witnesses = {db: [] for db in DATABASES}
        for db in DATABASES:
            observed = self.source.read_candidate_database_sessions(db)
            database_reads[db] = copy.deepcopy(observed)
            peer = plan['databasePeers'][db]
            require(observed['peer'] == peer and observed['preparedTransactions'] == [],
                    'COLLECTOR_DATABASE_PEER_OR_PREPARED')
            held = plan['heldSessions'][db]
            held_seen = set()
            for row in observed['sessions']:
                matches = [h for h in held if h['pid'] == row['pid'] and
                           h['backendStart'] == row['backendStart'] and h['role'] == row['role']]
                require(row['backendType'] == 'client backend' and row['ssl'] is True,
                        'COLLECTOR_CLIENT_TLS_REQUIRED')
                if matches:
                    require(len(matches) == 1, 'COLLECTOR_HELD_SESSION_ALIAS')
                    held_seen.add(row['pid']); continue
                require(row['role'] in plan['candidateRoles'][db], 'COLLECTOR_FOREIGN_ROLE')
                sockets = [r for r in tcp if r['localAddr'] == row['clientAddr'] and
                           r['localPort'] == row['clientPort'] and r['remoteAddr'] == peer['serverAddr'] and
                           r['remotePort'] == peer['serverPort']]
                require(len(sockets) == 1, 'COLLECTOR_DIRECT_SOCKET_REQUIRED')
                sock = sockets[0]; inode = sock['socketInode']
                require(len(owners.get(inode, [])) == 1, 'COLLECTOR_SOCKET_OWNER_AMBIGUOUS')
                owner = owners[inode][0]
                require(owner['networkNamespace'] == netns and owner['cgroupContainerId'] in bindings,
                        'COLLECTOR_CANDIDATE_SOCKET_OWNER')
                writer = bindings[owner['cgroupContainerId']]; binding = writer['binding']
                path = self.proc / str(owner['processPid'])
                require(process_snapshot(path) == {k:v for k,v in owner.items() if k != 'processPid'},
                        'COLLECTOR_PROCESS_RACE')
                require(row['state'] in ('idle', 'active', 'idle in transaction'), 'COLLECTOR_BACKEND_STATE')
                session = dict(pid=row['pid'], backendStart=row['backendStart'], role=row['role'],
                    transactionMode=row['state'], backendType=row['backendType'], peerSha256=digest(peer),
                    writerKey=writer['key'], binding=copy.deepcopy(binding))
                sessions[db].append(session)
                witnesses[db].append(dict(pid=row['pid'],backendStart=row['backendStart'],writerKey=writer['key'],
                    containerId=binding['containerId'],imageId=binding['imageId'],configSha256=binding['configSha256'],
                    processPid=owner['processPid'],processStart=owner['processStart'],
                    cgroupContainerId=owner['cgroupContainerId'],pgClientAddr=row['clientAddr'],
                    pgClientPort=row['clientPort'],peerSha256=digest(peer),**sock))
            require(held_seen == {h['pid'] for h in held}, 'COLLECTOR_HELD_SESSION_MISSING')
        # Recheck tuple and ownership after DB reads; no stale snapshot on return.
        for path, before in process_reads:
            require(process_snapshot(path) == before, 'COLLECTOR_PROCESS_RACE')
        for fd, link in fd_links:
            require(os.readlink(fd) == link, 'COLLECTOR_FD_RACE')
        for db in DATABASES:
            require(self.source.read_candidate_database_sessions(db) == database_reads[db],
                    'COLLECTOR_DATABASE_SESSION_RACE')
        require(tcp_rows((self.proc / 'net/tcp').read_text()) == tcp, 'COLLECTOR_SOCKET_RACE')
        require(self._containers(plan) == bindings, 'COLLECTOR_CONTAINER_RACE')
        self._guard(plan)
        proof = dict(identity=plan['identity'],host=plan['host'],epoch=plan['epoch'],
                     holdGeneration=plan['holdGeneration'],nonce=nonce,observedAt=started,
                     source='live-pg-client-port-and-host-socket-cgroup',databasePeers=plan['databasePeers'],
                     sessions=sessions,socketWitnesses=witnesses)
        verify_candidate_backend_seal(plan, nonce, proof)
        return proof
