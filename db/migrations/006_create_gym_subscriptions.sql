CREATE TYPE gym_subscription_status AS ENUM ('active', 'cancelled');

CREATE TABLE IF NOT EXISTS gym_subscriptions (
  id            BIGSERIAL PRIMARY KEY,
  student_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gym_id        BIGINT NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  status        gym_subscription_status NOT NULL DEFAULT 'active',
  subscribed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  cancelled_at  TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_gym_subscriptions_unique_active ON gym_subscriptions(student_id, gym_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_gym_subscriptions_student_id ON gym_subscriptions(student_id);
CREATE INDEX IF NOT EXISTS idx_gym_subscriptions_gym_id ON gym_subscriptions(gym_id);
