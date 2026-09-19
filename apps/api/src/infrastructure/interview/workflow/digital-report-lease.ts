/** A stalled stream can be explicitly replaced after five minutes without durable progress. */
export const DIGITAL_REPORT_STALE_SQL = "updated_at < now() - interval '5 minutes'";
