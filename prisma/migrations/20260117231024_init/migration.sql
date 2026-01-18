-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('admin', 'analyst', 'operator', 'auditor');

-- CreateEnum
CREATE TYPE "AssessmentState" AS ENUM ('CREATED', 'CONTEXT_SET', 'CONSENTED', 'IN_PROGRESS', 'READY_TO_SCORE', 'COMPLETED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "EngineRunStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'NEEDS_REVIEW', 'FAILED_FINAL');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('assessment_created', 'context_updated', 'consent_accepted', 'response_saved', 'assessment_complete_requested', 'scoring_completed', 'engine_run_created', 'report_viewed', 'report_exported_pdf', 'replay_viewed', 'admin_config_changed');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subjects" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subjects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessments" (
    "id" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "questionnaireVersion" TEXT NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "state" "AssessmentState" NOT NULL DEFAULT 'CREATED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "meta" JSONB,

    CONSTRAINT "assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_contexts" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "mainContext" TEXT NOT NULL,
    "roleDescription" TEXT,
    "pressureLevel" TEXT,
    "objective" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assessment_contexts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_consents" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "termVersion" TEXT NOT NULL,
    "termHash" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assessment_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_responses" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "questionCode" TEXT NOT NULL,
    "likert" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assessment_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_flags" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "attentionOk" BOOLEAN NOT NULL DEFAULT true,
    "selfPresentationRisk" BOOLEAN NOT NULL DEFAULT false,
    "consistencyWarning" BOOLEAN NOT NULL DEFAULT false,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assessment_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engine_runs" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "questionnaireVersion" TEXT NOT NULL,
    "status" "EngineRunStatus" NOT NULL DEFAULT 'QUEUED',
    "runHash" TEXT NOT NULL,
    "inputHash" TEXT,
    "scores" JSONB NOT NULL,
    "bands" JSONB NOT NULL,
    "flags" JSONB NOT NULL,
    "reportData" JSONB NOT NULL,
    "patternIds" JSONB,
    "configHashes" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "engine_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pdf_artifacts" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "runHash" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pdf_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT,
    "userId" TEXT,
    "action" "AuditAction" NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "assessments_subjectId_idx" ON "assessments"("subjectId");

-- CreateIndex
CREATE INDEX "assessments_createdByUserId_idx" ON "assessments"("createdByUserId");

-- CreateIndex
CREATE INDEX "assessments_state_idx" ON "assessments"("state");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_contexts_assessmentId_key" ON "assessment_contexts"("assessmentId");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_consents_assessmentId_key" ON "assessment_consents"("assessmentId");

-- CreateIndex
CREATE INDEX "assessment_responses_assessmentId_idx" ON "assessment_responses"("assessmentId");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_responses_assessmentId_questionCode_key" ON "assessment_responses"("assessmentId", "questionCode");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_flags_assessmentId_key" ON "assessment_flags"("assessmentId");

-- CreateIndex
CREATE INDEX "engine_runs_assessmentId_idx" ON "engine_runs"("assessmentId");

-- CreateIndex
CREATE INDEX "engine_runs_status_idx" ON "engine_runs"("status");

-- CreateIndex
CREATE UNIQUE INDEX "engine_runs_runHash_key" ON "engine_runs"("runHash");

-- CreateIndex
CREATE INDEX "pdf_artifacts_assessmentId_idx" ON "pdf_artifacts"("assessmentId");

-- CreateIndex
CREATE UNIQUE INDEX "pdf_artifacts_runHash_key" ON "pdf_artifacts"("runHash");

-- CreateIndex
CREATE INDEX "audit_logs_assessmentId_idx" ON "audit_logs"("assessmentId");

-- CreateIndex
CREATE INDEX "audit_logs_userId_idx" ON "audit_logs"("userId");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_contexts" ADD CONSTRAINT "assessment_contexts_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "assessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_consents" ADD CONSTRAINT "assessment_consents_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "assessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_responses" ADD CONSTRAINT "assessment_responses_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "assessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_flags" ADD CONSTRAINT "assessment_flags_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "assessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engine_runs" ADD CONSTRAINT "engine_runs_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "assessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pdf_artifacts" ADD CONSTRAINT "pdf_artifacts_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "assessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "assessments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
