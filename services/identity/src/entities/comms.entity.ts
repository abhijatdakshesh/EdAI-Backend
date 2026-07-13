import { Entity, PrimaryColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('ai_call_logs')
export class AiCallLogEntity {
  @PrimaryColumn() id!: string;
  @Column() studentUsn!: string;
  @Column() studentName!: string;
  @Column() parentId!: string;
  @Column() outcome!: string;
  @Column('int', { nullable: true }) duration!: number;
  @Column({ nullable: true }) institutionId!: string;
  @Column({ nullable: true }) classId!: string;
  @Column({ nullable: true }) parentPhone!: string;
  @Column({ nullable: true }) transcript!: string;
  @Column({ nullable: true }) summary!: string;
  // Live-agent handoff (AI→human transfer)
  @Column({ nullable: true }) transferStatus!: string;
  @Column({ nullable: true }) transferReason!: string;
  @Column({ type: 'timestamptz', nullable: true }) transferredAt!: Date;
  @Column('int', { nullable: true }) transferDuration!: number;
  @CreateDateColumn() calledAt!: Date;
}

@Entity('consent_records')
export class ConsentRecordEntity {
  @PrimaryColumn() id!: string;
  @Column() principalId!: string;
  @Column() institutionId!: string;
  @Column('text', { array: true }) channels!: string[];
  @Column({ default: true }) active!: boolean;
  @Column({ nullable: true }) revokedAt!: string;
  @CreateDateColumn() grantedAt!: Date;
}

@Entity('announcements')
export class AnnouncementEntity {
  @PrimaryColumn() id!: string;
  @Column() title!: string;
  @Column('text') content!: string;
  @Column() audience!: string;
  @Column({ nullable: true }) institutionId!: string;
  @CreateDateColumn() createdAt!: Date;
}
