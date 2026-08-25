CREATE TABLE "workforce_profiles" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "homeLabel" TEXT NOT NULL DEFAULT 'Home',
  "homeAddress" TEXT NOT NULL,
  "homeLatitude" DECIMAL(10,7),
  "homeLongitude" DECIMAL(10,7),
  "schoolName" TEXT,
  "schoolAddress" TEXT,
  "schoolLatitude" DECIMAL(10,7),
  "schoolLongitude" DECIMAL(10,7),
  "weeklyTargetMinutes" INTEGER NOT NULL DEFAULT 1800,
  "travelMode" TEXT NOT NULL DEFAULT 'transit',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "workforce_profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "study_schedules" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "profileId" TEXT NOT NULL,
  "dayOfWeek" INTEGER NOT NULL,
  "startsMinute" INTEGER NOT NULL,
  "endsMinute" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "study_schedules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workforce_leaves" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "profileId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "workforce_leaves_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "workforce_profiles_userId_key" ON "workforce_profiles"("userId");
CREATE INDEX "workforce_profiles_organizationId_weeklyTargetMinutes_idx" ON "workforce_profiles"("organizationId","weeklyTargetMinutes");
CREATE UNIQUE INDEX "study_schedules_profileId_dayOfWeek_startsMinute_endsMinute_key" ON "study_schedules"("profileId","dayOfWeek","startsMinute","endsMinute");
CREATE INDEX "study_schedules_organizationId_dayOfWeek_idx" ON "study_schedules"("organizationId","dayOfWeek");
CREATE INDEX "workforce_leaves_organizationId_kind_startsAt_endsAt_idx" ON "workforce_leaves"("organizationId","kind","startsAt","endsAt");
CREATE INDEX "workforce_leaves_profileId_startsAt_endsAt_idx" ON "workforce_leaves"("profileId","startsAt","endsAt");

ALTER TABLE "workforce_profiles" ADD CONSTRAINT "workforce_profiles_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workforce_profiles" ADD CONSTRAINT "workforce_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "study_schedules" ADD CONSTRAINT "study_schedules_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "study_schedules" ADD CONSTRAINT "study_schedules_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "workforce_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workforce_leaves" ADD CONSTRAINT "workforce_leaves_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workforce_leaves" ADD CONSTRAINT "workforce_leaves_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "workforce_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
