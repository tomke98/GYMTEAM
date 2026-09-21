CREATE TYPE gym_status AS ENUM ('active', 'inactive', 'incomplete');

CREATE TABLE IF NOT EXISTS gyms (
  id             BIGSERIAL PRIMARY KEY,
  trainer_id     BIGINT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name           VARCHAR(255) NOT NULL,
  address        TEXT NOT NULL,
  lat            DECIMAL(10,7),
  lng            DECIMAL(10,7),
  opening_time   TIME,
  closing_time   TIME,
  working_days   JSONB,
  monthly_price  DECIMAL(10,2),
  yearly_price   DECIMAL(10,2),
  description    TEXT,
  photo_urls     JSONB,
  status         gym_status NOT NULL DEFAULT 'incomplete',
  average_rating DECIMAL(3,2),
  review_count   INT NOT NULL DEFAULT 0,
  created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gyms_trainer_id ON gyms(trainer_id);
CREATE INDEX IF NOT EXISTS idx_gyms_status ON gyms(status);
