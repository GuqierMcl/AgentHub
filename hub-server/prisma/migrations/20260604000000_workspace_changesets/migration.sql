-- CreateTable
CREATE TABLE "workspace_change_sets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversation_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "artifact_id" TEXT NOT NULL,
    "source_event_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "baseline_dirty" BOOLEAN NOT NULL DEFAULT false,
    "run_only_reliable" BOOLEAN NOT NULL DEFAULT true,
    "summary" TEXT,
    "stats_json" TEXT NOT NULL DEFAULT '{}',
    "limitations_json" TEXT NOT NULL DEFAULT '[]',
    "attribution_kind" TEXT NOT NULL,
    "attribution_confidence" TEXT NOT NULL,
    "agent_id" TEXT,
    "task_id" TEXT,
    "tool_call_id" TEXT,
    "tool_name" TEXT,
    "message_id" TEXT,
    "metadata_json" TEXT NOT NULL DEFAULT '{}',
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,
    CONSTRAINT "workspace_change_sets_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "workspace_change_sets_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "workspace_change_sets_artifact_id_fkey" FOREIGN KEY ("artifact_id") REFERENCES "artifacts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "workspace_change_set_files" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "change_set_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "artifact_id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "old_path" TEXT,
    "status_before" TEXT,
    "status_after" TEXT,
    "origin" TEXT,
    "additions" INTEGER,
    "deletions" INTEGER,
    "binary" BOOLEAN NOT NULL DEFAULT false,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "attribution_kind" TEXT NOT NULL,
    "attribution_confidence" TEXT NOT NULL,
    "agent_id" TEXT,
    "task_id" TEXT,
    "tool_call_id" TEXT,
    "tool_name" TEXT,
    "message_id" TEXT,
    "metadata_json" TEXT NOT NULL DEFAULT '{}',
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,
    CONSTRAINT "workspace_change_set_files_change_set_id_fkey" FOREIGN KEY ("change_set_id") REFERENCES "workspace_change_sets" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_workspace_change_sets_artifact_id" ON "workspace_change_sets"("artifact_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_workspace_change_sets_source_event_id" ON "workspace_change_sets"("source_event_id");

-- CreateIndex
CREATE INDEX "idx_workspace_change_sets_conversation_id" ON "workspace_change_sets"("conversation_id");

-- CreateIndex
CREATE INDEX "idx_workspace_change_sets_run_id" ON "workspace_change_sets"("run_id");

-- CreateIndex
CREATE INDEX "idx_workspace_change_sets_attribution" ON "workspace_change_sets"("attribution_kind", "attribution_confidence");

-- CreateIndex
CREATE UNIQUE INDEX "uq_workspace_change_set_files_change_set_path" ON "workspace_change_set_files"("change_set_id", "path");

-- CreateIndex
CREATE INDEX "idx_workspace_change_set_files_conversation_id" ON "workspace_change_set_files"("conversation_id");

-- CreateIndex
CREATE INDEX "idx_workspace_change_set_files_run_id" ON "workspace_change_set_files"("run_id");

-- CreateIndex
CREATE INDEX "idx_workspace_change_set_files_artifact_id" ON "workspace_change_set_files"("artifact_id");

-- CreateIndex
CREATE INDEX "idx_workspace_change_set_files_path" ON "workspace_change_set_files"("path");

-- CreateIndex
CREATE INDEX "idx_workspace_change_set_files_attribution" ON "workspace_change_set_files"("attribution_kind", "attribution_confidence");
