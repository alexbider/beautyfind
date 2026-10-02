-- Staff can keep a single listing out of search engines and the sitemap. Additive only.
ALTER TABLE "branches" ADD COLUMN "noindex" BOOLEAN NOT NULL DEFAULT false;
