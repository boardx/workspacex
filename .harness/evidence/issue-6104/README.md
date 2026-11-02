# Cumulative grant precision — issue #6104

The private PostgreSQL run first exposed five business failures, two invalid fixture IDs and one passing guard. Correcting only those IDs and applying the new migration produced eight passing cases in the same owned database. The wrapper then cleaned its resources.

Coverage: exact decimal user/team counters; concurrent hundredth grants; existing monthly issuer and duplicate replay; rollback at the cumulative limit; actual registration welcome trigger preserving a fraction; lower/upper SQL bounds. Production arithmetic remains decimal SQL or integer hundredths; existing raw-query tests explicitly deserialize numeric counters.

Historical welcome migration is unchanged. The shared trigger generator preserves its old default output and generates the decimal successor in migration 20261102030500. No live environment reset or epoch activation occurred.

Full package checks and independent review remain separate gates; these logs do not claim their completion.
