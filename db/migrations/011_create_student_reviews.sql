CREATE TABLE IF NOT EXISTS student_reviews (
  id                  BIGSERIAL PRIMARY KEY,
  subscription_id     BIGINT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  reviewer_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  student_id          BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating_coachability SMALLINT NOT NULL CHECK (rating_coachability BETWEEN 1 AND 5),
  rating_consistency  SMALLINT NOT NULL CHECK (rating_consistency BETWEEN 1 AND 5),
  comment             TEXT,
  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  is_deleted          BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (subscription_id)
);

CREATE INDEX IF NOT EXISTS idx_student_reviews_student_id ON student_reviews(student_id);
CREATE INDEX IF NOT EXISTS idx_student_reviews_reviewer_id ON student_reviews(reviewer_id);
