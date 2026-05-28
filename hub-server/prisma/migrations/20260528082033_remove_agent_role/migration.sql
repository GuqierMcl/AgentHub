/*
  Warnings:

  - You are about to drop the column `role` on the `conversation_agents` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_conversation_agents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversation_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "joined_at" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "conversation_agents_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_conversation_agents" ("agent_id", "conversation_id", "id", "joined_at", "sort_order") SELECT "agent_id", "conversation_id", "id", "joined_at", "sort_order" FROM "conversation_agents";
DROP TABLE "conversation_agents";
ALTER TABLE "new_conversation_agents" RENAME TO "conversation_agents";
CREATE INDEX "idx_conversation_agents_conversation_id" ON "conversation_agents"("conversation_id");
CREATE UNIQUE INDEX "uq_conversation_agents_conv_agent" ON "conversation_agents"("conversation_id", "agent_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
