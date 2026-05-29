/*
  Warnings:

  - Added the required column `part_key` to the `message_parts` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "run_events" ADD COLUMN "group_id" TEXT;
ALTER TABLE "run_events" ADD COLUMN "message_index" INTEGER;
ALTER TABLE "run_events" ADD COLUMN "occurred_at" TEXT;
ALTER TABLE "run_events" ADD COLUMN "parent_agent_id" TEXT;
ALTER TABLE "run_events" ADD COLUMN "parent_task_id" TEXT;
ALTER TABLE "run_events" ADD COLUMN "runtime_run_id" TEXT;
ALTER TABLE "run_events" ADD COLUMN "task_id" TEXT;
ALTER TABLE "run_events" ADD COLUMN "tool_call_id" TEXT;
ALTER TABLE "run_events" ADD COLUMN "tool_name" TEXT;

-- CreateTable
CREATE TABLE "run_tool_calls" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "run_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "tool_call_id" TEXT NOT NULL,
    "agent_id" TEXT,
    "parent_agent_id" TEXT,
    "parent_task_id" TEXT,
    "task_id" TEXT,
    "group_id" TEXT,
    "message_id" TEXT,
    "message_index" INTEGER,
    "tool_name" TEXT NOT NULL,
    "display_policy" TEXT NOT NULL DEFAULT 'timeline',
    "state" TEXT NOT NULL DEFAULT 'input-available',
    "risk_level" TEXT,
    "summary" TEXT,
    "input_json" TEXT,
    "output_json" TEXT,
    "error_json" TEXT,
    "payload_json" TEXT NOT NULL DEFAULT '{}',
    "first_event_sequence" INTEGER,
    "last_event_sequence" INTEGER,
    "started_at" TEXT,
    "completed_at" TEXT,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,
    CONSTRAINT "run_tool_calls_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "run_reasoning_blocks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "run_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "reasoning_id" TEXT NOT NULL,
    "agent_id" TEXT,
    "parent_agent_id" TEXT,
    "parent_task_id" TEXT,
    "task_id" TEXT,
    "group_id" TEXT,
    "message_id" TEXT,
    "message_index" INTEGER,
    "content" TEXT NOT NULL DEFAULT '',
    "state" TEXT NOT NULL DEFAULT 'streaming',
    "payload_json" TEXT NOT NULL DEFAULT '{}',
    "first_event_sequence" INTEGER,
    "last_event_sequence" INTEGER,
    "started_at" TEXT,
    "completed_at" TEXT,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,
    CONSTRAINT "run_reasoning_blocks_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "run_task_groups" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "run_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "agent_id" TEXT,
    "parent_agent_id" TEXT,
    "parent_task_id" TEXT,
    "title" TEXT,
    "state" TEXT NOT NULL DEFAULT 'running',
    "summary" TEXT,
    "payload_json" TEXT NOT NULL DEFAULT '{}',
    "first_event_sequence" INTEGER,
    "last_event_sequence" INTEGER,
    "started_at" TEXT,
    "completed_at" TEXT,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,
    CONSTRAINT "run_task_groups_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "run_tasks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "run_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "group_id" TEXT,
    "agent_id" TEXT,
    "parent_agent_id" TEXT,
    "parent_task_id" TEXT,
    "target_agent_id" TEXT,
    "title" TEXT,
    "instruction" TEXT,
    "expected_output" TEXT,
    "summary" TEXT,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "depends_on_json" TEXT NOT NULL DEFAULT '[]',
    "payload_json" TEXT NOT NULL DEFAULT '{}',
    "first_event_sequence" INTEGER,
    "last_event_sequence" INTEGER,
    "started_at" TEXT,
    "completed_at" TEXT,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,
    CONSTRAINT "run_tasks_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "run_tasks_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "run_task_groups" ("group_id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "run_plans" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "run_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "source_event_id" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "entry_agent_id" TEXT,
    "intent" TEXT,
    "summary_instruction" TEXT,
    "state" TEXT NOT NULL DEFAULT 'completed',
    "payload_json" TEXT NOT NULL DEFAULT '{}',
    "first_event_sequence" INTEGER,
    "last_event_sequence" INTEGER,
    "completed_at" TEXT,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,
    CONSTRAINT "run_plans_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "run_plan_tasks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "plan_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "target_agent_id" TEXT,
    "title" TEXT,
    "instruction" TEXT,
    "expected_output" TEXT,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "risk_level" TEXT,
    "depends_on_json" TEXT NOT NULL DEFAULT '[]',
    "payload_json" TEXT NOT NULL DEFAULT '{}',
    "first_event_sequence" INTEGER,
    "last_event_sequence" INTEGER,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,
    CONSTRAINT "run_plan_tasks_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "run_plans" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_message_parts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "message_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "run_id" TEXT,
    "runtime_event_id" TEXT,
    "part_key" TEXT NOT NULL,
    "part_index" INTEGER NOT NULL,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "type" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'streaming',
    "text" TEXT,
    "payload_json" TEXT NOT NULL DEFAULT '{}',
    "first_event_sequence" INTEGER,
    "last_event_sequence" INTEGER,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,
    CONSTRAINT "message_parts_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_message_parts" ("conversation_id", "created_at", "id", "message_id", "part_index", "payload_json", "run_id", "state", "text", "type", "updated_at") SELECT "conversation_id", "created_at", "id", "message_id", "part_index", "payload_json", "run_id", "state", "text", "type", "updated_at" FROM "message_parts";
DROP TABLE "message_parts";
ALTER TABLE "new_message_parts" RENAME TO "message_parts";
CREATE INDEX "idx_message_parts_message_id_part_index" ON "message_parts"("message_id", "part_index");
CREATE INDEX "idx_message_parts_conversation_id" ON "message_parts"("conversation_id");
CREATE INDEX "idx_message_parts_run_id" ON "message_parts"("run_id");
CREATE INDEX "idx_message_parts_message_first_event_sequence" ON "message_parts"("message_id", "first_event_sequence");
CREATE INDEX "idx_message_parts_type" ON "message_parts"("type");
CREATE UNIQUE INDEX "uq_message_parts_message_part_key" ON "message_parts"("message_id", "part_key");
CREATE UNIQUE INDEX "uq_message_parts_message_part_index" ON "message_parts"("message_id", "part_index");
CREATE TABLE "new_messages" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversation_id" TEXT NOT NULL,
    "run_id" TEXT,
    "runtime_message_id" TEXT,
    "runtime_run_id" TEXT,
    "message_index" INTEGER,
    "surface" TEXT NOT NULL DEFAULT 'chat',
    "role" TEXT NOT NULL,
    "sender_type" TEXT NOT NULL,
    "sender_id" TEXT,
    "agent_id" TEXT,
    "task_id" TEXT,
    "group_id" TEXT,
    "parent_message_id" TEXT,
    "regenerated_from_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'created',
    "finish_reason" TEXT,
    "first_event_sequence" INTEGER,
    "last_event_sequence" INTEGER,
    "metadata_json" TEXT NOT NULL DEFAULT '{}',
    "ui_message_json" TEXT,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,
    "completed_at" TEXT,
    CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "messages_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_messages" ("agent_id", "completed_at", "conversation_id", "created_at", "finish_reason", "id", "metadata_json", "parent_message_id", "regenerated_from_id", "role", "run_id", "sender_id", "sender_type", "status", "ui_message_json", "updated_at") SELECT "agent_id", "completed_at", "conversation_id", "created_at", "finish_reason", "id", "metadata_json", "parent_message_id", "regenerated_from_id", "role", "run_id", "sender_id", "sender_type", "status", "ui_message_json", "updated_at" FROM "messages";
DROP TABLE "messages";
ALTER TABLE "new_messages" RENAME TO "messages";
CREATE INDEX "idx_messages_conversation_id_created_at" ON "messages"("conversation_id", "created_at");
CREATE INDEX "idx_messages_run_id" ON "messages"("run_id");
CREATE INDEX "idx_messages_run_runtime_message_id" ON "messages"("run_id", "runtime_message_id");
CREATE INDEX "idx_messages_conversation_id_first_event_sequence" ON "messages"("conversation_id", "first_event_sequence");
CREATE INDEX "idx_messages_run_first_event_sequence" ON "messages"("run_id", "first_event_sequence");
CREATE INDEX "idx_messages_surface_first_event_sequence" ON "messages"("surface", "first_event_sequence");
CREATE INDEX "idx_messages_sender_id" ON "messages"("sender_id");
CREATE INDEX "idx_messages_parent_message_id" ON "messages"("parent_message_id");
CREATE UNIQUE INDEX "uq_messages_run_runtime_message_id" ON "messages"("run_id", "runtime_message_id");
CREATE TABLE "new_permission_requests" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversation_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "runtime_request_id" TEXT,
    "message_id" TEXT,
    "message_index" INTEGER,
    "parent_agent_id" TEXT,
    "task_id" TEXT,
    "group_id" TEXT,
    "parent_task_id" TEXT,
    "tool_call_id" TEXT,
    "tool_name" TEXT,
    "risk_level" TEXT,
    "permission_type" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "resolved_at" TEXT,
    "expires_at" TEXT,
    "reason" TEXT,
    "decision_reason" TEXT,
    "grant_json" TEXT,
    "data_json" TEXT,
    "payload_json" TEXT NOT NULL DEFAULT '{}',
    "first_event_sequence" INTEGER,
    "last_event_sequence" INTEGER,
    "metadata_json" TEXT NOT NULL DEFAULT '{}',
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,
    CONSTRAINT "permission_requests_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "permission_requests_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_permission_requests" ("agent_id", "conversation_id", "created_at", "description", "expires_at", "id", "message_id", "metadata_json", "permission_type", "resolved_at", "run_id", "status", "target", "updated_at") SELECT "agent_id", "conversation_id", "created_at", "description", "expires_at", "id", "message_id", "metadata_json", "permission_type", "resolved_at", "run_id", "status", "target", "updated_at" FROM "permission_requests";
DROP TABLE "permission_requests";
ALTER TABLE "new_permission_requests" RENAME TO "permission_requests";
CREATE INDEX "idx_permission_requests_conversation_id" ON "permission_requests"("conversation_id");
CREATE INDEX "idx_permission_requests_run_id" ON "permission_requests"("run_id");
CREATE INDEX "idx_permission_requests_status" ON "permission_requests"("status");
CREATE INDEX "idx_permission_requests_agent_id" ON "permission_requests"("agent_id");
CREATE INDEX "idx_permission_requests_runtime_request_id" ON "permission_requests"("runtime_request_id");
CREATE INDEX "idx_permission_requests_tool_call_id" ON "permission_requests"("tool_call_id");
CREATE INDEX "idx_permission_requests_first_event_sequence" ON "permission_requests"("first_event_sequence");
CREATE TABLE "new_runs" (
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
    "last_event_sequence" INTEGER NOT NULL DEFAULT 0,
    "started_at" TEXT,
    "completed_at" TEXT,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,
    CONSTRAINT "runs_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "runs_trigger_message_id_fkey" FOREIGN KEY ("trigger_message_id") REFERENCES "messages" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_runs" ("completed_at", "conversation_id", "created_at", "error_json", "id", "input_json", "mode", "orchestrator_agent_id", "plan_json", "runtime_id", "started_at", "status", "trigger_message_id", "updated_at") SELECT "completed_at", "conversation_id", "created_at", "error_json", "id", "input_json", "mode", "orchestrator_agent_id", "plan_json", "runtime_id", "started_at", "status", "trigger_message_id", "updated_at" FROM "runs";
DROP TABLE "runs";
ALTER TABLE "new_runs" RENAME TO "runs";
CREATE INDEX "idx_runs_conversation_id_created_at" ON "runs"("conversation_id", "created_at");
CREATE INDEX "idx_runs_trigger_message_id" ON "runs"("trigger_message_id");
CREATE INDEX "idx_runs_status" ON "runs"("status");
CREATE INDEX "idx_runs_runtime_id" ON "runs"("runtime_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "idx_run_tool_calls_conversation_id" ON "run_tool_calls"("conversation_id");

-- CreateIndex
CREATE INDEX "idx_run_tool_calls_run_first_event_sequence" ON "run_tool_calls"("run_id", "first_event_sequence");

-- CreateIndex
CREATE INDEX "idx_run_tool_calls_tool_call_id" ON "run_tool_calls"("tool_call_id");

-- CreateIndex
CREATE INDEX "idx_run_tool_calls_tool_name" ON "run_tool_calls"("tool_name");

-- CreateIndex
CREATE UNIQUE INDEX "uq_run_tool_calls_run_tool_call" ON "run_tool_calls"("run_id", "tool_call_id");

-- CreateIndex
CREATE INDEX "idx_run_reasoning_blocks_conversation_id" ON "run_reasoning_blocks"("conversation_id");

-- CreateIndex
CREATE INDEX "idx_run_reasoning_blocks_run_first_event_sequence" ON "run_reasoning_blocks"("run_id", "first_event_sequence");

-- CreateIndex
CREATE INDEX "idx_run_reasoning_blocks_reasoning_id" ON "run_reasoning_blocks"("reasoning_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_run_reasoning_blocks_run_reasoning" ON "run_reasoning_blocks"("run_id", "reasoning_id");

-- CreateIndex
CREATE INDEX "idx_run_task_groups_conversation_id" ON "run_task_groups"("conversation_id");

-- CreateIndex
CREATE INDEX "idx_run_task_groups_run_first_event_sequence" ON "run_task_groups"("run_id", "first_event_sequence");

-- CreateIndex
CREATE INDEX "idx_run_task_groups_group_id" ON "run_task_groups"("group_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_run_task_groups_run_group" ON "run_task_groups"("run_id", "group_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_run_task_groups_group_id_unique" ON "run_task_groups"("group_id");

-- CreateIndex
CREATE INDEX "idx_run_tasks_conversation_id" ON "run_tasks"("conversation_id");

-- CreateIndex
CREATE INDEX "idx_run_tasks_run_first_event_sequence" ON "run_tasks"("run_id", "first_event_sequence");

-- CreateIndex
CREATE INDEX "idx_run_tasks_group_id" ON "run_tasks"("group_id");

-- CreateIndex
CREATE INDEX "idx_run_tasks_task_id" ON "run_tasks"("task_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_run_tasks_run_task" ON "run_tasks"("run_id", "task_id");

-- CreateIndex
CREATE INDEX "idx_run_plans_conversation_id" ON "run_plans"("conversation_id");

-- CreateIndex
CREATE INDEX "idx_run_plans_run_first_event_sequence" ON "run_plans"("run_id", "first_event_sequence");

-- CreateIndex
CREATE INDEX "idx_run_plans_run_revision" ON "run_plans"("run_id", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "uq_run_plans_run_source_event" ON "run_plans"("run_id", "source_event_id");

-- CreateIndex
CREATE INDEX "idx_run_plan_tasks_conversation_id" ON "run_plan_tasks"("conversation_id");

-- CreateIndex
CREATE INDEX "idx_run_plan_tasks_plan_sort_order" ON "run_plan_tasks"("plan_id", "sort_order");

-- CreateIndex
CREATE INDEX "idx_run_plan_tasks_plan_first_event_sequence" ON "run_plan_tasks"("plan_id", "first_event_sequence");

-- CreateIndex
CREATE UNIQUE INDEX "uq_run_plan_tasks_plan_task" ON "run_plan_tasks"("plan_id", "task_id");

-- CreateIndex
CREATE INDEX "idx_run_events_runtime_run_id" ON "run_events"("runtime_run_id");

-- CreateIndex
CREATE INDEX "idx_run_events_message_id" ON "run_events"("message_id");

-- CreateIndex
CREATE INDEX "idx_run_events_task_id" ON "run_events"("task_id");

-- CreateIndex
CREATE INDEX "idx_run_events_group_id" ON "run_events"("group_id");

-- CreateIndex
CREATE INDEX "idx_run_events_tool_call_id" ON "run_events"("tool_call_id");
