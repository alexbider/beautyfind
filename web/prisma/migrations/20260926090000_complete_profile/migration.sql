-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PriceType" ADD VALUE 'range';
ALTER TYPE "PriceType" ADD VALUE 'package';
ALTER TYPE "PriceType" ADD VALUE 'free';
ALTER TYPE "PriceType" ADD VALUE 'on_request';

-- AlterTable
ALTER TABLE "branches" ADD COLUMN     "attributes" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "editorial" JSONB,
ADD COLUMN     "established_year" INTEGER,
ADD COLUMN     "facebook" TEXT,
ADD COLUMN     "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "media_provenance" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "meta_description" TEXT,
ADD COLUMN     "meta_title" TEXT,
ADD COLUMN     "profile_checklist" JSONB,
ADD COLUMN     "profile_status" TEXT,
ADD COLUMN     "team" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "team_size" INTEGER,
ADD COLUMN     "tiktok" TEXT,
ADD COLUMN     "videos" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "youtube" TEXT;

-- AlterTable
ALTER TABLE "import_places" ADD COLUMN     "costs" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "coverage" JSONB,
ADD COLUMN     "editorial" JSONB,
ADD COLUMN     "established_year" INTEGER,
ADD COLUMN     "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "media_provenance" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "profile_status" TEXT,
ADD COLUMN     "socials" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "team" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "team_size" INTEGER,
ADD COLUMN     "tiktok" TEXT,
ADD COLUMN     "videos" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "youtube" TEXT;

-- AlterTable
ALTER TABLE "treatments" ADD COLUMN     "price_max_agorot" INTEGER,
ADD COLUMN     "price_note" TEXT,
ADD COLUMN     "source" TEXT,
ADD COLUMN     "source_at" TIMESTAMP(3),
ADD COLUMN     "source_url" TEXT,
ADD COLUMN     "tax_included" BOOLEAN,
ALTER COLUMN "price_agorot" DROP NOT NULL;


