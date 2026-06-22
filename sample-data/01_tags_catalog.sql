-- Realistic tag catalog for CRM / service workflows (idempotent).
INSERT INTO public.tags (name) VALUES
  ('follow-up'),
  ('callback-requested'),
  ('voice-ai'),
  ('warranty'),
  ('scheduling'),
  ('hot-lead'),
  ('payment-plan'),
  ('no-show'),
  ('referral'),
  ('spanish-speaking'),
  ('insurance-verification'),
  ('estimate-sent'),
  ('contract-signed'),
  ('urgent'),
  ('nurture')
ON CONFLICT (name) DO NOTHING;
