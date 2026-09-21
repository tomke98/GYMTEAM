CREATE TYPE booking_status AS ENUM ('pending', 'confirmed', 'cancelled_by_student', 'cancelled_by_trainer', 'completed');

CREATE TABLE IF NOT EXISTS bookings (
  id                   BIGSERIAL PRIMARY KEY,
  schedule_id          BIGINT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  student_id           BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trainer_id           BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gym_id               BIGINT REFERENCES gyms(id) ON DELETE SET NULL,
  session_date         DATE NOT NULL,
  start_time           TIME NOT NULL,
  end_time             TIME NOT NULL,
  status               booking_status NOT NULL DEFAULT 'pending',
  virtual_session_link TEXT,
  created_at           TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at         TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_unique_slot ON bookings(schedule_id, student_id, session_date) WHERE status NOT IN ('cancelled_by_student', 'cancelled_by_trainer');
CREATE INDEX IF NOT EXISTS idx_bookings_student_id ON bookings(student_id);
CREATE INDEX IF NOT EXISTS idx_bookings_trainer_id ON bookings(trainer_id);
CREATE INDEX IF NOT EXISTS idx_bookings_schedule_id ON bookings(schedule_id);
CREATE INDEX IF NOT EXISTS idx_bookings_session_date ON bookings(session_date);
