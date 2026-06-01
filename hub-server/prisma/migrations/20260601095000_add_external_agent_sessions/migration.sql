-- CreateTable
CREATE TABLE "external_agent_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "workspace_identity" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "provider_session_id" TEXT NOT NULL,
    "parent_provider_session_id" TEXT,
    "run_id" TEXT,
    "task_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "handoff_summary" TEXT,
    "last_synced_run_event_id" TEXT,
    "metadata_json" TEXT NOT NULL DEFAULT '{}',
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,
    CONSTRAINT "external_agent_sessions_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_external_agent_sessions_provider_session" ON "external_agent_sessions"("provider", "provider_session_id");

-- CreateIndex
CREATE INDEX "idx_external_agent_sessions_conversation_id" ON "external_agent_sessions"("conversation_id");

-- CreateIndex
CREATE INDEX "idx_external_agent_sessions_lookup" ON "external_agent_sessions"("provider", "agent_id", "conversation_id", "workspace_identity", "scope");

-- CreateIndex
CREATE INDEX "idx_external_agent_sessions_run_id" ON "external_agent_sessions"("run_id");

-- CreateIndex
CREATE INDEX "idx_external_agent_sessions_task_id" ON "external_agent_sessions"("task_id");
