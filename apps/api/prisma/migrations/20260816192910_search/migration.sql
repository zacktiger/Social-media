-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- AlterTable
-- Hand-edited: Prisma generated a plain tsvector column. Making it GENERATED
-- ALWAYS means Postgres maintains it on every insert and update, so it cannot
-- drift out of sync with the content the way a trigger or an application-side
-- write eventually would.
ALTER TABLE "Post" ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', "content")) STORED;

-- CreateIndex
CREATE INDEX "Post_searchVector_idx" ON "Post" USING GIN ("searchVector");

-- CreateIndex
CREATE INDEX "User_username_idx" ON "User" USING GIN ("username" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "User_displayName_idx" ON "User" USING GIN ("displayName" gin_trgm_ops);
