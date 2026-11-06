-- Soft delete for businesses (master admin only). Additive: four nullable columns and an index.
-- Nothing is removed; to undo, drop the columns and the index.
ALTER TABLE "businesses" ADD COLUMN "deleted_at" TIMESTAMP(3);
ALTER TABLE "businesses" ADD COLUMN "deleted_by_id" UUID;
ALTER TABLE "businesses" ADD COLUMN "deleted_from_status" "BusinessStatus";
ALTER TABLE "businesses" ADD COLUMN "deleted_reason" TEXT;
CREATE INDEX "businesses_deleted_at_idx" ON "businesses"("deleted_at");
