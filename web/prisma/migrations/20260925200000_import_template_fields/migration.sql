-- AlterTable
ALTER TABLE "import_places" ADD COLUMN     "accessible" BOOLEAN,
ADD COLUMN     "faqs" JSONB,
ADD COLUMN     "free_parking" BOOLEAN,
ADD COLUMN     "price_level" TEXT;

