"""Read-only IPv4 namespace-aware backend collector; no command runs at import.

Trusted source must supply require_lock/read_hold/read_host/docker_inventory and
read_candidate_database_sessions(db), plus complete read_candidate_conntrack() for SNAT. The latter is a NEW fixed diagnostic query
operation below, not arbitrary SQL. Current HostTransport has no such operation.
/proc reads require complete visibility; permissions, races, NAT, shared socket
ownership and unsupported network modes fail closed. TLS exceptions require fresh target-bound provider authority.
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


def conntrack_rows(raw):
    """Normalize a complete host nf_conntrack snapshot; unsupported TCP fails closed."""
    require(type(raw) is str, 'COLLECTOR_CONNTRACK_SCHEMA')
    rows = []
    for line in raw.splitlines():
        fields = line.split()
        if 'tcp' not in fields:
            continue
        require('ESTABLISHED' in fields and '[ASSURED]' in fields,
                'COLLECTOR_CONNTRACK_TCP_STATE')
        values = {key: re.findall(r'(?:^|\s)' + key + r'=([^\s]+)', line)
                  for key in ('src', 'dst', 'sport', 'dport')}
        require(all(len(v) == 2 for v in values.values()), 'COLLECTOR_CONNTRACK_SCHEMA')
        directions = []
        for n in range(2):
            for key in ('src', 'dst'):
                socket.inet_pton(socket.AF_INET, values[key][n])
            require(all(values[key][n].isdecimal() and 0 < int(values[key][n]) < 65536
                        for key in ('sport', 'dport')), 'COLLECTOR_CONNTRACK_SCHEMA')
            directions.append(dict(srcAddr=values['src'][n], dstAddr=values['dst'][n],
                                   srcPort=int(values['sport'][n]), dstPort=int(values['dport'][n])))
        rows.append(dict(original=directions[0], reply=directions[1]))
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

    def _guard(self, plan, expected_hold_state='held'):
        self.source.require_lock()
        hold = self.source.read_hold()
        require(hold == dict(schemaVersion=1, state=expected_hold_state, generation=plan['holdGeneration'],
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
                require(live['HostConfig']['NetworkMode'] not in ('none', 'container') and
                        live['State']['Running'] is True and live['State']['Paused'] is False,
                        'COLLECTOR_NETWORK_OR_RUNNING_REQUIRED')
                labels = live['Config'].get('Labels', {})
                require(labels.get('com.docker.compose.service') == b['service'] and
                        labels.get('com.docker.compose.project.config_files') == b['composePath'],
                        'COLLECTOR_COMPOSE_IDENTITY')
                bindings[b['containerId']] = writer
        return bindings

    def _tls(self, plan, db, row):
        if row['ssl'] is True:
            return True
        require(row['ssl'] is False, 'COLLECTOR_CLIENT_TLS_REQUIRED')
        read = getattr(self.source, 'read_candidate_transport_evidence', None)
        require(callable(read), 'COLLECTOR_TLS_AUTHORITY_REQUIRED')
        evidence = read(db)
        # The retained trusted helper invokes the existing shared transport verifier;
        # this consumer only validates its safe output, never redefines TLS policy.
        require(type(evidence) is dict and set(evidence) == {
                    'schemaVersion', 'kind', 'identity', 'peer', 'endpoint', 'observedAt', 'proof'},
                'COLLECTOR_TLS_AUTHORITY_SCHEMA')
        require(evidence['schemaVersion'] == 1
                and evidence['kind'] == 'existing-production-maintenance-transport-verified'
                and evidence['identity'] == plan['identity']
                and evidence['peer'] == plan['databasePeers'][db]
                and type(evidence['observedAt']) in (int, float)
                and 0 <= time.time() - evidence['observedAt'] <= 30,
                'COLLECTOR_TLS_AUTHORITY_BINDING')
        endpoint = evidence['endpoint']
        require(type(endpoint) is dict and set(endpoint) == {'address', 'port'}
                and type(endpoint['address']) is str
                and type(endpoint['port']) is int and endpoint['port'] == plan['databasePeers'][db]['serverPort']
                and 0 < endpoint['port'] < 65536, 'COLLECTOR_TLS_ENDPOINT_BINDING')
        socket.inet_pton(socket.AF_INET, endpoint['address'])
        require(plan['databasePeers'][db]['serverAddr'] in (None, endpoint['address']),
                'COLLECTOR_TLS_ENDPOINT_BINDING')
        proof = evidence['proof']
        require(type(proof) is dict and set(proof) == {
                    'sslMode', 'configurationSha256', 'providerEvidenceSha256'}
                and proof['sslMode'] == 'disable'
                and all(type(proof[k]) is str and re.fullmatch('[a-f0-9]{64}', proof[k])
                        for k in ('configurationSha256', 'providerEvidenceSha256')),
                'COLLECTOR_TLS_PROVIDER_AUTHORITY')
        repeated = read(db)
        require(type(repeated) is dict and set(repeated) == set(evidence)
                and type(repeated['observedAt']) in (int, float)
                and 0 <= time.time() - repeated['observedAt'] <= 30
                and {k:v for k,v in repeated.items() if k != 'observedAt'} ==
                    {k:v for k,v in evidence.items() if k != 'observedAt'},
                'COLLECTOR_TLS_AUTHORITY_RACE')
        return evidence

    def collect_opened(self, plan, nonce):
        return self.collect(plan, nonce, expected_hold_state='cleared')

    def collect(self, plan, nonce, expected_hold_state='held'):
        require(expected_hold_state in ('held', 'cleared'), 'COLLECTOR_HOLD_STATE')
        started = time.time()
        self._guard(plan, expected_hold_state)
        require(type(nonce) is str and re.fullmatch('[a-f0-9]{64}', nonce), 'COLLECTOR_NONCE')
        bindings = self._containers(plan)
        netns = os.readlink(self.proc / '1/ns/net')
        tcp_by_namespace = {netns: tcp_rows((self.proc / 'net/tcp').read_text())}
        namespace_reads = [(self.proc / 'net/tcp', tcp_by_namespace[netns])]
        owners = {}
        fd_links = []
        process_reads = []
        database_reads = {}
        conntrack_read = getattr(self.source, 'read_candidate_conntrack', None)
        conntrack = conntrack_read() if callable(conntrack_read) else None
        if conntrack is not None:
            require(type(conntrack) is list, 'COLLECTOR_CONNTRACK_SCHEMA')
        # Complete scan: permission errors are intentionally not ignored.
        process_paths = sorted(path for path in self.proc.iterdir() if path.name.isdecimal() and int(path.name) > 1)
        process_fds = {}
        for path in process_paths:
            if not path.name.isdecimal() or int(path.name) <= 1: continue
            before = process_snapshot(path)
            process_reads.append((path, before))
            namespace = before['networkNamespace']
            if namespace not in tcp_by_namespace:
                table = path / 'net/tcp'
                try:
                    rows = tcp_rows(table.read_text())
                except OSError as error:
                    raise RuntimeError('COLLECTOR_NAMESPACE_VISIBILITY') from error
                tcp_by_namespace[namespace] = rows
                namespace_reads.append((table, rows))
            fds = sorted((path / 'fd').iterdir())
            process_fds[path] = fds
            for fd in fds:
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
                transport = self._tls(plan, db, row)
                require(row['backendType'] == 'client backend' and transport,
                        'COLLECTOR_CLIENT_TLS_REQUIRED')
                if matches:
                    require(len(matches) == 1, 'COLLECTOR_HELD_SESSION_ALIAS')
                    held_seen.add(row['pid']); continue
                require(row['role'] in plan['candidateRoles'][db], 'COLLECTOR_FOREIGN_ROLE')
                endpoint_authority = None
                remote_address = peer['serverAddr']
                if remote_address is None:
                    require(type(transport) is dict, 'COLLECTOR_NULL_PEER_AUTHORITY_REQUIRED')
                    remote_address = transport['endpoint']['address']
                    endpoint_authority = dict(address=remote_address, port=transport['endpoint']['port'],
                        configurationSha256=transport['proof']['configurationSha256'],
                        providerEvidenceSha256=transport['proof']['providerEvidenceSha256'])
                sockets = [dict(r, _namespace=ns) for ns, rows in tcp_by_namespace.items() for r in rows if r['localAddr'] == row['clientAddr'] and
                           r['localPort'] == row['clientPort'] and r['remoteAddr'] == remote_address and
                           r['remotePort'] == peer['serverPort']]
                translation = None
                if not sockets:
                    require(conntrack is not None, 'COLLECTOR_CONNTRACK_REQUIRED')
                    joined = []
                    for entry in conntrack:
                        require(type(entry) is dict and set(entry) == {'original', 'reply'}, 'COLLECTOR_CONNTRACK_SCHEMA')
                        original, reply = entry['original'], entry['reply']
                        for direction in (original, reply):
                            require(type(direction) is dict and set(direction) == {'srcAddr', 'srcPort', 'dstAddr', 'dstPort'}
                                    and all(type(direction[k]) is int and 0 < direction[k] < 65536 for k in ('srcPort', 'dstPort')),
                                    'COLLECTOR_CONNTRACK_SCHEMA')
                            for k in ('srcAddr', 'dstAddr'):
                                require(type(direction[k]) is str, 'COLLECTOR_CONNTRACK_SCHEMA')
                                socket.inet_pton(socket.AF_INET, direction[k])
                        if reply != dict(srcAddr=remote_address,srcPort=peer['serverPort'],
                                         dstAddr=row['clientAddr'],dstPort=row['clientPort']):
                            continue
                        for ns, rows in tcp_by_namespace.items():
                            if ns == netns: continue
                            for candidate in rows:
                                if original == dict(srcAddr=candidate['localAddr'],srcPort=candidate['localPort'],
                                                    dstAddr=candidate['remoteAddr'],dstPort=candidate['remotePort']) and \
                                        candidate['remoteAddr'] == remote_address and candidate['remotePort'] == peer['serverPort']:
                                    joined.append((dict(candidate, _namespace=ns), copy.deepcopy(entry)))
                    require(len(joined) == 1, 'COLLECTOR_CONNTRACK_UNIQUE_JOIN')
                    sockets = [joined[0][0]]; translation = joined[0][1]
                require(len(sockets) == 1, 'COLLECTOR_DIRECT_SOCKET_REQUIRED')
                sock = sockets[0]; namespace = sock.pop('_namespace'); inode = sock['socketInode']
                require(len(owners.get(inode, [])) == 1, 'COLLECTOR_SOCKET_OWNER_AMBIGUOUS')
                owner = owners[inode][0]
                require(owner['networkNamespace'] == namespace and owner['cgroupContainerId'] in bindings,
                        'COLLECTOR_CANDIDATE_SOCKET_OWNER')
                writer = bindings[owner['cgroupContainerId']]; binding = writer['binding']
                live = next(v for v in self.source.docker_inventory() if v['Id'] == binding['containerId'])
                mode = live['HostConfig']['NetworkMode']
                require((mode == 'host') == (namespace == netns), 'COLLECTOR_NETWORK_NAMESPACE_BINDING')
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
                    pgClientPort=row['clientPort'],peerSha256=digest(peer),**sock,
                    **(dict(networkNamespace=namespace, conntrack=translation) if translation is not None else {}),
                    **(dict(endpointAuthority=endpoint_authority) if endpoint_authority is not None else {})))
            require(held_seen == {h['pid'] for h in held}, 'COLLECTOR_HELD_SESSION_MISSING')
        # Recheck tuple and ownership after DB reads; no stale snapshot on return.
        require(sorted(path for path in self.proc.iterdir() if path.name.isdecimal() and int(path.name) > 1) == process_paths,
                'COLLECTOR_PROCESS_SET_RACE')
        for path, before in process_reads:
            require(sorted((path / 'fd').iterdir()) == process_fds[path], 'COLLECTOR_FD_SET_RACE')
            require(process_snapshot(path) == before, 'COLLECTOR_PROCESS_RACE')
        for fd, link in fd_links:
            require(os.readlink(fd) == link, 'COLLECTOR_FD_RACE')
        for db in DATABASES:
            require(self.source.read_candidate_database_sessions(db) == database_reads[db],
                    'COLLECTOR_DATABASE_SESSION_RACE')
        for table, rows in namespace_reads:
            require(tcp_rows(table.read_text()) == rows, 'COLLECTOR_SOCKET_RACE')
        if conntrack is not None:
            require(conntrack_read() == conntrack, 'COLLECTOR_CONNTRACK_RACE')
        require(self._containers(plan) == bindings, 'COLLECTOR_CONTAINER_RACE')
        self._guard(plan, expected_hold_state)
        proof = dict(identity=plan['identity'],host=plan['host'],epoch=plan['epoch'],
                     holdGeneration=plan['holdGeneration'],nonce=nonce,observedAt=started,
                     source='live-pg-client-port-and-host-socket-cgroup',databasePeers=plan['databasePeers'],
                     sessions=sessions,socketWitnesses=witnesses)
        verify_candidate_backend_seal(plan, nonce, proof)
        return proof
