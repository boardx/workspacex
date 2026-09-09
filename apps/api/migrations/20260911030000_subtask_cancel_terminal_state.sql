-- 已确认取消、却卡在 `failed` 的存量子任务归位到 `cancelled`。
--
-- 旧的 recordCancellation 只允许 running->cancelled 这一跳；对账把 cancellation_state
-- 确认成 'confirmed' 之后，行仍留在 'failed'，只有 error 被换成一个专门的标记串。
-- 那个标记串就是"系统已知这是被取消的"的唯一凭据，据此归位；listCancellationRecovery
-- 只扫 running/unknown，不会再回访这些行，所以必须一次性修数据。
--
-- 边界：取消之前就真失败的子任务 error 是它自己的错因、cancel_requested_at 为 NULL，
-- 三个条件都不满足，一行都不动。
UPDATE subtask_runs
   SET status='cancelled', error=NULL, result=NULL, updated_at=now()
 WHERE status='failed'
   AND cancellation_state='confirmed'
   AND error='subtask_cancelled_after_reconciliation';
