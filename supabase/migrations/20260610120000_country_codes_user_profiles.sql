-- Country dial codes (dynamic list for phone UI) + user phone profiles linked to auth.users.

CREATE TABLE IF NOT EXISTS public.country_codes (
  id smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  iso2 char(2) NOT NULL,
  dial_code text NOT NULL,
  name text NOT NULL,
  flag_emoji text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order smallint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT country_codes_iso2_unique UNIQUE (iso2),
  CONSTRAINT country_codes_dial_code_unique UNIQUE (dial_code)
);

CREATE INDEX IF NOT EXISTS country_codes_active_sort_idx
  ON public.country_codes (is_active, sort_order, name);

INSERT INTO public.country_codes (iso2, dial_code, name, flag_emoji, sort_order)
VALUES
  ('US', '+1',  'United States', E'🇺🇸', 1),
  ('PK', '+92', 'Pakistan',      E'🇵🇰', 2)
ON CONFLICT (iso2) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.user_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  country_code_id smallint REFERENCES public.country_codes (id) ON DELETE SET NULL,
  phone_local text,
  phone text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_profiles_country_code_id_idx
  ON public.user_profiles (country_code_id);

CREATE INDEX IF NOT EXISTS user_profiles_phone_idx
  ON public.user_profiles (phone);

COMMENT ON TABLE public.country_codes IS
  'Dial codes for phone input UI; seed rows and add more via SQL.';
COMMENT ON TABLE public.user_profiles IS
  'Phone fields for auth users; phone is E.164 for GHL sync.';
COMMENT ON COLUMN public.user_profiles.phone IS
  'Full E.164 number e.g. +923034683389; synced to GHL.';
