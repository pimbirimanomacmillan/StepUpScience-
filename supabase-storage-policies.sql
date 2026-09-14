-- StepUp Science storage policies for Supabase Storage
-- Run this AFTER supabase-schema.sql
-- Assumes bucket: protected-content (private)

alter table storage.objects enable row level security;

-- Clean up old policies if you rerun the script
DROP POLICY IF EXISTS "admin manage protected content objects" ON storage.objects;
DROP POLICY IF EXISTS "students read entitled protected content objects" ON storage.objects;

-- Admins can upload, update, delete and read anything in the protected-content bucket
CREATE POLICY "admin manage protected content objects"
ON storage.objects
FOR ALL
TO authenticated
USING (
  bucket_id = 'protected-content'
  AND EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'admin'
  )
)
WITH CHECK (
  bucket_id = 'protected-content'
  AND EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'admin'
  )
);

-- Signed-in students can read only files that are tied to a published module
-- AND only if their tier is high enough for that module.
CREATE POLICY "students read entitled protected content objects"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'protected-content'
  AND EXISTS (
    SELECT 1
    FROM public.modules m
    WHERE m.file_path = storage.objects.name
      AND m.is_published = true
      AND (
        m.required_tier = 'Free'
        OR public.current_user_has_tier(m.required_tier)
      )
  )
);

-- IMPORTANT LAUNCH NOTE:
-- In the current packaged version, admin uploads go into the private bucket above.
-- That means the simplest safe launch path is: require students to sign in,
-- even for Free-tier resources.
-- If you want truly anonymous free resources, use a SECOND public bucket
-- (for example: public-content) and store those file URLs in modules.public_url.
