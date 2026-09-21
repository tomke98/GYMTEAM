-- One review per student per gym.
-- Partial index (WHERE is_deleted = FALSE) so a soft-deleted review does not
-- permanently block re-review after a moderator removes it.
CREATE UNIQUE INDEX gym_reviews_reviewer_gym_unique
  ON gym_reviews (reviewer_id, gym_id)
  WHERE is_deleted = FALSE;
