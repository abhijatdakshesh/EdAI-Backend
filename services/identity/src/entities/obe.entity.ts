import { Column, Entity, Index, PrimaryColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

// Outcome-Based Education (OBE) — CO/PO definitions, CO-PO mapping,
// assessment→CO links, question-level marks, exit surveys, attainment config.
// Multi-tenant via college_id (see resolveCollegeId / lms.entity.ts conventions).

export type OutcomeKind = 'PO' | 'PSO';
export type AssessmentComponent = 'IA1' | 'IA2' | 'IA3' | 'ASSIGNMENT' | 'SEE';

@Entity({ name: 'obe_programs' })
@Index(['collegeId'])
export class ObeProgramEntity {
  @PrimaryColumn() id!: string;
  @Column({ name: 'college_id' }) collegeId!: string;
  @Column() code!: string;            // e.g. "CSE-BE"
  @Column() name!: string;
  @Column({ nullable: true }) department?: string;
  @Column({ nullable: true }) version?: string; // regulation/scheme year
  @CreateDateColumn() createdAt!: Date;
  @UpdateDateColumn() updatedAt!: Date;
}

@Entity({ name: 'obe_outcomes' })
@Index(['collegeId'])
@Index(['collegeId', 'programId'])
export class ObeOutcomeEntity {
  @PrimaryColumn() id!: string;
  @Column({ name: 'college_id' }) collegeId!: string;
  @Column() programId!: string;
  @Column() kind!: OutcomeKind;       // PO | PSO
  @Column({ type: 'int' }) seq!: number;
  @Column() code!: string;            // "PO1", "PSO1"
  @Column({ type: 'text' }) statement!: string;
  @Column({ type: 'float', default: 2.0 }) target!: number; // target attainment level
  @CreateDateColumn() createdAt!: Date;
  @UpdateDateColumn() updatedAt!: Date;
}

@Entity({ name: 'obe_course_outcomes' })
@Index(['collegeId'])
@Index(['collegeId', 'courseId'])
export class CourseOutcomeEntity {
  @PrimaryColumn() id!: string;
  @Column({ name: 'college_id' }) collegeId!: string;
  @Column() courseId!: string;        // course code, e.g. "CS501"
  @Column({ type: 'int' }) seq!: number;
  @Column() code!: string;            // "CO1"
  @Column({ type: 'text' }) statement!: string;
  @Column({ nullable: true }) bloomLevel?: string;
  @Column({ type: 'float', default: 60 }) targetThreshold!: number; // per-student pass %
  @Column({ type: 'float', default: 2.0 }) targetAttainmentLevel!: number;
  @CreateDateColumn() createdAt!: Date;
  @UpdateDateColumn() updatedAt!: Date;
}

@Entity({ name: 'obe_co_po_map' })
@Index(['collegeId'])
@Index(['collegeId', 'coId'])
export class CoPoMapEntity {
  @PrimaryColumn() id!: string;
  @Column({ name: 'college_id' }) collegeId!: string;
  @Column() coId!: string;
  @Column() outcomeId!: string;       // PO/PSO id
  @Column({ type: 'int' }) correlation!: number; // 1 | 2 | 3
  @CreateDateColumn() createdAt!: Date;
}

@Entity({ name: 'obe_assessment_co_map' })
@Index(['collegeId'])
@Index(['collegeId', 'courseId'])
export class AssessmentCoMapEntity {
  @PrimaryColumn() id!: string;
  @Column({ name: 'college_id' }) collegeId!: string;
  @Column() courseId!: string;
  @Column() component!: AssessmentComponent;
  @Column({ type: 'int', nullable: true }) questionNo?: number; // null = whole component
  @Column() coId!: string;
  @Column({ type: 'float', default: 0 }) maxMarks!: number;     // for question-level weighting
  @CreateDateColumn() createdAt!: Date;
}

@Entity({ name: 'obe_question_marks' })
@Index(['collegeId'])
@Index(['collegeId', 'courseId'])
export class QuestionMarkEntity {
  @PrimaryColumn() id!: string;
  @Column({ name: 'college_id' }) collegeId!: string;
  @Column() courseId!: string;
  @Column() usn!: string;
  @Column() component!: AssessmentComponent;
  @Column({ type: 'int' }) questionNo!: number;
  @Column({ type: 'float' }) marks!: number;
  @Column({ type: 'float' }) maxMarks!: number;
  @CreateDateColumn() createdAt!: Date;
}

@Entity({ name: 'obe_exit_survey' })
@Index(['collegeId'])
@Index(['collegeId', 'courseId'])
export class ExitSurveyEntity {
  @PrimaryColumn() id!: string;
  @Column({ name: 'college_id' }) collegeId!: string;
  @Column() courseId!: string;
  @Column() coId!: string;
  @Column({ type: 'float' }) avgRating!: number;     // normalized 0..3
  @Column({ type: 'int', default: 0 }) responseCount!: number;
  @UpdateDateColumn() updatedAt!: Date;
}

@Entity({ name: 'obe_attainment_config' })
@Index(['collegeId'])
export class AttainmentConfigEntity {
  @PrimaryColumn() id!: string;
  @Column({ name: 'college_id' }) collegeId!: string;
  @Column({ nullable: true }) courseId?: string;     // null = program/college default
  @Column({ type: 'float', default: 80 }) directWeight!: number;
  @Column({ type: 'float', default: 20 }) indirectWeight!: number;
  @Column({ type: 'float', default: 40 }) level1Pct!: number; // % students ≥ threshold → level 1
  @Column({ type: 'float', default: 55 }) level2Pct!: number;
  @Column({ type: 'float', default: 70 }) level3Pct!: number;
  @UpdateDateColumn() updatedAt!: Date;
}

/** The standard 12 NBA Program Outcomes (graduate attributes). */
export const STANDARD_NBA_POS: Array<{ seq: number; code: string; statement: string }> = [
  { seq: 1, code: 'PO1', statement: 'Engineering knowledge' },
  { seq: 2, code: 'PO2', statement: 'Problem analysis' },
  { seq: 3, code: 'PO3', statement: 'Design/development of solutions' },
  { seq: 4, code: 'PO4', statement: 'Conduct investigations of complex problems' },
  { seq: 5, code: 'PO5', statement: 'Modern tool usage' },
  { seq: 6, code: 'PO6', statement: 'The engineer and society' },
  { seq: 7, code: 'PO7', statement: 'Environment and sustainability' },
  { seq: 8, code: 'PO8', statement: 'Ethics' },
  { seq: 9, code: 'PO9', statement: 'Individual and team work' },
  { seq: 10, code: 'PO10', statement: 'Communication' },
  { seq: 11, code: 'PO11', statement: 'Project management and finance' },
  { seq: 12, code: 'PO12', statement: 'Life-long learning' },
];
