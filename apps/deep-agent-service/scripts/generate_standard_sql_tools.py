"""Native SQL Toolkit schemas are generated from the exact installed upstream."""
import json
import sys
import hashlib
from importlib.metadata import version
from pathlib import Path
from langchain_community.agent_toolkits.sql.toolkit import SQLDatabaseToolkit
from langchain_community.utilities.sql_database import SQLDatabase
import langchain_community.utilities.sql_database as database_module
from langchain_core.language_models.fake import FakeListLLM
class Dialect(SQLDatabase):
    def __init__(self):pass
    @property
    def dialect(self):return 'postgresql'
root=Path(__file__).resolve().parents[3]
if version('langchain-community')!='0.4.2':raise RuntimeError('review the SQL Toolkit version before regenerating')
tools=SQLDatabaseToolkit(db=Dialect(),llm=FakeListLLM(responses=['SELECT 1'])).get_tools()
content=json.dumps({'package':'langchain-community','version':'0.4.2','databaseSourceSha256':hashlib.sha256(Path(database_module.__file__).read_bytes()).hexdigest(),'tools':{tool.name:tool.args_schema.model_json_schema() for tool in tools}},indent=2)+'\n'
for path in [root/'packages/contracts/src/generated/standard-sql-tools.json',root/'apps/deep-agent-service/src/deep_agent_service/generated/standard_sql_tools.json']:
    if '--check' in sys.argv:
        if path.read_text()!=content:raise RuntimeError('SQL Toolkit schemas stale')
    else:path.write_text(content)
