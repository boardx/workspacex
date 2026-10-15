"""Read actual isolated PG peer; retain the production probe's inet text bytes."""
import json
PEER_SQL="SELECT json_build_object('database',current_database(),'serverAddr',inet_server_addr()::text,'hostAddress',host(inet_server_addr()),'serverPort',inet_server_port(),'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()));"
def read_peer(sql, database, config):
    value=json.loads(sql(database,PEER_SQL))
    if (type(value)is not dict or set(value)!={'database','serverAddr','hostAddress','serverPort','systemIdentifier'}
        or value['database']!=database or value['hostAddress']!='127.0.0.1'
        or value['serverAddr'] not in ('127.0.0.1','127.0.0.1/32')
        or type(value['serverPort'])is not int or value['serverPort']!=config['port']
        or value['systemIdentifier']!=config['systemIdentifier']):
        raise RuntimeError('FIXTURE_DATABASE_PEER')
    return {key:value[key]for key in ('database','serverAddr','serverPort','systemIdentifier')}

def sql_error_code(stderr):
    # Only named exceptions emitted by original fixed_probes.login_cas_sql.
    import re
    for code in ('LOGIN_PEER_CAS','LOGIN_STATE_CAS'):
        if re.search(rb'(?:ERROR|FATAL):\s+'+code.encode()+rb'(?:\r?\n|$)',stderr[:8192]):return code
    return 'FIXTURE_SQL_FAILED'

def isolated_socket_seal(plan,nonce,config):
    """Synthetic socket/container fixture, bound to the separately read PG peer.

    This is not an observation of real container sockets. The original ownership
    verifier remains intact; only the isolated fixture's endpoint is parameterized.
    """
    from test_candidate_writer import seal_fixture
    from writer_fence import DATABASES
    for db in DATABASES:
        peer=plan['databasePeers'][db]
        if (peer.get('database')!=db or peer.get('serverAddr')not in ('127.0.0.1','127.0.0.1/32')
            or type(peer.get('serverPort'))is not int or not 1024<peer['serverPort']<65536
            or peer['serverPort']!=config['port'] or peer.get('systemIdentifier')!=config['systemIdentifier']):
            raise RuntimeError('FIXTURE_DATABASE_PEER')
    proof=seal_fixture(plan,nonce)
    for db in DATABASES:
        for witness in proof['socketWitnesses'][db]:
            witness['remoteAddr']=plan['databasePeers'][db]['serverAddr']
            witness['remotePort']=plan['databasePeers'][db]['serverPort']
    return proof
