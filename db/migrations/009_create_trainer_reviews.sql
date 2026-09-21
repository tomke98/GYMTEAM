CREATE TABLE IF NOT EXISTS trainer_reviews (
  id              BIGSERIAL PRIMARY KEY,
  subscription_id BIGINT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  reviewer_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trainer_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating          SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment         TEXT NOT NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  edited_at       TIMESTAMP,
  locked_at       TIMESTAMP,
  is_deleted      BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_by      BIGINT REFERENCES users(id) ON DELETE SET NULL,
  deleted_at      TIMESTAMP,
  UNIQUE (subscription_id)
);

CREATE INDEX IF NOT EXISTS idx_trainer_reviews_trainer_id ON trainer_reviews(trainer_id);
CREATE INDEX IF NOT EXISTS idx_trainer_reviews_reviewer_id ON trainer_reviews(reviewer_id);
