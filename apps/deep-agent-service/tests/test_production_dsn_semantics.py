"""Real libpq parsing counterexamples behind the deployment DSN allowlist.

No database/network needed: conninfo_to_dict uses the installed psycopg/libpq parser.
The TypeScript boundary tests reject each of these caller-supplied URI forms.
"""
import pytest
from psycopg.conninfo import conninfo_to_dict


@pytest.mark.parametrize("query, key, expected", [
    ("sslmode=verify-full&sslmode=disable", "sslmode", "disable"),
    ("sslmode=verify-full&user=memory_owner", "user", "memory_owner"),
    ("sslmode=verify-full&dbname=memory", "dbname", "memory"),
    ("sslmode=verify-full&host=other.example", "host", "other.example"),
    ("sslmode=verify-full&port=5433", "port", "5433"),
    ("sslmode=verify-full&password=override", "password", "override"),
])
def test_libpq_query_parameters_override_authority_and_last_tls_wins(query, key, expected):
    parsed = conninfo_to_dict("postgresql://graph_owner:placeholder@db.example/graph?" + query)
    assert parsed[key] == expected
