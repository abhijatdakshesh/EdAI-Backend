import { Injectable } from '@nestjs/common';
import { LmsService } from '../lms/lms.service';

export interface RevisionItem {
  topic: string;
  masteryScore: number;          // 0..1
  recommendedLessons: Array<{ id: string; title: string; moduleId: string }>;
}
export interface RevisionPlan {
  usn: string;
  courseId: string;
  threshold: number;
  weakTopics: RevisionItem[];
  strongCount: number;
  totalTopics: number;
}

const DEFAULT_THRESHOLD = 0.6;

/**
 * Adaptive revision: turns LMS topic-mastery into a prioritised revision plan —
 * weak topics (mastery < threshold) mapped to the lessons that teach them.
 * Reuses LmsService.getMastery + listModules/listLessons (no new data store).
 */
@Injectable()
export class RevisionService {
  constructor(private readonly lms: LmsService) {}

  async getRevisionPlan(collegeId: string, usn: string, courseId: string, threshold = DEFAULT_THRESHOLD): Promise<RevisionPlan> {
    const mastery = await this.lms.getMastery(collegeId, usn, courseId);

    // Collect all lessons for the course (across its modules) once.
    const modules = await this.lms.listModules(collegeId, courseId);
    const lessons: Array<{ id: string; title: string; moduleId: string; topicTags: string[] }> = [];
    for (const m of modules) {
      const ls = await this.lms.listLessons(collegeId, m.id);
      for (const l of ls) lessons.push({ id: l.id, title: l.title, moduleId: l.moduleId, topicTags: l.topicTags ?? [] });
    }

    const weak = mastery
      .filter((m) => m.masteryScore < threshold)
      .sort((a, b) => a.masteryScore - b.masteryScore)
      .map<RevisionItem>((m) => ({
        topic: m.topic,
        masteryScore: Number(m.masteryScore.toFixed(2)),
        recommendedLessons: lessons
          .filter((l) => l.topicTags.includes(m.topic))
          .map((l) => ({ id: l.id, title: l.title, moduleId: l.moduleId })),
      }));

    return {
      usn, courseId, threshold,
      weakTopics: weak,
      strongCount: mastery.length - weak.length,
      totalTopics: mastery.length,
    };
  }
}
