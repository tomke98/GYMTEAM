-- Replace the unconditional UNIQUE(subscription_id) constraint with a partial
-- unique index so a soft-deleted review does not block re-review on the same
-- subscription (consistent with the pattern used for trainer_reviews and gym_reviews).
ALTER TABLE student_reviews DROP CONSTRAINT IF EXISTS student_reviews_subscription_id_key;

CREATE UNIQUE INDEX student_reviews_subscription_unique
  ON student_reviews (subscription_id)
  WHERE is_deleted = FALSE;
