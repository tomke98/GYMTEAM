CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_unique_active_pending
ON subscriptions (student_id, trainer_id)
WHERE status = 'active' OR status = 'pending';
