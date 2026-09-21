-- One review per student per trainer.
-- Partial index (WHERE is_deleted = FALSE) so a soft-deleted review does not
-- permanently block re-review after a moderator removes it.
CREATE UNIQUE INDEX trainer_reviews_reviewer_trainer_unique
  ON trainer_reviews (reviewer_id, trainer_id)
  WHERE is_deleted = FALSE;
