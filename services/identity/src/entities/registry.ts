/**
 * Single source of truth for every TypeORM entity in the identity service.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Entity lists used to be maintained by hand in three independent places:
 *
 *   1. `database/database.module.ts`  → TypeOrmModule.forRoot({ entities })
 *   2. each feature module            → TypeOrmModule.forFeature([...])
 *   3. `migrations/run.ts`            → new DataSource({ entities })
 *
 * They drifted, and the drift is silent in the most dangerous direction:
 *
 *   - An entity in (2) but NOT (1) still yields a *truthy* Repository, because
 *     `DataSource.getRepository()` never validates metadata. The failure only
 *     surfaces on the first query, as `EntityMetadataNotFoundError`. This is
 *     how all 8 OBE entities came to be wired into `obe.module.ts` while being
 *     absent from `forRoot` — every OBE endpoint would 500 the moment
 *     DATABASE_URL was set.
 *
 *   - An entity in (1) but NOT (2) is simply never injectable, so the owning
 *     service silently keeps its in-memory fallback and loses data on cold
 *     start. This is what happened to the 7 LMS-extension entities.
 *
 * Both classes of bug are invisible at build time and at boot. Keeping one
 * exported list, and routing every `forFeature` through `assertRegistered()`,
 * makes the drift impossible to reintroduce: a mismatch now throws while the
 * Nest module graph is being constructed, i.e. at startup, not per-request.
 *
 * ADDING AN ENTITY
 * ----------------
 *   1. Add the class to ALL_ENTITIES below.
 *   2. Add a migration that creates its table (see the table-coverage note).
 *   3. Use `assertRegistered([...])` in the owning module's `forFeature`.
 *
 * TABLE COVERAGE
 * --------------
 * Registration here means "TypeORM knows the shape". It does NOT mean the
 * table exists — that is what migrations are for, and the two can also drift.
 * `DatabasePreflightService` checks the remaining gap at boot and reports it.
 */
import { FeeItemEntity } from './fee-item.entity';
import { PromotionBatchEntity, PromotionAuditEntity } from './promotion-batch.entity';
import { VtuWindowEntity, VtuEligibilityEntity, VtuRegistrationEntity } from './vtu.entity';
import { AiCallLogEntity, ConsentRecordEntity, AnnouncementEntity } from './comms.entity';
import { StudentEntity, ParentStudentLinkEntity } from './student-orm.entity';
import { PlacementDriveEntity, AlumniOutcomeEntity } from './placement.entity';
import { ModuleEntity, LessonEntity, LessonProgressEntity, TopicMasteryEntity } from './lms.entity';
import {
  LmsAssignmentEntity,
  LmsSubmissionEntity,
  LmsQuizQuestionEntity,
  LmsDiscussionPostEntity,
  LmsLessonPrerequisiteEntity,
  LmsLearningSessionEntity,
  LmsStreakEntity,
} from './lms-extensions.entity';
import {
  ObeProgramEntity,
  ObeOutcomeEntity,
  CourseOutcomeEntity,
  CoPoMapEntity,
  AssessmentCoMapEntity,
  QuestionMarkEntity,
  ExitSurveyEntity,
  AttainmentConfigEntity,
} from './obe.entity';

/** Any entity class. TypeORM's own EntityTarget is too loose to compare by identity. */
export type EntityClass = Function;

/**
 * Every entity known to the identity service.
 *
 * Ordering is by domain, purely for readability — TypeORM does not care.
 */
export const ALL_ENTITIES: EntityClass[] = [
  // ── Identity / students ──────────────────────────────────────────────────
  StudentEntity,
  ParentStudentLinkEntity,

  // ── Fees ─────────────────────────────────────────────────────────────────
  FeeItemEntity,

  // ── Promotion ────────────────────────────────────────────────────────────
  PromotionBatchEntity,
  PromotionAuditEntity,

  // ── VTU ──────────────────────────────────────────────────────────────────
  VtuWindowEntity,
  VtuEligibilityEntity,
  VtuRegistrationEntity,

  // ── Comms ────────────────────────────────────────────────────────────────
  AiCallLogEntity,
  ConsentRecordEntity,
  AnnouncementEntity,

  // ── Placement ────────────────────────────────────────────────────────────
  PlacementDriveEntity,
  AlumniOutcomeEntity,

  // ── LMS core ─────────────────────────────────────────────────────────────
  ModuleEntity,
  LessonEntity,
  LessonProgressEntity,
  TopicMasteryEntity,

  // ── LMS extensions (migration 013) ───────────────────────────────────────
  // Previously absent from forRoot AND never injected: assignments,
  // submissions, quiz bank, discussions, prerequisites, learning sessions and
  // streaks all lived in process memory and died on every cold start.
  LmsAssignmentEntity,
  LmsSubmissionEntity,
  LmsQuizQuestionEntity,
  LmsDiscussionPostEntity,
  LmsLessonPrerequisiteEntity,
  LmsLearningSessionEntity,
  LmsStreakEntity,

  // ── OBE / accreditation (migration 014) ──────────────────────────────────
  // Previously in `obe.module.ts` forFeature but absent from forRoot, so every
  // repository resolved truthy and threw EntityMetadataNotFoundError on use.
  ObeProgramEntity,
  ObeOutcomeEntity,
  CourseOutcomeEntity,
  CoPoMapEntity,
  AssessmentCoMapEntity,
  QuestionMarkEntity,
  ExitSurveyEntity,
  AttainmentConfigEntity,
];

const REGISTERED = new Set<EntityClass>(ALL_ENTITIES);

/**
 * Guard for `TypeOrmModule.forFeature()`.
 *
 * Returns the entities unchanged when every one is registered, and throws
 * otherwise. Call it at every forFeature site:
 *
 *     TypeOrmModule.forFeature(assertRegistered([ObeProgramEntity, ...]))
 *
 * The throw happens while Nest builds the module graph — loudly, at startup,
 * before the service can accept traffic. That is the entire point: the bug
 * class this replaces was only observable as a 500 on a specific endpoint,
 * often long after deploy.
 */
export function assertRegistered<T extends EntityClass[]>(entities: T): T {
  const missing = entities.filter((e) => !REGISTERED.has(e));
  if (missing.length > 0) {
    const names = missing.map((e) => e.name).join(', ');
    throw new Error(
      `[entity-registry] ${names} used in TypeOrmModule.forFeature() but missing from ` +
        `ALL_ENTITIES in src/entities/registry.ts. Repositories for unregistered entities ` +
        `resolve truthy and then throw EntityMetadataNotFoundError on first query. ` +
        `Add the entity to ALL_ENTITIES (and ensure a migration creates its table).`,
    );
  }
  return entities;
}
