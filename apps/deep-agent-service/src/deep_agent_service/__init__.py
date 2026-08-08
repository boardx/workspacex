"""`deep_agent_service` -- the wrapper that turns an organization's imported Skills into
dynamic `deepagents` tools (#739, architecture decided in #738).

See `graph.py` for why this is intentionally thin: `deepagents` does the planning/todo/
sub-agent work, this package only supplies the model and the two org-scoped tools.
"""
