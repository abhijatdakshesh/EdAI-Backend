import { Entity, PrimaryColumn } from 'typeorm';
import { ALL_ENTITIES, assertRegistered } from './registry';
import { ObeProgramEntity } from './obe.entity';
import { LmsAssignmentEntity } from './lms-extensions.entity';

@Entity({ name: 'never_registered' })
class UnregisteredEntity {
  @PrimaryColumn() id!: string;
}

describe('entity registry', () => {
  it('passes through entities that are registered', () => {
    const input = [ObeProgramEntity, LmsAssignmentEntity];
    expect(assertRegistered(input)).toBe(input);
  });

  it('throws for an entity missing from ALL_ENTITIES', () => {
    // This is the exact bug the registry exists to prevent: forFeature() would
    // otherwise hand back a truthy Repository that throws
    // EntityMetadataNotFoundError on first query, in production, per-endpoint.
    expect(() => assertRegistered([UnregisteredEntity])).toThrow(/UnregisteredEntity/);
    expect(() => assertRegistered([UnregisteredEntity])).toThrow(/ALL_ENTITIES/);
  });

  it('names every offending entity, not just the first', () => {
    class AlsoMissing {}
    expect(() => assertRegistered([UnregisteredEntity, AlsoMissing])).toThrow(
      /UnregisteredEntity, AlsoMissing/,
    );
  });

  it('contains no duplicates', () => {
    expect(new Set(ALL_ENTITIES).size).toBe(ALL_ENTITIES.length);
  });

  it('covers the OBE and LMS-extension entities that were previously unregistered', () => {
    const names = ALL_ENTITIES.map((e) => e.name);
    for (const n of [
      'ObeProgramEntity', 'ObeOutcomeEntity', 'CourseOutcomeEntity', 'CoPoMapEntity',
      'AssessmentCoMapEntity', 'QuestionMarkEntity', 'ExitSurveyEntity', 'AttainmentConfigEntity',
      'LmsAssignmentEntity', 'LmsSubmissionEntity', 'LmsQuizQuestionEntity',
      'LmsDiscussionPostEntity', 'LmsLessonPrerequisiteEntity', 'LmsLearningSessionEntity',
      'LmsStreakEntity',
    ]) {
      expect(names).toContain(n);
    }
  });
});
