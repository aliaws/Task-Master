-- Fix RLS policies on task_comments: allow anon key for all operations.
-- The old edge function trusted user_id from the request body (no JWT verification).
-- These policies preserve the same trust model.

DROP POLICY IF EXISTS "authenticated users can insert comments" ON public.task_comments;
DROP POLICY IF EXISTS "authenticated users can view comments" ON public.task_comments;
DROP POLICY IF EXISTS "comment author can update their own comment" ON public.task_comments;
DROP POLICY IF EXISTS "comment author can delete their own comment" ON public.task_comments;
DROP POLICY IF EXISTS "anyone can insert comments" ON public.task_comments;
DROP POLICY IF EXISTS "anyone can view comments" ON public.task_comments;
DROP POLICY IF EXISTS "anyone can update comments" ON public.task_comments;
DROP POLICY IF EXISTS "anyone can delete comments" ON public.task_comments;

ALTER TABLE public.task_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone can insert comments"
  ON public.task_comments
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "anyone can view comments"
  ON public.task_comments
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "anyone can update comments"
  ON public.task_comments
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "anyone can delete comments"
  ON public.task_comments
  FOR DELETE
  TO anon, authenticated
  USING (true);
