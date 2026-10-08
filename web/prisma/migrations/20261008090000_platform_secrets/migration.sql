-- Platform secrets entered in the admin, encrypted with DATA_KEY (the Google indexing service account key). Additive.
CREATE TABLE "platform_secrets" (
    "key" TEXT NOT NULL,
    "value_enc" TEXT NOT NULL,
    "label" TEXT,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "platform_secrets_pkey" PRIMARY KEY ("key")
);
