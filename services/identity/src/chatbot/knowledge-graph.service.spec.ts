import { KnowledgeGraphService } from './knowledge-graph.service';

const mockQuery = jest.fn();
const mockDb = { query: mockQuery } as any;

const studentRow = {
  name: 'Alice', usn: '1RV21CS001', semester: 5, section: 'A', department: 'CSE', lang: 'en',
};
const slotRow = { slot_index: 0, subject_name: 'DBMS', faculty_name: 'Dr. Kumar', room_number: 'LH-101', is_lab: false };
const attRow = { subject_name: 'DBMS', present: 40, total: 50, pct: 80.0, needed: 0 };
const marksRow = { subject_name: 'DBMS', ia1: 18, ia2: 17, max_marks: 20 };
const feeRow = { total_amount: 85000, paid_amount: 60000, balance: 25000, payment_status: 'PARTIAL', due_date: '2026-05-15' };
const riskRow = { risk_score: 0.3, risk_level: 'LOW' };
const absenceRow = { cnt: 2 };

const teacherRow = { name: 'Dr. Kumar', emp_id: 'FAC001', department: 'CSE', lang: 'en' };
const teacherSlot = { slot_index: 1, subject_name: 'DBMS', section: 'A', room_number: 'LH-101', semester: 5 };
const subjectRow = { subject_name: 'DBMS', sections: 'A, B', total_students: 60, avg_att: 78.5 };
const atRiskRow = { usn: '1RV21CS002', name: 'Bob', risk_score: 0.8, risk_level: 'HIGH', primary_concern: 'Low attendance' };

describe('KnowledgeGraphService', () => {
  let svc: KnowledgeGraphService;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new KnowledgeGraphService(mockDb);
  });

  describe('buildStudentGraph()', () => {
    it('returns student graph with live data', async () => {
      mockQuery
        .mockResolvedValueOnce([studentRow])   // 1. students (profile)
        .mockResolvedValueOnce([slotRow])       // 2. todaySlots
        .mockResolvedValueOnce([])              // 3. weekSlots
        .mockResolvedValueOnce([attRow])        // 4. attendance
        .mockResolvedValueOnce([marksRow])      // 5. marks
        .mockResolvedValueOnce([feeRow])        // 6. fees
        .mockResolvedValueOnce([])              // 7. feeItems
        .mockResolvedValueOnce([riskRow])       // 8. risk
        .mockResolvedValueOnce([absenceRow])    // 9. absences
        .mockResolvedValueOnce([])              // 10. announcements
        .mockResolvedValueOnce([])              // 11. placements
        .mockResolvedValueOnce([])              // 12. vtuWindows
        .mockResolvedValueOnce([])              // 13. vtuElig
        .mockResolvedValueOnce([])             // 14. vtuReg
        .mockResolvedValueOnce([]);             // 15. topicMastery (lms_topic_mastery)

      const graph = await svc.buildStudentGraph('1RV21CS001');

      expect(graph.role).toBe('STUDENT');
      expect(graph.name).toBe('Alice');
      expect(graph.usn).toBe('1RV21CS001');
      expect(graph.todaySchedule).toHaveLength(1);
      expect(graph.todaySchedule[0].subject).toBe('DBMS');
      expect(graph.attendanceSummary[0].percentage).toBe(80);
      expect(graph.detentionRisk).toBe(false);
      expect(graph.feeStatus.balance).toBe(25000);
      expect(graph.riskLevel).toBe('LOW');
      expect(graph.recentAbsenceCount).toBe(2);
    });

    it('returns empty graph when student not found', async () => {
      mockQuery
        .mockResolvedValueOnce([])              // 1. students — empty
        .mockResolvedValueOnce([])              // 2. todaySlots
        .mockResolvedValueOnce([])              // 3. weekSlots
        .mockResolvedValueOnce([])              // 4. attendance
        .mockResolvedValueOnce([])              // 5. marks
        .mockResolvedValueOnce([])              // 6. fees
        .mockResolvedValueOnce([])              // 7. feeItems
        .mockResolvedValueOnce([])              // 8. risk
        .mockResolvedValueOnce([{ cnt: 0 }])    // 9. absences
        .mockResolvedValueOnce([])              // 10. announcements
        .mockResolvedValueOnce([])              // 11. placements
        .mockResolvedValueOnce([])              // 12. vtuWindows
        .mockResolvedValueOnce([])              // 13. vtuElig
        .mockResolvedValueOnce([])             // 14. vtuReg
        .mockResolvedValueOnce([]);             // 15. topicMastery (lms_topic_mastery)

      const graph = await svc.buildStudentGraph('UNKNOWN');
      // Production now synthesizes a 'Demo Student' profile when the row is missing.
      expect(graph.name).toBe('Demo Student');
      // todaySchedule falls back to DEMO_TODAY_SCHEDULE when DB returns no slots.
      expect(Array.isArray(graph.todaySchedule)).toBe(true);
    });

    it('returns demo fallback graph when db is null', async () => {
      const svcNoDb = new KnowledgeGraphService(null);
      const graph = await svcNoDb.buildStudentGraph('1RV21CS001');
      expect(graph.role).toBe('STUDENT');
      // No DB → demo-rich fallback so the assistant can still answer core
      // questions (schedule/fees/attendance) instead of "I don't have that".
      expect(graph.name).toBe('Demo Student');
      expect(Object.keys(graph.weekSchedule).length).toBeGreaterThan(0);
    });

    it('sets detentionRisk when any subject below 75%', async () => {
      const lowAtt = { ...attRow, pct: 60.0, needed: 8 };
      mockQuery
        .mockResolvedValueOnce([studentRow])    // 1. students
        .mockResolvedValueOnce([])              // 2. todaySlots
        .mockResolvedValueOnce([])              // 3. weekSlots
        .mockResolvedValueOnce([lowAtt])        // 4. attendance
        .mockResolvedValueOnce([])              // 5. marks
        .mockResolvedValueOnce([])              // 6. fees
        .mockResolvedValueOnce([])              // 7. feeItems
        .mockResolvedValueOnce([])              // 8. risk
        .mockResolvedValueOnce([{ cnt: 0 }])    // 9. absences
        .mockResolvedValueOnce([])              // 10. announcements
        .mockResolvedValueOnce([])              // 11. placements
        .mockResolvedValueOnce([])              // 12. vtuWindows
        .mockResolvedValueOnce([])              // 13. vtuElig
        .mockResolvedValueOnce([])             // 14. vtuReg
        .mockResolvedValueOnce([]);             // 15. topicMastery (lms_topic_mastery)

      const graph = await svc.buildStudentGraph('1RV21CS001');
      expect(graph.detentionRisk).toBe(true);
    });

    it('handles missing fee record gracefully', async () => {
      mockQuery
        .mockResolvedValueOnce([studentRow])    // 1. students
        .mockResolvedValueOnce([])              // 2. todaySlots
        .mockResolvedValueOnce([])              // 3. weekSlots
        .mockResolvedValueOnce([])              // 4. attendance
        .mockResolvedValueOnce([])              // 5. marks
        .mockResolvedValueOnce([])              // 6. fees — no fee row
        .mockResolvedValueOnce([])              // 7. feeItems
        .mockResolvedValueOnce([])              // 8. risk
        .mockResolvedValueOnce([{ cnt: 0 }])    // 9. absences
        .mockResolvedValueOnce([])              // 10. announcements
        .mockResolvedValueOnce([])              // 11. placements
        .mockResolvedValueOnce([])              // 12. vtuWindows
        .mockResolvedValueOnce([])              // 13. vtuElig
        .mockResolvedValueOnce([])             // 14. vtuReg
        .mockResolvedValueOnce([]);             // 15. topicMastery (lms_topic_mastery)

      const graph = await svc.buildStudentGraph('1RV21CS001');
      // Missing fee row now falls back to DEMO_FEES with status 'PARTIAL'.
      expect(graph.feeStatus.status).toBe('PARTIAL');
    });
  });

  describe('buildParentGraph()', () => {
    it('returns parent graph wrapping child student graph', async () => {
      mockQuery
        .mockResolvedValueOnce([{ student_id: '1RV21CS001', lang: 'kn' }])  // 0. parent lookup
        // buildStudentGraph runs first (await Promise.all → both start, but parent lookup has student_id field)
        // Promise.all in buildParentGraph fires buildStudentGraph + parentAnnouncements concurrently
        // buildStudentGraph queries 1-14 + parentAnnouncements query
        .mockResolvedValueOnce([studentRow])    // 1. students
        .mockResolvedValueOnce([slotRow])       // 2. todaySlots
        .mockResolvedValueOnce([])              // 3. weekSlots
        .mockResolvedValueOnce([attRow])        // 4. attendance
        .mockResolvedValueOnce([marksRow])      // 5. marks
        .mockResolvedValueOnce([feeRow])        // 6. fees
        .mockResolvedValueOnce([])              // 7. feeItems
        .mockResolvedValueOnce([riskRow])       // 8. risk
        .mockResolvedValueOnce([absenceRow])    // 9. absences
        .mockResolvedValueOnce([])              // 10. announcements
        .mockResolvedValueOnce([])              // 11. placements
        .mockResolvedValueOnce([])              // 12. vtuWindows
        .mockResolvedValueOnce([])              // 13. vtuElig
        .mockResolvedValueOnce([])              // 14. vtuReg
        .mockResolvedValueOnce([])              // 15. topicMastery (lms_topic_mastery)
        .mockResolvedValueOnce([]);             // 16. parentAnnouncements

      const graph = await svc.buildParentGraph('+919845012345');
      expect(graph.role).toBe('PARENT');
      expect(graph.preferredLanguage).toBe('kn');
      expect(graph.child.name).toBe('Alice');
    });

    it('throws when parent not found (after both phone- and user-id lookups miss)', async () => {
      mockQuery
        .mockResolvedValueOnce([])  // 1. students.parent_phone
        .mockResolvedValueOnce([]); // 2. parent_student_links fallback
      // Identifier is not in DEMO_PARENT_USN — must reject.
      await expect(svc.buildParentGraph('+91000')).rejects.toThrow('Parent not found');
    });

    it('returns demo fallback parent graph when db is null', async () => {
      const svcNoDb = new KnowledgeGraphService(null);
      const graph = await svcNoDb.buildParentGraph('+91000');
      expect(graph.role).toBe('PARENT');
      expect(graph.child.name).toBe('Demo Student');
    });

    it('falls back to demo USN when identifier is the seed parent UUID and DB lookups miss', async () => {
      // Both phone- and parent_student_links lookups return [] — but
      // 'u-parent-01' is in DEMO_PARENT_USN so we still build a personalised
      // graph keyed on the demo child USN. This is what unblocks the parent
      // chatbot demo on prod (KAN-fix multi-portal sweep).
      // Default to [] for all subsequent buildStudentGraph queries so
      // every per-query .catch chain has something to chain off.
      mockQuery.mockResolvedValue([]);
      const graph = await svc.buildParentGraph('u-parent-01');
      expect(graph.role).toBe('PARENT');
      expect(graph.child).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // withTimeout() — the setTimeout callback fires when the DB query hangs
  // longer than GRAPH_TIMEOUT_MS (12000ms). Fake timers let us simulate this.
  // ---------------------------------------------------------------------------
  describe('withTimeout() — timeout fires and returns fallback (line 68 setTimeout callback)', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    it('returns fallback student graph when DB query exceeds the timeout', async () => {
      // DB query hangs indefinitely — never resolves
      mockQuery.mockReturnValue(new Promise(() => {}));

      const graphPromise = svc.buildStudentGraph('1RV21CS001');

      // Advance fake timers past GRAPH_TIMEOUT_MS (12000ms) so the setTimeout
      // callback fires, resolving the timeout promise with the fallback.
      jest.advanceTimersByTime(12001);

      const graph = await graphPromise;
      // Demo-rich fallback is returned (not an empty graph)
      expect(graph.name).toBe('Demo Student');
      expect(graph.role).toBe('STUDENT');
    });

    it('returns fallback teacher graph when DB query exceeds the timeout', async () => {
      mockQuery.mockReturnValue(new Promise(() => {}));

      const graphPromise = svc.buildTeacherGraph('FAC001');
      jest.advanceTimersByTime(12001);

      const graph = await graphPromise;
      expect(graph.name).toBe('Unknown');
      expect(graph.role).toBe('TEACHER');
    });

    it('returns fallback parent graph when DB query exceeds the timeout', async () => {
      mockQuery.mockReturnValue(new Promise(() => {}));

      const graphPromise = svc.buildParentGraph('+919845012345');
      jest.advanceTimersByTime(12001);

      const graph = await graphPromise;
      expect(graph.role).toBe('PARENT');
      expect(graph.child.name).toBe('Demo Student');
    });
  });

  describe('buildTeacherGraph()', () => {
    it('returns teacher graph with schedule and at-risk students', async () => {
      mockQuery
        .mockResolvedValueOnce([teacherRow])     // teachers
        .mockResolvedValueOnce([teacherSlot])    // todaySlots
        .mockResolvedValueOnce([])               // weekSlots
        .mockResolvedValueOnce([subjectRow])     // subjects
        .mockResolvedValueOnce([atRiskRow])      // atRisk
        .mockResolvedValueOnce([]);              // announcements

      const graph = await svc.buildTeacherGraph('FAC001');
      expect(graph.role).toBe('TEACHER');
      expect(graph.name).toBe('Dr. Kumar');
      expect(graph.todaySchedule).toHaveLength(1);
      expect(graph.todaySchedule[0].subject).toBe('DBMS');
      expect(graph.subjects[0].sections).toEqual(['A', 'B']);
      expect(graph.atRiskStudents).toHaveLength(1);
      expect(graph.atRiskStudents[0].riskLevel).toBe('HIGH');
    });

    it('returns empty teacher graph when teacher not found', async () => {
      mockQuery
        .mockResolvedValueOnce([])  // no teacher
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const graph = await svc.buildTeacherGraph('FAC999');
      expect(graph.name).toBe('Unknown');
      expect(graph.todaySchedule).toHaveLength(0);
    });

    it('returns empty teacher graph when db is null', async () => {
      const svcNoDb = new KnowledgeGraphService(null);
      const graph = await svcNoDb.buildTeacherGraph('FAC001');
      expect(graph.role).toBe('TEACHER');
      expect(graph.subjects).toHaveLength(0);
    });

    it('computes totalStudents from subjects', async () => {
      mockQuery
        .mockResolvedValueOnce([teacherRow])
        .mockResolvedValueOnce([])               // todaySlots
        .mockResolvedValueOnce([])               // weekSlots
        .mockResolvedValueOnce([
          { subject_name: 'DBMS', sections: 'A', total_students: 30, avg_att: 78 },
          { subject_name: 'OS', sections: 'B', total_students: 32, avg_att: 75 },
        ])
        .mockResolvedValueOnce([])               // atRisk
        .mockResolvedValueOnce([]);              // announcements

      const graph = await svc.buildTeacherGraph('FAC001');
      expect(graph.totalStudents).toBe(62);
    });

    // -------------------------------------------------------------------------
    // Branch coverage: lines 272-288 — null room, null sections, zero avg_att
    // -------------------------------------------------------------------------
    it('falls back to TBD when teacher slot has no room_number (line 272)', async () => {
      const slotNoRoom = { ...teacherSlot, room_number: null };
      mockQuery
        .mockResolvedValueOnce([teacherRow])
        .mockResolvedValueOnce([slotNoRoom])     // todaySlots
        .mockResolvedValueOnce([])               // weekSlots
        .mockResolvedValueOnce([subjectRow])     // subjects
        .mockResolvedValueOnce([])               // atRisk
        .mockResolvedValueOnce([]);              // announcements

      const graph = await svc.buildTeacherGraph('FAC001');
      expect(graph.todaySchedule[0].room).toBe('TBD');
    });

    it('handles null sections string gracefully (line 277 — String(null|undefined))', async () => {
      // sections field is null — String(null || '') → '' → split → filter → []
      const subjectNullSections = { subject_name: 'DBMS', sections: null, total_students: 40, avg_att: 72 };
      mockQuery
        .mockResolvedValueOnce([teacherRow])
        .mockResolvedValueOnce([])               // todaySlots
        .mockResolvedValueOnce([])               // weekSlots
        .mockResolvedValueOnce([subjectNullSections])
        .mockResolvedValueOnce([])               // atRisk
        .mockResolvedValueOnce([]);              // announcements

      const graph = await svc.buildTeacherGraph('FAC001');
      expect(graph.subjects[0].sections).toEqual([]);
    });

    it('falls back to zero avgAttendance when avg_att is falsy (line 279)', async () => {
      // avg_att = 0 — +0 || 0 stays 0; also covers the || 0 branch
      const subjectZeroAtt = { subject_name: 'DBMS', sections: 'A', total_students: 30, avg_att: 0 };
      mockQuery
        .mockResolvedValueOnce([teacherRow])
        .mockResolvedValueOnce([])               // todaySlots
        .mockResolvedValueOnce([])               // weekSlots
        .mockResolvedValueOnce([subjectZeroAtt])
        .mockResolvedValueOnce([])               // atRisk
        .mockResolvedValueOnce([]);              // announcements

      const graph = await svc.buildTeacherGraph('FAC001');
      expect(graph.subjects[0].avgAttendance).toBe(0);
    });

    // Branch coverage: line 288 — `+s.total_students || 0` in totalStudents reduce
    // When total_students is null/undefined the +null is 0, then || 0 fires
    it('counts null total_students as 0 in totalStudents reduce (line 288 || 0 branch)', async () => {
      const subjectNullStudents = {
        subject_name: 'DBMS', sections: 'A', total_students: null, avg_att: 75,
      };
      mockQuery
        .mockResolvedValueOnce([teacherRow])
        .mockResolvedValueOnce([])               // todaySlots
        .mockResolvedValueOnce([])               // weekSlots
        .mockResolvedValueOnce([subjectNullStudents])
        .mockResolvedValueOnce([])               // atRisk
        .mockResolvedValueOnce([]);              // announcements

      const graph = await svc.buildTeacherGraph('FAC001');
      // null total_students → +null = 0, 0 || 0 = 0 → totalStudents = 0
      expect(graph.totalStudents).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Branch coverage: buildStudentGraph — lines 134, 152-163
  // ---------------------------------------------------------------------------
  describe('buildStudentGraph() — null/falsy branch paths', () => {
    it('falls back to 0 percentage when pct is null (line 134: +null || 0)', async () => {
      // pct = null represents a subject with zero classes — no valid percentage
      const attNullPct = { subject_name: 'Maths', present: 0, total: 0, pct: null, needed: 0 };
      mockQuery
        .mockResolvedValueOnce([studentRow])    // 1. students
        .mockResolvedValueOnce([])              // 2. todaySlots
        .mockResolvedValueOnce([])              // 3. weekSlots
        .mockResolvedValueOnce([attNullPct])    // 4. attendance
        .mockResolvedValueOnce([])              // 5. marks
        .mockResolvedValueOnce([])              // 6. fees
        .mockResolvedValueOnce([])              // 7. feeItems
        .mockResolvedValueOnce([])              // 8. risk
        .mockResolvedValueOnce([{ cnt: 0 }])    // 9. absences
        .mockResolvedValueOnce([])              // 10. announcements
        .mockResolvedValueOnce([])              // 11. placements
        .mockResolvedValueOnce([])              // 12. vtuWindows
        .mockResolvedValueOnce([])              // 13. vtuElig
        .mockResolvedValueOnce([])             // 14. vtuReg
        .mockResolvedValueOnce([]);             // 15. topicMastery (lms_topic_mastery)

      const graph = await svc.buildStudentGraph('1RV21CS001');
      expect(graph.attendanceSummary[0].percentage).toBe(0);
    });

    it('falls back to TBD when timetable slot has no room_number (line 152)', async () => {
      const slotNoRoom = { ...slotRow, room_number: null };
      mockQuery
        .mockResolvedValueOnce([studentRow])    // 1. students
        .mockResolvedValueOnce([slotNoRoom])    // 2. todaySlots
        .mockResolvedValueOnce([])              // 3. weekSlots
        .mockResolvedValueOnce([attRow])        // 4. attendance
        .mockResolvedValueOnce([marksRow])      // 5. marks
        .mockResolvedValueOnce([feeRow])        // 6. fees
        .mockResolvedValueOnce([])              // 7. feeItems
        .mockResolvedValueOnce([riskRow])       // 8. risk
        .mockResolvedValueOnce([absenceRow])    // 9. absences
        .mockResolvedValueOnce([])              // 10. announcements
        .mockResolvedValueOnce([])              // 11. placements
        .mockResolvedValueOnce([])              // 12. vtuWindows
        .mockResolvedValueOnce([])              // 13. vtuElig
        .mockResolvedValueOnce([])             // 14. vtuReg
        .mockResolvedValueOnce([]);             // 15. topicMastery (lms_topic_mastery)

      const graph = await svc.buildStudentGraph('1RV21CS001');
      expect(graph.todaySchedule[0].room).toBe('TBD');
    });

    it('maps isLab to true when is_lab is truthy (line 154)', async () => {
      const labSlot = { ...slotRow, is_lab: true };
      mockQuery
        .mockResolvedValueOnce([studentRow])    // 1. students
        .mockResolvedValueOnce([labSlot])       // 2. todaySlots
        .mockResolvedValueOnce([])              // 3. weekSlots
        .mockResolvedValueOnce([attRow])        // 4. attendance
        .mockResolvedValueOnce([marksRow])      // 5. marks
        .mockResolvedValueOnce([feeRow])        // 6. fees
        .mockResolvedValueOnce([])              // 7. feeItems
        .mockResolvedValueOnce([riskRow])       // 8. risk
        .mockResolvedValueOnce([absenceRow])    // 9. absences
        .mockResolvedValueOnce([])              // 10. announcements
        .mockResolvedValueOnce([])              // 11. placements
        .mockResolvedValueOnce([])              // 12. vtuWindows
        .mockResolvedValueOnce([])              // 13. vtuElig
        .mockResolvedValueOnce([])             // 14. vtuReg
        .mockResolvedValueOnce([]);             // 15. topicMastery (lms_topic_mastery)

      const graph = await svc.buildStudentGraph('1RV21CS001');
      expect(graph.todaySchedule[0].isLab).toBe(true);
    });

    it('maps ia1 and ia2 to null when marks fields are null (lines 161-162)', async () => {
      // VTU edge case: student has not yet appeared for IA1/IA2
      const marksNullIa = { subject_name: 'Maths', ia1: null, ia2: null, max_marks: 20 };
      mockQuery
        .mockResolvedValueOnce([studentRow])    // 1. students
        .mockResolvedValueOnce([])              // 2. todaySlots
        .mockResolvedValueOnce([])              // 3. weekSlots
        .mockResolvedValueOnce([attRow])        // 4. attendance
        .mockResolvedValueOnce([marksNullIa])   // 5. marks
        .mockResolvedValueOnce([feeRow])        // 6. fees
        .mockResolvedValueOnce([])              // 7. feeItems
        .mockResolvedValueOnce([riskRow])       // 8. risk
        .mockResolvedValueOnce([absenceRow])    // 9. absences
        .mockResolvedValueOnce([])              // 10. announcements
        .mockResolvedValueOnce([])              // 11. placements
        .mockResolvedValueOnce([])              // 12. vtuWindows
        .mockResolvedValueOnce([])              // 13. vtuElig
        .mockResolvedValueOnce([])             // 14. vtuReg
        .mockResolvedValueOnce([]);             // 15. topicMastery (lms_topic_mastery)

      const graph = await svc.buildStudentGraph('1RV21CS001');
      expect(graph.marksSummary[0].ia1).toBeNull();
      expect(graph.marksSummary[0].ia2).toBeNull();
    });

    it('falls back to maxMarks 20 when max_marks is null (line 163)', async () => {
      // Edge case: marks row present but max_marks column is NULL in DB
      const marksNullMax = { subject_name: 'Maths', ia1: 15, ia2: 16, max_marks: null };
      mockQuery
        .mockResolvedValueOnce([studentRow])    // 1. students
        .mockResolvedValueOnce([])              // 2. todaySlots
        .mockResolvedValueOnce([])              // 3. weekSlots
        .mockResolvedValueOnce([attRow])        // 4. attendance
        .mockResolvedValueOnce([marksNullMax])  // 5. marks
        .mockResolvedValueOnce([feeRow])        // 6. fees
        .mockResolvedValueOnce([])              // 7. feeItems
        .mockResolvedValueOnce([riskRow])       // 8. risk
        .mockResolvedValueOnce([absenceRow])    // 9. absences
        .mockResolvedValueOnce([])              // 10. announcements
        .mockResolvedValueOnce([])              // 11. placements
        .mockResolvedValueOnce([])              // 12. vtuWindows
        .mockResolvedValueOnce([])              // 13. vtuElig
        .mockResolvedValueOnce([])             // 14. vtuReg
        .mockResolvedValueOnce([]);             // 15. topicMastery (lms_topic_mastery)

      const graph = await svc.buildStudentGraph('1RV21CS001');
      expect(graph.marksSummary[0].maxMarks).toBe(20);
    });

    it('computes overallAttendancePct as 0 when attendanceSummary is empty (line 139 false branch)', async () => {
      // No attendance rows → ternary takes the : 0 branch
      mockQuery
        .mockResolvedValueOnce([studentRow])    // 1. students
        .mockResolvedValueOnce([])              // 2. todaySlots
        .mockResolvedValueOnce([])              // 3. weekSlots
        .mockResolvedValueOnce([])              // 4. attendance — empty
        .mockResolvedValueOnce([])              // 5. marks
        .mockResolvedValueOnce([])              // 6. fees
        .mockResolvedValueOnce([])              // 7. feeItems
        .mockResolvedValueOnce([])              // 8. risk
        .mockResolvedValueOnce([{ cnt: 0 }])    // 9. absences
        .mockResolvedValueOnce([])              // 10. announcements
        .mockResolvedValueOnce([])              // 11. placements
        .mockResolvedValueOnce([])              // 12. vtuWindows
        .mockResolvedValueOnce([])              // 13. vtuElig
        .mockResolvedValueOnce([])             // 14. vtuReg
        .mockResolvedValueOnce([]);             // 15. topicMastery (lms_topic_mastery)

      const graph = await svc.buildStudentGraph('1RV21CS001');
      // Empty attendance falls back to DEMO_ATTENDANCE → overall pct computed from demo rows.
      expect(typeof graph.overallAttendancePct).toBe('number');
      expect(graph.overallAttendancePct).toBeGreaterThan(0);
    });

    it('reports zero riskScore and LOW riskLevel when risk row absent (lines 173-174)', async () => {
      mockQuery
        .mockResolvedValueOnce([studentRow])    // 1. students
        .mockResolvedValueOnce([])              // 2. todaySlots
        .mockResolvedValueOnce([])              // 3. weekSlots
        .mockResolvedValueOnce([attRow])        // 4. attendance
        .mockResolvedValueOnce([marksRow])      // 5. marks
        .mockResolvedValueOnce([feeRow])        // 6. fees
        .mockResolvedValueOnce([])              // 7. feeItems
        .mockResolvedValueOnce([])              // 8. risk — no risk row
        .mockResolvedValueOnce([{ cnt: 0 }])    // 9. absences
        .mockResolvedValueOnce([])              // 10. announcements
        .mockResolvedValueOnce([])              // 11. placements
        .mockResolvedValueOnce([])              // 12. vtuWindows
        .mockResolvedValueOnce([])              // 13. vtuElig
        .mockResolvedValueOnce([])             // 14. vtuReg
        .mockResolvedValueOnce([]);             // 15. topicMastery (lms_topic_mastery)

      const graph = await svc.buildStudentGraph('1RV21CS001');
      // When risk row is absent, production now defaults to 0.18 / LOW.
      expect(graph.riskScore).toBe(0.18);
      expect(graph.riskLevel).toBe('LOW');
    });

    it('falls back to 0 for recentAbsenceCount when absence row has no cnt (line 174)', async () => {
      mockQuery
        .mockResolvedValueOnce([studentRow])    // 1. students
        .mockResolvedValueOnce([])              // 2. todaySlots
        .mockResolvedValueOnce([])              // 3. weekSlots
        .mockResolvedValueOnce([attRow])        // 4. attendance
        .mockResolvedValueOnce([marksRow])      // 5. marks
        .mockResolvedValueOnce([feeRow])        // 6. fees
        .mockResolvedValueOnce([])              // 7. feeItems
        .mockResolvedValueOnce([riskRow])       // 8. risk
        .mockResolvedValueOnce([{}])            // 9. absences — row exists but cnt undefined
        .mockResolvedValueOnce([])              // 10. announcements
        .mockResolvedValueOnce([])              // 11. placements
        .mockResolvedValueOnce([])              // 12. vtuWindows
        .mockResolvedValueOnce([])              // 13. vtuElig
        .mockResolvedValueOnce([])             // 14. vtuReg
        .mockResolvedValueOnce([]);             // 15. topicMastery (lms_topic_mastery)

      const graph = await svc.buildStudentGraph('1RV21CS001');
      expect(graph.recentAbsenceCount).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // .catch(() => []) arrow bodies on every Promise.all query — must fire when
  // an individual query rejects. Each rejection covers one of the lines in
  // the 192-282 range (student) and 440-495 (teacher) and 594-684 (admin).
  // ---------------------------------------------------------------------------
  describe('buildStudentGraph() — per-query .catch fallbacks (lines 192-282)', () => {
    it('every query rejects → falls back to demo profile + demo data without throwing', async () => {
      // All 14 queries reject → each .catch(() => []) body executes.
      mockQuery.mockRejectedValue(new Error('db down'));

      const graph = await svc.buildStudentGraph('1RV21CS001');

      // Production synthesizes a Demo Student profile when student row is empty.
      expect(graph.name).toBe('Demo Student');
      // Demo fallbacks kick in for empty arrays.
      expect(graph.todaySchedule.length).toBeGreaterThan(0);
      expect(graph.attendanceSummary.length).toBeGreaterThan(0);
      expect(graph.feeStatus.totalFee).toBeGreaterThan(0);
      expect(graph.upcomingPlacements.length).toBeGreaterThan(0);
      expect(graph.announcements.length).toBeGreaterThan(0);
    });

    it('per-query rejection: only the timetable + attendance queries fail (mixed shape)', async () => {
      mockQuery
        .mockResolvedValueOnce([studentRow])               // 1. students OK
        .mockRejectedValueOnce(new Error('slots fail'))    // 2. todaySlots reject
        .mockRejectedValueOnce(new Error('week fail'))     // 3. weekSlots reject
        .mockRejectedValueOnce(new Error('att fail'))      // 4. attendance reject
        .mockResolvedValueOnce([marksRow])                  // 5. marks
        .mockResolvedValueOnce([feeRow])                    // 6. fees
        .mockResolvedValueOnce([])                          // 7. feeItems
        .mockResolvedValueOnce([riskRow])                   // 8. risk
        .mockResolvedValueOnce([{ cnt: 2 }])                // 9. absences
        .mockResolvedValueOnce([])                          // 10. announcements
        .mockResolvedValueOnce([])                          // 11. placements
        .mockResolvedValueOnce([])                          // 12. vtuWindows
        .mockResolvedValueOnce([])                          // 13. vtuElig
        .mockResolvedValueOnce([])                         // 14. vtuReg
        .mockResolvedValueOnce([]);             // 15. topicMastery (lms_topic_mastery)

      const graph = await svc.buildStudentGraph('1RV21CS001');
      expect(graph.name).toBe('Alice');
      expect(graph.marksSummary[0].subject).toBe('DBMS');
      // Empty attendance array → DEMO_ATTENDANCE substituted.
      expect(graph.attendanceSummary.length).toBeGreaterThan(0);
    });
  });

  describe('buildStudentGraph() — VTU window + eligibility + registrations + announcements + placements branches', () => {
    it('returns vtuWindow, vtuEligibility (with registered subjects), live announcements + placements', async () => {
      const vtuWin = { title: 'Sem 5 Reg', semester: 5, open_date: '2026-04-01', close_date: '2026-04-15', is_active: true };
      const eligRow = { eligible_subjects: ['18CS51', '18CS52'], is_eligible: true, category: 'REGULAR', window_title: 'Sem 5 Reg', open_date: '2026-04-01', close_date: '2026-04-15' };
      const regRow = { subject_codes: ['18CS51'] };
      const placeRow = { company: 'Goog', status: 'OPEN', scheduled_date: '2026-06-01', min_cgpa: 8.0, rounds: ['A','B'], venue: 'Online', eligible_depts: ['CSE'] };
      const annRow = { title: 'Holiday', content: 'Friday off' };
      const feeItemRow = { component: 'Tuition', amount: 50000, status: 'PAID', due_date: null };

      mockQuery
        .mockResolvedValueOnce([studentRow])
        .mockResolvedValueOnce([])              // todaySlots
        .mockResolvedValueOnce([])              // weekSlots
        .mockResolvedValueOnce([attRow])        // attendance
        .mockResolvedValueOnce([marksRow])      // marks
        .mockResolvedValueOnce([feeRow])        // fees
        .mockResolvedValueOnce([feeItemRow])    // feeItems live
        .mockResolvedValueOnce([riskRow])       // risk
        .mockResolvedValueOnce([{ cnt: 0 }])    // absences
        .mockResolvedValueOnce([annRow])        // announcements live
        .mockResolvedValueOnce([placeRow])      // placements live
        .mockResolvedValueOnce([vtuWin])        // vtuWindows live
        .mockResolvedValueOnce([eligRow])       // vtuElig live
        .mockResolvedValueOnce([regRow]);       // vtuReg live

      const graph = await svc.buildStudentGraph('1RV21CS001');

      expect(graph.vtuWindow).not.toBeNull();
      expect(graph.vtuWindow!.title).toBe('Sem 5 Reg');
      expect(graph.vtuWindow!.isActive).toBe(true);
      expect(graph.vtuEligibility).not.toBeNull();
      expect(graph.vtuEligibility!.windowTitle).toBe('Sem 5 Reg');
      expect(graph.vtuEligibility!.eligibleSubjects).toEqual(['18CS51', '18CS52']);
      expect(graph.vtuEligibility!.registeredSubjects).toEqual(['18CS51']);
      expect(graph.upcomingPlacements[0].company).toBe('Goog');
      expect(graph.upcomingPlacements[0].rounds).toEqual(['A', 'B']);
      expect(graph.upcomingPlacements[0].eligibleDepts).toEqual(['CSE']);
      expect(graph.announcements[0].title).toBe('Holiday');
      expect(graph.feeBreakdown[0].component).toBe('Tuition');
    });

    it('vtuEligibility: when eligibility row present but registration missing, registeredSubjects is empty', async () => {
      const eligRow = { eligible_subjects: null, is_eligible: false, category: 'BACKLOG', window_title: 'Sem 5', open_date: '2026-04-01', close_date: '2026-04-15' };
      mockQuery
        .mockResolvedValueOnce([studentRow])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([attRow])
        .mockResolvedValueOnce([marksRow])
        .mockResolvedValueOnce([feeRow])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([riskRow])
        .mockResolvedValueOnce([{ cnt: 0 }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([eligRow])
        .mockResolvedValueOnce([]);            // no registration

      const graph = await svc.buildStudentGraph('1RV21CS001');
      expect(graph.vtuEligibility!.eligibleSubjects).toEqual([]);
      expect(graph.vtuEligibility!.registeredSubjects).toEqual([]);
      expect(graph.vtuEligibility!.isEligible).toBe(false);
    });

    it('placements: rounds and eligibleDepts default to empty arrays when DB returns null', async () => {
      const placeRow = { company: 'NullDeptCo', status: 'OPEN', scheduled_date: '2026-06-01', min_cgpa: 7.0, rounds: null, venue: 'Campus', eligible_depts: null };
      mockQuery
        .mockResolvedValueOnce([studentRow])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([attRow])
        .mockResolvedValueOnce([marksRow])
        .mockResolvedValueOnce([feeRow])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([riskRow])
        .mockResolvedValueOnce([{ cnt: 0 }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([placeRow])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const graph = await svc.buildStudentGraph('1RV21CS001');
      expect(graph.upcomingPlacements[0].rounds).toEqual([]);
      expect(graph.upcomingPlacements[0].eligibleDepts).toEqual([]);
    });

    it('weekSchedule: builds keyed map across multiple days (lines 306-308 truthy + falsy branches)', async () => {
      const monSlot = { ...slotRow, day: 'MON' };
      const monSlot2 = { slot_index: 1, subject_name: 'OS', faculty_name: 'Dr. Rao', room_number: 'LH-102', is_lab: false, day: 'MON' };
      const tueSlot = { slot_index: 0, subject_name: 'CN', faculty_name: 'Dr. Nair', room_number: 'LH-103', is_lab: false, day: 'TUE' };
      mockQuery
        .mockResolvedValueOnce([studentRow])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([monSlot, monSlot2, tueSlot])  // weekSlots covers both branches
        .mockResolvedValueOnce([attRow])
        .mockResolvedValueOnce([marksRow])
        .mockResolvedValueOnce([feeRow])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([riskRow])
        .mockResolvedValueOnce([{ cnt: 0 }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const graph = await svc.buildStudentGraph('1RV21CS001');
      expect(Object.keys(graph.weekSchedule)).toEqual(expect.arrayContaining(['MON', 'TUE']));
      expect(graph.weekSchedule.MON).toHaveLength(2);
      expect(graph.weekSchedule.TUE).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // buildParentGraph: lines 409, 414, 421 — language-from-DB, parent
  // announcements query, and the announcement mapper.
  // ---------------------------------------------------------------------------
  describe('buildParentGraph() — language detection + parent announcements', () => {
    it('uses parent preferred_language from DB and returns parent-targeted announcements', async () => {
      const parentAnn = { title: 'PTM Notice', content: 'PTM on Saturday 10AM' };
      mockQuery
        .mockResolvedValueOnce([{ student_id: '1RV21CS001', lang: 'hi' }])  // parent lookup, hindi
        // buildStudentGraph child queries (1-14)
        .mockResolvedValueOnce([studentRow])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([attRow])
        .mockResolvedValueOnce([marksRow])
        .mockResolvedValueOnce([feeRow])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([riskRow])
        .mockResolvedValueOnce([{ cnt: 0 }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        // parent announcements (15)
        .mockResolvedValueOnce([parentAnn]);

      const graph = await svc.buildParentGraph('+919845012345');
      expect(graph.preferredLanguage).toBe('hi');
      expect(graph.announcements[0].title).toBe('PTM Notice');
      // child.role is stripped (set to undefined as any) so it is no longer 'STUDENT'.
      expect((graph.child as any).role).toBeUndefined();
    });

    it('parent announcements query rejection is swallowed (line 414 .catch)', async () => {
      mockQuery
        .mockResolvedValueOnce([{ student_id: '1RV21CS001', lang: 'en' }])
        .mockResolvedValueOnce([studentRow])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([attRow])
        .mockResolvedValueOnce([marksRow])
        .mockResolvedValueOnce([feeRow])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([riskRow])
        .mockResolvedValueOnce([{ cnt: 0 }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockRejectedValueOnce(new Error('ann fail'));     // parent announcements rejects

      const graph = await svc.buildParentGraph('+919845012345');
      expect(graph.announcements).toEqual([]);
    });

    it('parent lookup query rejection: returns [] → throws "Parent not found" (line 409 .catch)', async () => {
      mockQuery.mockRejectedValueOnce(new Error('lookup fail'));
      await expect(svc.buildParentGraph('+9100')).rejects.toThrow('Parent not found');
    });
  });

  // ---------------------------------------------------------------------------
  // buildTeacherGraph extra coverage — every per-query .catch (lines 440-495),
  // the week-schedule branch (511-513), and the announcements mapper (538).
  // ---------------------------------------------------------------------------
  describe('buildTeacherGraph() — per-query .catch + multi-day weekSchedule + announcements', () => {
    it('every teacher query rejects → returns empty teacher graph (no throw)', async () => {
      mockQuery.mockRejectedValue(new Error('db unreachable'));

      const graph = await svc.buildTeacherGraph('FAC001');
      expect(graph.role).toBe('TEACHER');
      expect(graph.name).toBe('Unknown'); // empty fallback
    });

    it('builds multi-day teacher week schedule (covers if-branch on lines 511-513)', async () => {
      const wMon1 = { ...teacherSlot, day: 'MON' };
      const wMon2 = { slot_index: 2, subject_name: 'OS', section: 'B', room_number: 'LH-102', semester: 5, day: 'MON' };
      const wTue = { slot_index: 0, subject_name: 'CN', section: 'A', room_number: 'LH-103', semester: 5, day: 'TUE' };
      mockQuery
        .mockResolvedValueOnce([teacherRow])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([wMon1, wMon2, wTue])    // weekSlots
        .mockResolvedValueOnce([])                       // subjects
        .mockResolvedValueOnce([])                       // atRisk
        .mockResolvedValueOnce([]);                      // announcements

      const graph = await svc.buildTeacherGraph('FAC001');
      expect(Object.keys(graph.weekSchedule)).toEqual(expect.arrayContaining(['MON', 'TUE']));
      expect(graph.weekSchedule.MON).toHaveLength(2);
      expect(graph.weekSchedule.TUE).toHaveLength(1);
    });

    it('teacher announcements mapped to {title,content} (line 538)', async () => {
      const annRow = { title: 'Faculty Meet', content: 'IQAC review on Monday' };
      mockQuery
        .mockResolvedValueOnce([teacherRow])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([annRow]);

      const graph = await svc.buildTeacherGraph('FAC001');
      expect(graph.announcements[0]).toEqual({ title: 'Faculty Meet', content: 'IQAC review on Monday' });
    });
  });

  // ---------------------------------------------------------------------------
  // buildAdminGraph — completely uncovered range 594-684. Tests:
  //  - happy path with live admin row, stats, atRisk, announcements,
  //    placements, alumniStats
  //  - empty/missing-row fallbacks for every defaulted field
  //  - DB-null branch
  //  - per-query .catch fallback (every query rejects)
  // ---------------------------------------------------------------------------
  describe('buildAdminGraph()', () => {
    const adminRow = { name: 'Dr. Principal', lang: 'kn' };
    const statsRow = {
      total_students: 1500, total_faculty: 120, high_risk_count: 87,
      fee_defaulter_count: 45, active_conversations: 23,
    };
    const adminAtRisk = { usn: '1RV21CS003', name: 'Karthik', risk_score: 0.78, risk_level: 'HIGH', primary_concern: 'Fees + attendance' };
    const adminAnn = { title: 'Senate Notice', content: 'Convocation 25 May' };
    const adminPlace = { company: 'Amazon', status: 'OPEN', scheduled_date: '2026-07-01', min_cgpa: 7.5, rounds: ['OA','HR'], venue: 'Online' };
    const alumniRow = { dept: 'CSE', avg_pkg: 18.5, max_pkg: 56.0, total: 230 };

    it('returns empty admin graph when db is null (line 594-596 branch)', async () => {
      const noDb = new KnowledgeGraphService(null);
      const graph = await noDb.buildAdminGraph('ADMIN1');
      expect(graph.role).toBe('ADMIN');
      expect(graph.name).toBe('Administrator');
      expect(graph.empId).toBe('ADMIN1');
      expect(graph.atRiskStudents).toEqual([]);
      expect(graph.alumniStats).toEqual([]);
      expect(graph.todaySchedule.length).toBeGreaterThan(0);
    });

    it('happy path: live admin, stats, atRisk, announcements, placements, alumniStats', async () => {
      mockQuery
        .mockResolvedValueOnce([adminRow])
        .mockResolvedValueOnce([statsRow])
        .mockResolvedValueOnce([adminAtRisk])
        .mockResolvedValueOnce([adminAnn])
        .mockResolvedValueOnce([adminPlace])
        .mockResolvedValueOnce([alumniRow]);

      const graph = await svc.buildAdminGraph('PRINCIPAL01');
      expect(graph.role).toBe('ADMIN');
      expect(graph.name).toBe('Dr. Principal');
      expect(graph.preferredLanguage).toBe('kn');
      expect(graph.stats.totalStudents).toBe(1500);
      expect(graph.stats.totalFaculty).toBe(120);
      expect(graph.stats.highRiskCount).toBe(87);
      expect(graph.stats.feeDefaulterCount).toBe(45);
      expect(graph.stats.activeConversations).toBe(23);
      expect(graph.atRiskStudents).toHaveLength(1);
      expect(graph.atRiskStudents[0].usn).toBe('1RV21CS003');
      expect(graph.atRiskStudents[0].riskScore).toBe(0.78);
      expect(graph.announcements[0].title).toBe('Senate Notice');
      expect(graph.upcomingPlacements[0].company).toBe('Amazon');
      expect(graph.upcomingPlacements[0].rounds).toEqual(['OA', 'HR']);
      expect(graph.alumniStats[0].dept).toBe('CSE');
      expect(graph.alumniStats[0].avgPackageLpa).toBe(18.5);
      expect(graph.alumniStats[0].maxPackageLpa).toBe(56);
      expect(graph.alumniStats[0].totalAlumni).toBe(230);
    });

    it('empty admin row → defaults to "Administrator" / "en" + demo fallbacks for risk/announcements/placements', async () => {
      mockQuery
        .mockResolvedValueOnce([])              // adminRow empty
        .mockResolvedValueOnce([{}])            // stats empty fields
        .mockResolvedValueOnce([])              // atRisk empty
        .mockResolvedValueOnce([])              // announcements empty
        .mockResolvedValueOnce([])              // placements empty
        .mockResolvedValueOnce([]);             // alumni empty

      const graph = await svc.buildAdminGraph('UNKNOWN_ADMIN');
      expect(graph.name).toBe('Administrator');
      expect(graph.preferredLanguage).toBe('en');
      // Empty stats fields default to seeded numbers.
      expect(graph.stats.totalStudents).toBe(450);
      expect(graph.stats.totalFaculty).toBe(35);
      expect(graph.stats.highRiskCount).toBe(47);
      expect(graph.stats.feeDefaulterCount).toBe(23);
      expect(graph.stats.activeConversations).toBe(12);
      // Empty atRisk → fallback to seeded 3 risk students.
      expect(graph.atRiskStudents).toHaveLength(3);
      expect(graph.atRiskStudents[0].usn).toBe('1RV21CS003');
      // Empty announcements & placements → DEMO_ANNOUNCEMENTS + DEMO_PLACEMENTS.
      expect(graph.announcements.length).toBeGreaterThan(0);
      expect(graph.upcomingPlacements.length).toBeGreaterThan(0);
      // Alumni stays empty (no demo fallback for alumni).
      expect(graph.alumniStats).toEqual([]);
    });

    it('admin placement row with null rounds → defaults to []', async () => {
      const placeNoRounds = { company: 'Infy', status: 'OPEN', scheduled_date: '2026-07-15', min_cgpa: 6.5, rounds: null, venue: 'Campus' };
      mockQuery
        .mockResolvedValueOnce([adminRow])
        .mockResolvedValueOnce([statsRow])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([placeNoRounds])
        .mockResolvedValueOnce([]);

      const graph = await svc.buildAdminGraph('PRINCIPAL01');
      expect(graph.upcomingPlacements[0].rounds).toEqual([]);
    });

    it('alumni row with falsy avg_pkg / max_pkg → maps to 0', async () => {
      const alumniNullPkg = { dept: 'EEE', avg_pkg: null, max_pkg: null, total: 80 };
      mockQuery
        .mockResolvedValueOnce([adminRow])
        .mockResolvedValueOnce([statsRow])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([alumniNullPkg]);

      const graph = await svc.buildAdminGraph('PRINCIPAL01');
      expect(graph.alumniStats[0].avgPackageLpa).toBe(0);
      expect(graph.alumniStats[0].maxPackageLpa).toBe(0);
      expect(graph.alumniStats[0].totalAlumni).toBe(80);
    });

    it('every admin query rejects → returns the synthesized fallback (per-query .catch fires)', async () => {
      mockQuery.mockRejectedValue(new Error('db down'));
      const graph = await svc.buildAdminGraph('PRINCIPAL01');
      // Every query falls back; admin row missing → name=Administrator,
      // empty stats → seeded defaults, empty atRisk → seeded fallback.
      expect(graph.name).toBe('Administrator');
      expect(graph.stats.totalStudents).toBe(450);
      expect(graph.atRiskStudents).toHaveLength(3);
    });

    it('recruiter graph: returns realistic demo when recruiter has no jobs (KAN-28)', async () => {
      mockQuery.mockResolvedValue([]); // empty jobs, no applications
      const graph = await svc.buildRecruiterGraph('u-recruiter-01', 'Acme Corp');
      expect(graph.role).toBe('RECRUITER');
      expect(graph.recruiterId).toBe('u-recruiter-01');
      expect(graph.recentJobs.length).toBeGreaterThan(0);
      expect(graph.totalJobsPosted).toBeGreaterThan(0);
      expect(graph.partnerColleges.length).toBeGreaterThan(0);
    });

    it('recruiter graph: maps live job rows + funnel counts when DB returns data', async () => {
      const jobRow = {
        id: 'j-1', title: 'SDE I', ctc_lpa: 12, min_cgpa: 7.5, location: 'Bengaluru',
        status: 'OPEN', posted_at: '2026-05-01', applicant_count: 30, shortlisted_count: 8, offer_count: 1,
      };
      mockQuery
        .mockResolvedValueOnce([jobRow])              // jobs
        .mockResolvedValueOnce([                        // statusCounts
          { status: 'APPLIED', cnt: 30 },
          { status: 'SHORTLISTED', cnt: 8 },
          { status: 'OFFERED', cnt: 1 },
        ])
        .mockResolvedValueOnce([{ college: 'rvce' }]); // partnerColleges

      const graph = await svc.buildRecruiterGraph('rec-uuid');
      expect(graph.recentJobs).toHaveLength(1);
      expect(graph.recentJobs[0].title).toBe('SDE I');
      expect(graph.totalApplicants).toBe(39); // sum of all status counts
      expect(graph.totalShortlisted).toBe(8);
      expect(graph.totalOffersMade).toBe(1);
      expect(graph.partnerColleges).toEqual(['rvce']);
    });

    it('recruiter graph: returns empty graph when db is null', async () => {
      const noDb = new KnowledgeGraphService(null);
      const graph = await noDb.buildRecruiterGraph('rec-uuid', 'Recruiter Bob');
      expect(graph.role).toBe('RECRUITER');
      expect(graph.recentJobs.length).toBeGreaterThan(0);
    });

    it('admin timeout fallback returns the empty admin graph', async () => {
      jest.useFakeTimers();
      try {
        mockQuery.mockReturnValue(new Promise(() => {})); // never resolves
        const p = svc.buildAdminGraph('PRINCIPAL01');
        jest.advanceTimersByTime(12001);
        const graph = await p;
        expect(graph.role).toBe('ADMIN');
        expect(graph.name).toBe('Administrator');
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
