CREATE TYPE day_of_week AS ENUM ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun');
CREATE TYPE session_type AS ENUM ('individual', 'group', 'semi_private');

CREATE TABLE IF NOT EXISTS schedules (
  id               BIGSERIAL PRIMARY KEY,
  trainer_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gym_id           BIGINT REFERENCES gyms(id) ON DELETE SET NULL,
  day_of_week      day_of_week NOT NULL,
  start_time       TIME NOT NULL,
  end_time         TIME NOT NULL,
  session_type     session_type NOT NULL DEFAULT 'individual',
  capacity         INT NOT NULL DEFAULT 1,
  per_session_rate DECIMAL(10,2),
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_schedules_trainer_id ON schedules(trainer_id);
CREATE INDEX IF NOT EXISTS idx_schedules_gym_id ON schedules(gym_id);
