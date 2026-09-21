CREATE TYPE subscription_status AS ENUM ('pending', 'active', 'declined', 'cancelled', 'expired');

CREATE TABLE IF NOT EXISTS subscriptions (
  id           BIGSERIAL PRIMARY KEY,
  student_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trainer_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       subscription_status NOT NULL DEFAULT 'pending',
  requested_at TIMESTAMP NOT NULL DEFAULT NOW(),
  responded_at TIMESTAMP,
  cancelled_at TIMESTAMP,
  expires_at   TIMESTAMP NOT NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_student_id ON subscriptions(student_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_trainer_id ON subscriptions(trainer_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
