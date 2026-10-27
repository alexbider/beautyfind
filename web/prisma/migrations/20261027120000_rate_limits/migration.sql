-- Shared rate limits: one fixed-window counter per key (login, codes, forms, lookups). Additive.
CREATE TABLE "rate_limits" (
    "key" TEXT NOT NULL,
    "window_start" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("key")
);
CREATE INDEX "rate_limits_window_start_idx" ON "rate_limits"("window_start");
