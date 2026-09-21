CREATE TABLE IF NOT EXISTS cancellation_log (
  id           BIGSERIAL PRIMARY KEY,
  trainer_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  booking_id   BIGINT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  cancelled_at TIMESTAMP NOT NULL DEFAULT NOW(),
  reason       TEXT
);

CREATE INDEX IF NOT EXISTS idx_cancellation_log_trainer_id ON cancellation_log(trainer_id);
CREATE INDEX IF NOT EXISTS idx_cancellation_log_cancelled_at ON cancellation_log(cancelled_at);
