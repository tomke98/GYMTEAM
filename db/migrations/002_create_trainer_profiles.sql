CREATE TYPE certification_type AS ENUM ('NASM', 'ACE', 'ISSA', 'NSCA', 'NESTA', 'ACSM', 'Other');

CREATE TABLE IF NOT EXISTS trainer_profiles (
  id                   BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  bio                  TEXT,
  certification        certification_type,
  cpr_certified        BOOLEAN NOT NULL DEFAULT FALSE,
  liability_insurance  BOOLEAN NOT NULL DEFAULT FALSE,
  per_session_rate     DECIMAL(10,2),
  monthly_rate         DECIMAL(10,2),
  photo_url            TEXT,
  whatsapp             VARCHAR(50),
  email_contact        VARCHAR(255),
  instagram_url        TEXT,
  website_url          TEXT,
  wearable_compatible  BOOLEAN,
  active_student_count INT NOT NULL DEFAULT 0,
  average_rating       DECIMAL(3,2),
  review_count         INT NOT NULL DEFAULT 0,
  is_profile_complete  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at           TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMP NOT NULL DEFAULT NOW()
);
