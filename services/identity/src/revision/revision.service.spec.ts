import { RevisionService } from './revision.service';

function makeLms(over: Partial<Record<string, unknown>> = {}) {
  return {
    getMastery: jest.fn().mockResolvedValue([
      { topic: 'Scheduling', masteryScore: 0.3, courseId: 'CS501' },
      { topic: 'Deadlocks', masteryScore: 0.5, courseId: 'CS501' },
      { topic: 'Paging', masteryScore: 0.6, courseId: 'CS501' },   // exactly threshold → not weak
      { topic: 'Threads', masteryScore: 0.9, courseId: 'CS501' },
    ]),
    listModules: jest.fn().mockResolvedValue([{ id: 'm1', collegeId: 'rvce', courseId: 'CS501', title: 'OS' }]),
    listLessons: jest.fn().mockResolvedValue([
      { id: 'l1', title: 'FCFS & RR', moduleId: 'm1', topicTags: ['Scheduling'], published: true },
      { id: 'l2', title: 'Deadlock Avoidance', moduleId: 'm1', topicTags: ['Deadlocks'], published: true },
      { id: 'l3', title: 'Banker’s Algorithm', moduleId: 'm1', topicTags: ['Deadlocks'], published: true },
    ]),
    ...over,
  };
}

describe('RevisionService', () => {
  it('returns weak topics (mastery < threshold) sorted weakest-first with matched lessons', async () => {
    const svc = new RevisionService(makeLms() as never);
    const plan = await svc.getRevisionPlan('rvce', '1RV21CS001', 'CS501'); // default threshold 0.6
    expect(plan.totalTopics).toBe(4);
    expect(plan.weakTopics.map((w) => w.topic)).toEqual(['Scheduling', 'Deadlocks']); // 0.6 & 0.9 excluded; sorted asc
    expect(plan.strongCount).toBe(2);
    // lesson matching by topicTag
    expect(plan.weakTopics[0].recommendedLessons.map((l) => l.id)).toEqual(['l1']);
    expect(plan.weakTopics[1].recommendedLessons.map((l) => l.id)).toEqual(['l2', 'l3']);
  });

  it('respects a custom threshold', async () => {
    const svc = new RevisionService(makeLms() as never);
    const plan = await svc.getRevisionPlan('rvce', 'x', 'CS501', 0.95);
    expect(plan.weakTopics).toHaveLength(4); // everything below 0.95
  });

  it('empty mastery → empty plan, no errors', async () => {
    const svc = new RevisionService(makeLms({ getMastery: jest.fn().mockResolvedValue([]) }) as never);
    const plan = await svc.getRevisionPlan('rvce', 'x', 'CS501');
    expect(plan.weakTopics).toHaveLength(0);
    expect(plan.totalTopics).toBe(0);
    expect(plan.strongCount).toBe(0);
  });
});
