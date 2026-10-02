-- MCP server: OAuth clients, bearer tokens and authorization codes. Additive only.
CREATE TYPE "McpTokenKind" AS ENUM ('personal', 'access', 'refresh');

CREATE TABLE "mcp_clients" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "redirect_uris" TEXT[],
    "secret_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mcp_clients_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mcp_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "client_id" UUID,
    "kind" "McpTokenKind" NOT NULL,
    "name" TEXT,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mcp_tokens_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "mcp_tokens_token_hash_key" ON "mcp_tokens"("token_hash");
CREATE INDEX "mcp_tokens_user_id_kind_idx" ON "mcp_tokens"("user_id", "kind");
ALTER TABLE "mcp_tokens" ADD CONSTRAINT "mcp_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mcp_tokens" ADD CONSTRAINT "mcp_tokens_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "mcp_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "mcp_auth_codes" (
    "id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "client_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "redirect_uri" TEXT NOT NULL,
    "code_challenge" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mcp_auth_codes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "mcp_auth_codes_code_hash_key" ON "mcp_auth_codes"("code_hash");
ALTER TABLE "mcp_auth_codes" ADD CONSTRAINT "mcp_auth_codes_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "mcp_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mcp_auth_codes" ADD CONSTRAINT "mcp_auth_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
