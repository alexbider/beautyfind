-- Magazine: authors, categories, tags and articles behind /magazine/<slug>; image metadata on media
-- files; an optional scope on MCP tokens and authorization codes. Additive only.

ALTER TABLE "media_files" ADD COLUMN "width" INTEGER;
ALTER TABLE "media_files" ADD COLUMN "height" INTEGER;
ALTER TABLE "media_files" ADD COLUMN "title" TEXT;
ALTER TABLE "media_files" ADD COLUMN "caption" TEXT;
ALTER TABLE "media_files" ADD COLUMN "filename" TEXT;
ALTER TABLE "media_files" ADD COLUMN "kind" TEXT;
CREATE UNIQUE INDEX "media_files_filename_key" ON "media_files"("filename");

ALTER TABLE "mcp_tokens" ADD COLUMN "scope" TEXT;
ALTER TABLE "mcp_auth_codes" ADD COLUMN "scope" TEXT;

CREATE TYPE "ArticleStatus" AS ENUM ('draft', 'scheduled', 'published', 'unpublished');

CREATE TABLE "authors" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT,
    "bio" TEXT,
    "avatar_id" UUID,
    "is_medical_reviewer" BOOLEAN NOT NULL DEFAULT false,
    "license_kind" TEXT,
    "license_number" TEXT,
    "same_as" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "user_id" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "authors_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "authors_slug_key" ON "authors"("slug");
ALTER TABLE "authors" ADD CONSTRAINT "authors_avatar_id_fkey" FOREIGN KEY ("avatar_id") REFERENCES "media_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "article_categories" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "article_categories_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "article_categories_slug_key" ON "article_categories"("slug");

CREATE TABLE "article_tags" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "article_tags_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "article_tags_slug_key" ON "article_tags"("slug");

CREATE TABLE "articles" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "ArticleStatus" NOT NULL DEFAULT 'draft',
    "published_at" TIMESTAMP(3),
    "scheduled_for" TIMESTAMP(3),
    "body_html" TEXT NOT NULL DEFAULT '',
    "excerpt" TEXT,
    "summary" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "faq" JSONB NOT NULL DEFAULT '[]',
    "author_id" UUID,
    "review_required" BOOLEAN NOT NULL DEFAULT false,
    "reviewer_id" UUID,
    "reviewed_at" TIMESTAMP(3),
    "review_status" TEXT,
    "category_id" UUID,
    "featured_image_id" UUID,
    "parent_page_path" TEXT,
    "related_article_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "reading_time_minutes" INTEGER NOT NULL DEFAULT 0,
    "word_count" INTEGER NOT NULL DEFAULT 0,
    "internal_notes" TEXT,
    "seo_title" TEXT,
    "meta_description" TEXT,
    "focus_keyword" TEXT,
    "canonical_url" TEXT,
    "robots" TEXT NOT NULL DEFAULT 'index,follow',
    "og_title" TEXT,
    "og_description" TEXT,
    "og_image_id" UUID,
    "twitter_title" TEXT,
    "twitter_description" TEXT,
    "json_ld_extra" JSONB NOT NULL DEFAULT '[]',
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "articles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "articles_slug_key" ON "articles"("slug");
CREATE INDEX "articles_status_published_at_idx" ON "articles"("status", "published_at");
ALTER TABLE "articles" ADD CONSTRAINT "articles_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "authors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "articles" ADD CONSTRAINT "articles_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "authors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "articles" ADD CONSTRAINT "articles_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "article_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "articles" ADD CONSTRAINT "articles_featured_image_id_fkey" FOREIGN KEY ("featured_image_id") REFERENCES "media_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Implicit many-to-many between articles and tags (Prisma naming).
CREATE TABLE "_ArticleToArticleTag" (
    "A" UUID NOT NULL,
    "B" UUID NOT NULL,
    CONSTRAINT "_ArticleToArticleTag_AB_pkey" PRIMARY KEY ("A","B")
);
CREATE INDEX "_ArticleToArticleTag_B_index" ON "_ArticleToArticleTag"("B");
ALTER TABLE "_ArticleToArticleTag" ADD CONSTRAINT "_ArticleToArticleTag_A_fkey" FOREIGN KEY ("A") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_ArticleToArticleTag" ADD CONSTRAINT "_ArticleToArticleTag_B_fkey" FOREIGN KEY ("B") REFERENCES "article_tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;
