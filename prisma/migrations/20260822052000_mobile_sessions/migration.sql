CREATE TABLE "mobile_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "deviceName" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mobile_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "mobile_sessions_userId_revokedAt_expiresAt_idx"
ON "mobile_sessions"("userId", "revokedAt", "expiresAt");

CREATE INDEX "mobile_sessions_organizationId_revokedAt_expiresAt_idx"
ON "mobile_sessions"("organizationId", "revokedAt", "expiresAt");

ALTER TABLE "mobile_sessions"
ADD CONSTRAINT "mobile_sessions_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mobile_sessions"
ADD CONSTRAINT "mobile_sessions_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
