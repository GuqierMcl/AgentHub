-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "orchestrator_agent_id" TEXT,
    "last_message_id" TEXT,
    "last_message_at" TEXT,
    "pinned_at" TEXT,
    "archived_at" TEXT,
    "metadata_json" TEXT NOT NULL DEFAULT '{}',
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "conversation_agents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversation_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "joined_at" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "conversation_agents_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversation_id" TEXT NOT NULL,
    "run_id" TEXT,
    "role" TEXT NOT NULL,
    "sender_type" TEXT NOT NULL,
    "sender_id" TEXT,
    "agent_id" TEXT,
    "parent_message_id" TEXT,
    "regenerated_from_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'created',
    "finish_reason" TEXT,
    "metadata_json" TEXT NOT NULL DEFAULT '{}',
    "ui_message_json" TEXT,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,
    "completed_at" TEXT,
    CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "messages_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "message_parts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "message_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "run_id" TEXT,
    "part_index" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'streaming',
    "text" TEXT,
    "payload_json" TEXT NOT NULL DEFAULT '{}',
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,
    CONSTRAINT "message_parts_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "message_pins" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversation_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "note" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TEXT NOT NULL,
    CONSTRAINT "message_pins_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "message_pins_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversation_id" TEXT NOT NULL,
    "trigger_message_id" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "runtime_id" TEXT,
    "orchestrator_agent_id" TEXT,
    "input_json" TEXT NOT NULL DEFAULT '{}',
    "plan_json" TEXT,
    "error_json" TEXT,
    "started_at" TEXT,
    "completed_at" TEXT,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,
    CONSTRAINT "runs_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "runs_trigger_message_id_fkey" FOREIGN KEY ("trigger_message_id") REFERENCES "messages" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "run_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "run_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "agent_id" TEXT,
    "message_id" TEXT,
    "type" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "payload_json" TEXT NOT NULL DEFAULT '{}',
    "created_at" TEXT NOT NULL,
    CONSTRAINT "run_events_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "artifacts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversation_id" TEXT NOT NULL,
    "run_id" TEXT,
    "message_id" TEXT,
    "created_by_agent_id" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "current_version_id" TEXT,
    "metadata_json" TEXT NOT NULL DEFAULT '{}',
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,
    CONSTRAINT "artifacts_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "artifacts_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "artifact_versions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "artifact_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "language" TEXT,
    "content" TEXT NOT NULL,
    "summary" TEXT,
    "diff_json" TEXT,
    "created_by_agent_id" TEXT,
    "created_at" TEXT NOT NULL,
    CONSTRAINT "artifact_versions_artifact_id_fkey" FOREIGN KEY ("artifact_id") REFERENCES "artifacts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "permission_requests" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversation_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "message_id" TEXT,
    "permission_type" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "resolved_at" TEXT,
    "expires_at" TEXT,
    "metadata_json" TEXT NOT NULL DEFAULT '{}',
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,
    CONSTRAINT "permission_requests_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "permission_requests_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "idx_conversations_status_last_message_at" ON "conversations"("status", "last_message_at");

-- CreateIndex
CREATE INDEX "idx_conversations_pinned_at" ON "conversations"("pinned_at");

-- CreateIndex
CREATE INDEX "idx_conversation_agents_conversation_id" ON "conversation_agents"("conversation_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_conversation_agents_conv_agent" ON "conversation_agents"("conversation_id", "agent_id");

-- CreateIndex
CREATE INDEX "idx_messages_conversation_id_created_at" ON "messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_messages_run_id" ON "messages"("run_id");

-- CreateIndex
CREATE INDEX "idx_messages_sender_id" ON "messages"("sender_id");

-- CreateIndex
CREATE INDEX "idx_messages_parent_message_id" ON "messages"("parent_message_id");

-- CreateIndex
CREATE INDEX "idx_message_parts_message_id_part_index" ON "message_parts"("message_id", "part_index");

-- CreateIndex
CREATE INDEX "idx_message_parts_conversation_id" ON "message_parts"("conversation_id");

-- CreateIndex
CREATE INDEX "idx_message_parts_run_id" ON "message_parts"("run_id");

-- CreateIndex
CREATE INDEX "idx_message_parts_type" ON "message_parts"("type");

-- CreateIndex
CREATE UNIQUE INDEX "uq_message_parts_message_part_index" ON "message_parts"("message_id", "part_index");

-- CreateIndex
CREATE INDEX "idx_message_pins_conversation_id" ON "message_pins"("conversation_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_message_pins_conv_message" ON "message_pins"("conversation_id", "message_id");

-- CreateIndex
CREATE INDEX "idx_runs_conversation_id_created_at" ON "runs"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_runs_trigger_message_id" ON "runs"("trigger_message_id");

-- CreateIndex
CREATE INDEX "idx_runs_status" ON "runs"("status");

-- CreateIndex
CREATE INDEX "idx_run_events_run_id_sequence" ON "run_events"("run_id", "sequence");

-- CreateIndex
CREATE INDEX "idx_run_events_conversation_id" ON "run_events"("conversation_id");

-- CreateIndex
CREATE INDEX "idx_run_events_agent_id" ON "run_events"("agent_id");

-- CreateIndex
CREATE INDEX "idx_run_events_type" ON "run_events"("type");

-- CreateIndex
CREATE UNIQUE INDEX "uq_run_events_run_sequence" ON "run_events"("run_id", "sequence");

-- CreateIndex
CREATE INDEX "idx_artifacts_conversation_id" ON "artifacts"("conversation_id");

-- CreateIndex
CREATE INDEX "idx_artifacts_run_id" ON "artifacts"("run_id");

-- CreateIndex
CREATE INDEX "idx_artifacts_created_by_agent_id" ON "artifacts"("created_by_agent_id");

-- CreateIndex
CREATE INDEX "idx_artifacts_type_status" ON "artifacts"("type", "status");

-- CreateIndex
CREATE INDEX "idx_artifact_versions_artifact_id_version" ON "artifact_versions"("artifact_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "uq_artifact_versions_artifact_version" ON "artifact_versions"("artifact_id", "version");

-- CreateIndex
CREATE INDEX "idx_permission_requests_conversation_id" ON "permission_requests"("conversation_id");

-- CreateIndex
CREATE INDEX "idx_permission_requests_run_id" ON "permission_requests"("run_id");

-- CreateIndex
CREATE INDEX "idx_permission_requests_status" ON "permission_requests"("status");

-- CreateIndex
CREATE INDEX "idx_permission_requests_agent_id" ON "permission_requests"("agent_id");
