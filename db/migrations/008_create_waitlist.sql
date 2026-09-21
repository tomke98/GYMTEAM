CREATE TYPE waitlist_status AS ENUM ('waiting', 'offered', 'claimed', 'expired', 'removed');

CREATE TABLE IF NOT EXISTS waitlist (
  id               BIGSERIAL PRIMARY KEY,
  schedule_id      BIGINT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  session_date     DATE NOT NULL,
  student_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  position         INT NOT NULL,
  status           waitlist_status NOT NULL DEFAULT 'waiting',
  claim_offered_at TIMESTAMP,
  claim_expires_at TIMESTAMP,
  created_at       TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_waitlist_unique_slot ON waitlist(schedule_id, session_date, student_id) WHERE status IN ('waiting', 'offered');
CREATE INDEX IF NOT EXISTS idx_waitlist_schedule_id ON waitlist(schedule_id);
CREATE INDEX IF NOT EXISTS idx_waitlist_student_id ON waitlist(student_id);
