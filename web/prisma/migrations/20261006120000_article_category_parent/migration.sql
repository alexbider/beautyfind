-- Magazine categories map to a parent treatment page; articles default their parent page from it. Additive.
-- The medical review columns on articles and authors stay in place but are no longer used by the code.
ALTER TABLE "article_categories" ADD COLUMN "parent_page_path" TEXT;
