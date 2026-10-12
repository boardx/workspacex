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
