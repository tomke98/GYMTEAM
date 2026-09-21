CREATE TABLE IF NOT EXISTS gym_reviews (
  id                  BIGSERIAL PRIMARY KEY,
  gym_subscription_id BIGINT NOT NULL REFERENCES gym_subscriptions(id) ON DELETE CASCADE,
  reviewer_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gym_id              BIGINT NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  rating              SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment             TEXT NOT NULL,
  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  edited_at           TIMESTAMP,
  locked_at           TIMESTAMP,
  is_deleted          BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_by          BIGINT REFERENCES users(id) ON DELETE SET NULL,
  deleted_at          TIMESTAMP,
  UNIQUE (gym_subscription_id)
);

CREATE INDEX IF NOT EXISTS idx_gym_reviews_gym_id ON gym_reviews(gym_id);
CREATE INDEX IF NOT EXISTS idx_gym_reviews_reviewer_id ON gym_reviews(reviewer_id);
