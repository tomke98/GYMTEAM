-- Add 6-month rolling average column to both profile tables.
-- NULL means no reviews within the window (correct null state for display).
ALTER TABLE trainer_profiles ADD COLUMN recent_average_rating DECIMAL(3,2);
ALTER TABLE gyms              ADD COLUMN recent_average_rating DECIMAL(3,2);

-- Backfill trainer profiles with 6-month rolling average.
UPDATE trainer_profiles tp
SET recent_average_rating = (
  SELECT AVG(rating)::numeric(3,2)
  FROM trainer_reviews tr
  WHERE tr.trainer_id = tp.id
    AND tr.is_deleted = FALSE
    AND tr.created_at >= NOW() - INTERVAL '6 months'
);

-- Backfill gyms with 6-month rolling average.
UPDATE gyms g
SET recent_average_rating = (
  SELECT AVG(rating)::numeric(3,2)
  FROM gym_reviews gr
  WHERE gr.gym_id = g.id
    AND gr.is_deleted = FALSE
    AND gr.created_at >= NOW() - INTERVAL '6 months'
);
