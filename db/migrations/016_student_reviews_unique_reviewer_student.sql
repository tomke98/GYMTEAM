-- One student review per reviewer per student.
-- Partial index (WHERE is_deleted = FALSE) so a soft-deleted review does not
-- permanently block re-review after a moderator removes it.
CREATE UNIQUE INDEX student_reviews_reviewer_student_unique
  ON student_reviews (reviewer_id, student_id)
  WHERE is_deleted = FALSE;
