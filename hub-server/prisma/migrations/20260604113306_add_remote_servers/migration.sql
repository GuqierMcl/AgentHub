-- CreateTable
CREATE TABLE "remote_servers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hostname" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "port" INTEGER NOT NULL DEFAULT 22,
    "identity_file_path" TEXT,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL
);
