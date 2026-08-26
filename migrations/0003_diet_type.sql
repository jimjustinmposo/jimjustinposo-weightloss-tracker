-- Add a diet-style preference used to shape daily macro targets
-- (calorie target stays derived from TDEE ± deficit; only the P/C/F split changes).
ALTER TABLE profiles ADD COLUMN diet_type TEXT NOT NULL DEFAULT 'normal'
  CHECK (diet_type IN ('normal','lowcarb','keto','carnivore','omad_carnivore'));