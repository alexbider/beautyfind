-- AlterTable
ALTER TABLE "import_places" ADD COLUMN     "logo_url" TEXT,
ADD COLUMN     "photo_urls" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "website_kind" TEXT;

