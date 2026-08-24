CREATE SCHEMA IF NOT EXISTS "public";

CREATE TYPE "UserRole" AS ENUM ('admin', 'supervisor', 'employee', 'viewer');
CREATE TYPE "SupplyPriority" AS ENUM ('urgent', 'normal', 'low');
CREATE TYPE "AuthTokenType" AS ENUM ('invite', 'password_reset');

CREATE TABLE "users" (
    "id" TEXT NOT NULL, "email" TEXT NOT NULL, "password" TEXT, "name" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'viewer', "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "auth_tokens" (
    "id" TEXT NOT NULL, "tokenHash" TEXT NOT NULL, "type" "AuthTokenType" NOT NULL,
    "userId" TEXT NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL, "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "auth_tokens_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "auth_rate_limits" (
    "id" TEXT NOT NULL, "key" TEXT NOT NULL, "attempts" INTEGER NOT NULL DEFAULT 0,
    "resetAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "auth_rate_limits_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL, "actorEmail" TEXT NOT NULL, "action" TEXT NOT NULL, "targetType" TEXT NOT NULL,
    "targetId" TEXT, "metadata" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "email_templates" (
    "id" TEXT NOT NULL, "key" TEXT NOT NULL, "subject" TEXT NOT NULL, "body" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "email_templates_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "notification_settings" (
    "id" TEXT NOT NULL, "key" TEXT NOT NULL, "recipients" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notification_settings_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "supply_requests" (
    "id" TEXT NOT NULL, "employeeName" TEXT NOT NULL, "clientLocation" TEXT NOT NULL,
    "priority" "SupplyPriority" NOT NULL, "products" TEXT NOT NULL, "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Pending', "submittedBy" TEXT NOT NULL,
    "emailSentAt" TIMESTAMP(3), "completedAt" TIMESTAMP(3), "dueAt" TIMESTAMP(3), "assignedTo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "supply_requests_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "feedback_entries" (
    "id" TEXT NOT NULL, "employeeName" TEXT NOT NULL, "employeeId" TEXT, "clientLocation" TEXT NOT NULL,
    "cleanliness" DOUBLE PRECISION NOT NULL, "punctuality" DOUBLE PRECISION NOT NULL,
    "equipment" DOUBLE PRECISION NOT NULL, "clientRelations" DOUBLE PRECISION NOT NULL,
    "overall" DOUBLE PRECISION NOT NULL, "category" TEXT NOT NULL, "comments" TEXT,
    "submittedBy" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "feedback_entries_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "supply_status_events" (
    "id" TEXT NOT NULL, "requestId" TEXT NOT NULL, "fromStatus" TEXT, "toStatus" TEXT NOT NULL,
    "actorEmail" TEXT NOT NULL, "note" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "supply_status_events_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "supply_request_items" (
    "id" TEXT NOT NULL, "requestId" TEXT NOT NULL, "product" TEXT NOT NULL, "quantity" INTEGER NOT NULL,
    CONSTRAINT "supply_request_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "auth_tokens_tokenHash_key" ON "auth_tokens"("tokenHash");
CREATE INDEX "auth_tokens_userId_type_idx" ON "auth_tokens"("userId", "type");
CREATE INDEX "auth_tokens_expiresAt_idx" ON "auth_tokens"("expiresAt");
CREATE UNIQUE INDEX "auth_rate_limits_key_key" ON "auth_rate_limits"("key");
CREATE INDEX "auth_rate_limits_resetAt_idx" ON "auth_rate_limits"("resetAt");
CREATE INDEX "audit_logs_actorEmail_idx" ON "audit_logs"("actorEmail");
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");
CREATE UNIQUE INDEX "email_templates_key_key" ON "email_templates"("key");
CREATE UNIQUE INDEX "notification_settings_key_key" ON "notification_settings"("key");
CREATE INDEX "supply_requests_status_idx" ON "supply_requests"("status");
CREATE INDEX "supply_requests_submittedBy_idx" ON "supply_requests"("submittedBy");
CREATE INDEX "supply_requests_createdAt_idx" ON "supply_requests"("createdAt");
CREATE INDEX "feedback_entries_submittedBy_idx" ON "feedback_entries"("submittedBy");
CREATE INDEX "feedback_entries_employeeName_idx" ON "feedback_entries"("employeeName");
CREATE INDEX "feedback_entries_employeeId_idx" ON "feedback_entries"("employeeId");
CREATE INDEX "feedback_entries_createdAt_idx" ON "feedback_entries"("createdAt");
CREATE INDEX "supply_status_events_requestId_createdAt_idx" ON "supply_status_events"("requestId", "createdAt");
CREATE INDEX "supply_request_items_requestId_idx" ON "supply_request_items"("requestId");

ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorEmail_fkey" FOREIGN KEY ("actorEmail") REFERENCES "users"("email") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supply_requests" ADD CONSTRAINT "supply_requests_submittedBy_fkey" FOREIGN KEY ("submittedBy") REFERENCES "users"("email") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "feedback_entries" ADD CONSTRAINT "feedback_entries_submittedBy_fkey" FOREIGN KEY ("submittedBy") REFERENCES "users"("email") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "feedback_entries" ADD CONSTRAINT "feedback_entries_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "supply_status_events" ADD CONSTRAINT "supply_status_events_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "supply_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "supply_request_items" ADD CONSTRAINT "supply_request_items_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "supply_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
