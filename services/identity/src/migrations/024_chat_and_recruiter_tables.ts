import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the last three tables the identity service queries but never created:
 * chat_conversations, chat_messages and recruiter_applications.
 *
 * Symptoms these fix, all of which were degrading silently in production:
 *
 *   chat_conversations / chat_messages
 *     ChatbotService catches the missing-relation error and falls back to an
 *     ephemeral conversation id, logging "chat_conversations unavailable" on
 *     every single message. The reply still works, so nothing looked broken —
 *     but no chat history was ever persisted, the admin Chat Sessions view had
 *     nothing to show, and multi-turn context reset on each message because
 *     chatStream loads history from chat_messages.
 *
 *   recruiter_applications
 *     SeedService logs `relation "recruiter_applications" does not exist` at
 *     every boot, and GET /api/recruiter/jobs/:id/applicants 500s. The recruiter
 *     knowledge graph counts applicants/shortlisted/offers from this table, so
 *     the recruiter chatbot reported an empty funnel.
 *
 * Column names and types are taken from the queries that use them, not from an
 * entity — none of these three have one. See chatbot.service.ts
 * (getOrCreateConversation, getSessions, recordConsent) and
 * recruiter.service.ts (getApplicants, updateApplicationStatus).
 *
 * NOT created here: attendance, internal_marks, ia_marks, fee_payments,
 * student_risk_scores and faculty. Those belong to the attendance, academics and
 * finance services; identity only ever saw them via seed_chatbot_data.sql, which
 * is not part of this chain.
 */
export class ChatAndRecruiterTables1700000000024 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS chat_conversations (
        id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_identifier    VARCHAR(100) NOT NULL,
        user_role          VARCHAR(30)  NOT NULL,
        channel            VARCHAR(20)  NOT NULL DEFAULT 'WEB',
        language           VARCHAR(10)  NOT NULL DEFAULT 'en',
        is_active          BOOLEAN      NOT NULL DEFAULT TRUE,
        -- DPDP Act 2023: when the user accepted AI processing of their data.
        -- NULL means consent has not been captured for this conversation.
        chatbot_consent_at TIMESTAMPTZ,
        created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        last_message_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );

      -- getOrCreateConversation resumes the most recent active conversation for
      -- a (user, channel) pair within two hours; this index is that lookup.
      CREATE INDEX IF NOT EXISTS idx_chat_conv_lookup
        ON chat_conversations (user_identifier, channel, is_active, last_message_at DESC);
      CREATE INDEX IF NOT EXISTS idx_chat_conv_recent
        ON chat_conversations (last_message_at DESC);
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        conversation_id UUID NOT NULL
                          REFERENCES chat_conversations(id) ON DELETE CASCADE,
        role            VARCHAR(20) NOT NULL
                          CHECK (role IN ('USER','ASSISTANT','SYSTEM')),
        content         TEXT NOT NULL,
        tokens_used     INTEGER,
        model_used      VARCHAR(60),
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- chatStream replays the last 10 messages in insertion order.
      CREATE INDEX IF NOT EXISTS idx_chat_messages_conv
        ON chat_messages (conversation_id, created_at ASC);
    `);

    // student_usn joins students.student_id, not students.usn — see
    // recruiter.service.ts getApplicants. No FK: applications may be seeded for
    // students who are not in this database yet, and a broken join is easier to
    // diagnose than a failed insert.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS recruiter_applications (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        job_id       UUID NOT NULL REFERENCES recruiter_jobs(id) ON DELETE CASCADE,
        student_usn  VARCHAR(20) NOT NULL,
        status       VARCHAR(20) NOT NULL DEFAULT 'APPLIED'
                       CHECK (status IN ('APPLIED','SHORTLISTED','INTERVIEW','OFFERED','REJECTED')),
        applied_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- One application per student per job; bulkShortlist relies on this.
      CREATE UNIQUE INDEX IF NOT EXISTS idx_recruiter_app_unique
        ON recruiter_applications (job_id, student_usn);
      CREATE INDEX IF NOT EXISTS idx_recruiter_app_student
        ON recruiter_applications (student_usn);
      -- The knowledge graph counts by status per job.
      CREATE INDEX IF NOT EXISTS idx_recruiter_app_job_status
        ON recruiter_applications (job_id, status);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // chat_messages before chat_conversations — the FK cascades, but dropping
    // in dependency order keeps the intent explicit.
    for (const t of ['recruiter_applications', 'chat_messages', 'chat_conversations']) {
      await queryRunner.query(`DROP TABLE IF EXISTS ${t}`);
    }
  }
}
