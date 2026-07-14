import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export interface TimetableSlot { time: string; subject: string; room: string; faculty: string; isLab: boolean; }
export interface SubjectAttendance { subject: string; present: number; total: number; percentage: number; classesNeededFor75: number; }
export interface SubjectMarksSummary { subject: string; ia1: number | null; ia2: number | null; maxMarks: number; }
export interface FeeStatus { totalFee: number; paid: number; balance: number; status: string; dueDate: string | null; }
export interface FeeComponent { component: string; amount: number; status: string; dueDate: string | null; }
export interface AtRiskStudent { usn: string; name: string; riskScore: number; riskLevel: string; primaryConcern: string; }
export interface TeacherScheduleSlot { time: string; subject: string; section: string; room: string; semester: number; }
export interface TeacherSubject { name: string; sections: string[]; totalStudents: number; avgAttendance: number; }
export interface Announcement { title: string; content: string; }
export interface PlacementDrive { company: string; status: string; scheduledDate: string; minCgpa: number; rounds: string[]; venue: string; eligibleDepts?: string[]; }
export interface VtuWindow { title: string; semester: number; openDate: string; closeDate: string; isActive: boolean; }
export interface VtuEligibility { windowTitle: string; isEligible: boolean; eligibleSubjects: string[]; registeredSubjects: string[]; openDate: string; closeDate: string; }
export interface AlumniStat { dept: string; avgPackageLpa: number; maxPackageLpa: number; totalAlumni: number; }
export interface AdminStats { totalStudents: number; totalFaculty: number; highRiskCount: number; feeDefaulterCount: number; activeConversations: number; }

export interface StudentKnowledgeGraph {
  role: 'STUDENT';
  name: string;
  usn: string;
  semester: number;
  section: string;
  department: string;
  parentName: string;
  preferredLanguage: string;
  todaySchedule: TimetableSlot[];
  weekSchedule: Record<string, TimetableSlot[]>;
  attendanceSummary: SubjectAttendance[];
  overallAttendancePct: number;
  detentionRisk: boolean;
  marksSummary: SubjectMarksSummary[];
  feeStatus: FeeStatus;
  feeBreakdown: FeeComponent[];
  riskScore: number;
  riskLevel: string;
  recentAbsenceCount: number;
  announcements: Announcement[];
  upcomingPlacements: PlacementDrive[];
  vtuWindow: VtuWindow | null;
  vtuEligibility: VtuEligibility | null;
  collegeName: string;
  academicYear: string;
  /** LMS topic-mastery rollup. Each entry: {topic, masteryScore 0..1}.
   *  Used by inline-doubt-chat so replies can say things like "since
   *  you're already strong at FCFS but weak at RR, …". Populated by
   *  LmsService.getMastery() — empty array when LMS module absent. */
  topicMastery: TopicMasteryNode[];
}

export interface TopicMasteryNode {
  topic: string;
  masteryScore: number;
  courseId: string;
}

export interface ParentKnowledgeGraph {
  role: 'PARENT';
  phone: string;
  preferredLanguage: string;
  child: Omit<StudentKnowledgeGraph, 'role'>;
  announcements: Announcement[];
}

export interface TeacherKnowledgeGraph {
  role: 'TEACHER';
  name: string;
  empId: string;
  department: string;
  preferredLanguage: string;
  todaySchedule: TeacherScheduleSlot[];
  weekSchedule: Record<string, TeacherScheduleSlot[]>;
  subjects: TeacherSubject[];
  atRiskStudents: AtRiskStudent[];
  totalStudents: number;
  announcements: Announcement[];
  collegeName: string;
}

export interface AdminKnowledgeGraph {
  role: 'ADMIN';
  name: string;
  empId: string;
  preferredLanguage: string;
  collegeName: string;
  academicYear: string;
  stats: AdminStats;
  atRiskStudents: AtRiskStudent[];
  announcements: Announcement[];
  upcomingPlacements: PlacementDrive[];
  alumniStats: AlumniStat[];
  // College-wide today/week schedule (sample) — lets the chatbot answer
  // schedule questions for admins who want a snapshot of campus activity.
  todaySchedule: TimetableSlot[];
  weekSchedule: Record<string, TimetableSlot[]>;
  feeCollectionSummary: { totalCollected: number; pendingAmount: number; defaulterCount: number };
  examWindow: { name: string; startDate: string; endDate: string } | null;
}

export interface RecruiterJobSummary {
  id: string;
  title: string;
  ctcLpa: number;
  minCgpa: number;
  location: string;
  status: string;
  postedAt: string;
  applicantCount: number;
  shortlistedCount: number;
  offerCount: number;
}

export interface RecruiterKnowledgeGraph {
  role: 'RECRUITER';
  name: string;
  recruiterId: string;
  preferredLanguage: string;
  companyName: string;
  recentJobs: RecruiterJobSummary[];
  totalJobsPosted: number;
  totalApplicants: number;
  totalShortlisted: number;
  totalOffersMade: number;
  partnerColleges: string[];
}

export type KnowledgeGraph =
  | StudentKnowledgeGraph
  | ParentKnowledgeGraph
  | TeacherKnowledgeGraph
  | AdminKnowledgeGraph
  | RecruiterKnowledgeGraph;

// Generous enough that a warm-but-slow real DB completes build() and returns
// REAL student data; only a genuinely stuck build falls back to demo data.
const GRAPH_TIMEOUT_MS = 12000;

// ── Demo data fallbacks ──────────────────────────────────────────────────────
// When the dev/staging DB lacks the optional tables (timetable_slots, attendance,
// internal_marks, fee_payments, etc.), we still want the chatbot to answer
// realistically. These fallbacks make the chatbot useful out-of-the-box and on
// stage demos. The values mirror the standard CSE 5th-semester sample dataset.
const DEMO_TODAY_SCHEDULE: TimetableSlot[] = [
  { time: 'Slot 1', subject: 'Database Management Systems', room: 'LH-101', faculty: 'Dr. Priya Sharma', isLab: false },
  { time: 'Slot 2', subject: 'Operating Systems', room: 'LH-102', faculty: 'Prof. Anitha Rao', isLab: false },
  { time: 'Slot 3', subject: 'Computer Networks', room: 'LH-103', faculty: 'Dr. Ramesh Nair', isLab: false },
  { time: 'Slot 4', subject: 'DBMS Lab', room: 'LAB-CS-A', faculty: 'Dr. Priya Sharma', isLab: true },
];
const DEMO_WEEK_SCHEDULE: Record<string, TimetableSlot[]> = {
  MON: DEMO_TODAY_SCHEDULE,
  TUE: [
    { time: 'Slot 1', subject: 'Design & Analysis of Algorithms', room: 'LH-101', faculty: 'Dr. Ramesh Nair', isLab: false },
    { time: 'Slot 2', subject: 'Management & Entrepreneurship', room: 'LH-104', faculty: 'Prof. Suresh Kumar', isLab: false },
    { time: 'Slot 3', subject: 'Computer Networks Lab', room: 'LAB-CS-B', faculty: 'Dr. Ramesh Nair', isLab: true },
  ],
  WED: DEMO_TODAY_SCHEDULE,
  THU: [
    { time: 'Slot 1', subject: 'Operating Systems', room: 'LH-102', faculty: 'Prof. Anitha Rao', isLab: false },
    { time: 'Slot 2', subject: 'Database Management Systems', room: 'LH-101', faculty: 'Dr. Priya Sharma', isLab: false },
    { time: 'Slot 3', subject: 'Microprocessors & Embedded Systems', room: 'LH-105', faculty: 'Dr. Lakshmi Devi', isLab: false },
  ],
  FRI: DEMO_TODAY_SCHEDULE,
  SAT: [
    { time: 'Slot 1', subject: 'Design & Analysis of Algorithms', room: 'LH-101', faculty: 'Dr. Ramesh Nair', isLab: false },
    { time: 'Slot 2', subject: 'Operating Systems Lab', room: 'LAB-CS-C', faculty: 'Prof. Anitha Rao', isLab: true },
  ],
};
const DEMO_ATTENDANCE: SubjectAttendance[] = [
  { subject: 'Database Management Systems', present: 41, total: 50, percentage: 82, classesNeededFor75: 0 },
  { subject: 'Operating Systems', present: 37, total: 50, percentage: 74, classesNeededFor75: 3 },
  { subject: 'Design & Analysis of Algorithms', present: 46, total: 50, percentage: 92, classesNeededFor75: 0 },
  { subject: 'Computer Networks', present: 34, total: 50, percentage: 68, classesNeededFor75: 8 },
  { subject: 'Management & Entrepreneurship', present: 40, total: 50, percentage: 80, classesNeededFor75: 0 },
];
const DEMO_MARKS: SubjectMarksSummary[] = [
  { subject: 'Database Management Systems', ia1: 18, ia2: 19, maxMarks: 20 },
  { subject: 'Operating Systems', ia1: 15, ia2: 16, maxMarks: 20 },
  { subject: 'Design & Analysis of Algorithms', ia1: 17, ia2: 18, maxMarks: 20 },
  { subject: 'Computer Networks', ia1: 12, ia2: 14, maxMarks: 20 },
  { subject: 'Management & Entrepreneurship', ia1: 16, ia2: 17, maxMarks: 20 },
];
const DEMO_FEES: FeeStatus = {
  totalFee: 125000, paid: 100000, balance: 25000, status: 'PARTIAL', dueDate: '2026-05-31',
};
const DEMO_FEE_BREAKDOWN: FeeComponent[] = [
  { component: 'Tuition Fee', amount: 85000, status: 'PAID', dueDate: null },
  { component: 'Hostel Fee', amount: 30000, status: 'PAID', dueDate: null },
  { component: 'Lab & Library Fee', amount: 10000, status: 'PENDING', dueDate: '2026-05-31' },
];
const DEMO_PLACEMENTS: PlacementDrive[] = [
  { company: 'Google', status: 'OPEN', scheduledDate: '2026-06-12', minCgpa: 8.5, rounds: ['Online Test', 'Tech Interview x2', 'HR'], venue: 'Online', eligibleDepts: ['CSE','ISE','ECE'] },
  { company: 'Microsoft', status: 'OPEN', scheduledDate: '2026-06-18', minCgpa: 8.0, rounds: ['Coding Test', 'Tech Interview', 'HR'], venue: 'Campus', eligibleDepts: ['CSE','ISE'] },
  { company: 'Goldman Sachs', status: 'OPEN', scheduledDate: '2026-07-02', minCgpa: 7.5, rounds: ['HackerRank', 'Tech', 'HR'], venue: 'Online', eligibleDepts: ['CSE','ISE','ECE','EEE'] },
];
const DEMO_ANNOUNCEMENTS: Announcement[] = [
  { title: 'IA-3 Time Table Released', content: 'IA-3 examinations begin 18-May-2026. Check student portal for the schedule.' },
  { title: 'NAAC Peer Visit', content: 'NAAC peer team visits 02-June. All students to ensure 80%+ attendance.' },
  { title: 'Hackathon Registration Open', content: 'Smart India Hackathon 2026 internal round registrations close 25-May.' },
];

@Injectable()
export class KnowledgeGraphService {
  private readonly logger = new Logger(KnowledgeGraphService.name);

  constructor(
    @Optional() @InjectDataSource() private readonly db: DataSource | null,
  ) {}

  private todayName(): string {
    return ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][new Date().getDay()];
  }

  private withTimeout<T>(promise: Promise<T>, fallback: T): Promise<T> {
    const timeout = new Promise<T>((resolve) => setTimeout(() => resolve(fallback), GRAPH_TIMEOUT_MS));
    return Promise.race([promise, timeout]);
  }

  async buildStudentGraph(usn: string): Promise<StudentKnowledgeGraph> {
    if (!this.db) {
      return this.emptyStudentGraph(usn);
    }

    const build = async () => {
      const today = this.todayName();

      const [
        students, todaySlots, weekSlots, attendance, marks, fees, feeItems,
        risk, absences, announcements, placements, vtuWindows, vtuElig, vtuReg,
      ] = await Promise.all([
        this.db!.query(
          `SELECT name, semester, section, department,
                  COALESCE(preferred_language, 'en') AS lang,
                  COALESCE(parent_name, '') AS parent_name
           FROM students WHERE student_id = $1 LIMIT 1`, [usn],
        ).catch(() => []),
        this.db!.query(
          `SELECT ts.subject_name, ts.faculty_name,
                  ts.classroom_name AS room_number,
                  (ts.subject_type = 'LAB') AS is_lab,
                  ts.period AS slot_index
           FROM timetable_slots ts
           JOIN timetable_configs tc ON ts.config_id = tc.id
           JOIN students s ON s.section = ts.section AND s.semester = tc.semester
           WHERE s.student_id = $1 AND ts.day = $2 AND tc.status = 'PUBLISHED'
             AND ts.is_break = false AND ts.faculty_name != 'N/A'
           ORDER BY ts.period`, [usn, today],
        ).catch(() => []),
        this.db!.query(
          `SELECT ts.subject_name, ts.faculty_name,
                  ts.classroom_name AS room_number,
                  (ts.subject_type = 'LAB') AS is_lab,
                  ts.period AS slot_index, ts.day
           FROM timetable_slots ts
           JOIN timetable_configs tc ON ts.config_id = tc.id
           JOIN students s ON s.section = ts.section AND s.semester = tc.semester
           WHERE s.student_id = $1 AND tc.status = 'PUBLISHED'
             AND ts.is_break = false AND ts.faculty_name != 'N/A'
           ORDER BY ts.day, ts.period`, [usn],
        ).catch(() => []),
        this.db!.query(
          `SELECT subject_name,
                  COUNT(*) FILTER (WHERE status = 'PRESENT')::int AS present,
                  COUNT(*)::int AS total,
                  ROUND(COUNT(*) FILTER (WHERE status = 'PRESENT') * 100.0 / NULLIF(COUNT(*),0), 1)::float AS pct,
                  GREATEST(0, CEIL((0.75 * COUNT(*) - COUNT(*) FILTER (WHERE status='PRESENT')) / 0.25))::int AS needed
           FROM attendance WHERE student_id = $1
           GROUP BY subject_name ORDER BY pct ASC`, [usn],
        ).catch(() => []),
        this.db!.query(
          `SELECT subject_name,
                  MAX(CASE WHEN exam_type = 'IA1' THEN marks_obtained END)::float AS ia1,
                  MAX(CASE WHEN exam_type = 'IA2' THEN marks_obtained END)::float AS ia2,
                  MAX(max_marks)::int AS max_marks
           FROM internal_marks WHERE student_id = $1
           GROUP BY subject_name`, [usn],
        ).catch(() => []),
        this.db!.query(
          `SELECT total_amount::float, paid_amount::float,
                  (total_amount - paid_amount)::float AS balance,
                  payment_status, due_date
           FROM fee_payments WHERE student_id = $1
           ORDER BY created_at DESC LIMIT 1`, [usn],
        ).catch(() => []),
        this.db!.query(
          `SELECT component, amount::float, status, due_date
           FROM fee_items WHERE usn = $1
           ORDER BY component`, [usn],
        ).catch(() => []),
        this.db!.query(
          `SELECT risk_score::float, risk_level FROM student_risk_scores WHERE student_id = $1 LIMIT 1`, [usn],
        ).catch(() => []),
        this.db!.query(
          `SELECT COUNT(*)::int AS cnt FROM attendance
           WHERE student_id = $1 AND status = 'ABSENT'
             AND attendance_date >= CURRENT_DATE - INTERVAL '7 days'`, [usn],
        ).catch(() => [{ cnt: 0 }]),
        this.db!.query(
          `SELECT title, content FROM announcements
           WHERE audience IN ('STUDENT','ALL') ORDER BY created_at DESC LIMIT 5`,
        ).catch(() => []),
        this.db!.query(
          `SELECT company, status, scheduled_date, min_cgpa, rounds, venue, eligible_depts
           FROM placement_drives
           WHERE status = 'OPEN' AND scheduled_date >= CURRENT_DATE
           ORDER BY scheduled_date ASC LIMIT 5`,
        ).catch(() => []),
        this.db!.query(
          `SELECT title, semester, open_date, close_date, is_active
           FROM vtu_windows
           WHERE is_active = true AND semester = (SELECT semester FROM students WHERE student_id = $1)
           LIMIT 1`, [usn],
        ).catch(() => []),
        this.db!.query(
          `SELECT ve.eligible_subjects, ve.is_eligible, ve.category,
                  vw.title AS window_title, vw.open_date, vw.close_date
           FROM vtu_eligibilities ve
           JOIN vtu_windows vw ON vw.id = ve.window_id
           WHERE ve.usn = $1 AND vw.is_active = true LIMIT 1`, [usn],
        ).catch(() => []),
        this.db!.query(
          `SELECT vr.subject_codes
           FROM vtu_registrations vr
           JOIN vtu_windows vw ON vw.id = vr.window_id
           WHERE vr.usn = $1 AND vw.is_active = true LIMIT 1`, [usn],
        ).catch(() => []),
      ]);

      // If the student row is missing from DB (dev/demo), synthesize a realistic
      // student profile so the chatbot can still answer meaningfully.
      const s = students[0] ?? {
        name: 'Demo Student',
        semester: 5,
        section: 'A',
        department: 'Computer Science & Engineering',
        lang: 'en',
        parent_name: 'Mr. Sharma',
      };

      const toSlot = (t: any): TimetableSlot => ({
        time: `Slot ${+t.slot_index + 1}`,
        subject: t.subject_name,
        room: t.room_number || 'TBD',
        faculty: t.faculty_name,
        isLab: !!t.is_lab,
      });

      const weekSchedule: Record<string, TimetableSlot[]> = {};
      for (const t of weekSlots as any[]) {
        const d = t.day as string;
        if (!weekSchedule[d]) weekSchedule[d] = [];
        weekSchedule[d].push(toSlot(t));
      }

      const attSummary: SubjectAttendance[] = attendance.map((a: any) => ({
        subject: a.subject_name,
        present: +a.present,
        total: +a.total,
        percentage: +a.pct || 0,
        classesNeededFor75: +a.needed,
      }));
      const overallPct = attSummary.length
        ? Math.round(attSummary.reduce((sum, a) => sum + a.percentage, 0) / attSummary.length)
        : 0;

      const eligRow = (vtuElig as any[])[0];
      const regRow = (vtuReg as any[])[0];

      const realToday = (todaySlots as any[]).map(toSlot);
      const realAttendance = attSummary;
      const realMarks = marks.map((m: any) => ({
        subject: m.subject_name,
        ia1: m.ia1 !== null ? +m.ia1 : null,
        ia2: m.ia2 !== null ? +m.ia2 : null,
        maxMarks: +m.max_marks || 20,
      }));
      const realFeeBreakdown = (feeItems as any[]).map((f: any) => ({
        component: f.component, amount: +f.amount, status: f.status, dueDate: f.due_date ?? null,
      }));
      const realPlacements = (placements as any[]).map(p => ({
        company: p.company, status: p.status, scheduledDate: p.scheduled_date,
        minCgpa: +p.min_cgpa, rounds: p.rounds ?? [], venue: p.venue, eligibleDepts: p.eligible_depts ?? [],
      }));
      const realAnnouncements = (announcements as any[]).map(a => ({ title: a.title, content: a.content }));

      // Use realistic demo data when the optional table is empty so Gemini has
      // something useful to answer with. Real DB data always wins when present.
      const finalAttendance = realAttendance.length ? realAttendance : DEMO_ATTENDANCE;
      const finalOverallPct = finalAttendance.length
        ? Math.round(finalAttendance.reduce((sum, a) => sum + a.percentage, 0) / finalAttendance.length)
        : overallPct;

      return {
        role: 'STUDENT' as const,
        name: s.name,
        usn,
        semester: +s.semester,
        section: s.section,
        department: s.department,
        parentName: s.parent_name,
        preferredLanguage: s.lang,
        todaySchedule: realToday.length ? realToday : DEMO_TODAY_SCHEDULE,
        weekSchedule: Object.keys(weekSchedule).length ? weekSchedule : DEMO_WEEK_SCHEDULE,
        attendanceSummary: finalAttendance,
        overallAttendancePct: finalOverallPct,
        detentionRisk: finalAttendance.some(a => a.percentage < 75),
        marksSummary: realMarks.length ? realMarks : DEMO_MARKS,
        feeStatus: fees[0] ? {
          totalFee: +(fees[0]?.total_amount ?? 0),
          paid: +(fees[0]?.paid_amount ?? 0),
          balance: +(fees[0]?.balance ?? 0),
          status: fees[0].payment_status,
          dueDate: fees[0].due_date,
        } : DEMO_FEES,
        feeBreakdown: realFeeBreakdown.length ? realFeeBreakdown : DEMO_FEE_BREAKDOWN,
        riskScore: risk[0] ? +risk[0].risk_score : 0.18,
        riskLevel: risk[0]?.risk_level ?? 'LOW',
        recentAbsenceCount: +absences[0]?.cnt || 0,
        announcements: realAnnouncements.length ? realAnnouncements : DEMO_ANNOUNCEMENTS,
        upcomingPlacements: realPlacements.length ? realPlacements : DEMO_PLACEMENTS,
        vtuWindow: vtuWindows[0] ? {
          title: vtuWindows[0].title,
          semester: +vtuWindows[0].semester,
          openDate: vtuWindows[0].open_date,
          closeDate: vtuWindows[0].close_date,
          isActive: vtuWindows[0].is_active,
        } : null,
        vtuEligibility: eligRow ? {
          windowTitle: eligRow.window_title,
          isEligible: !!eligRow.is_eligible,
          eligibleSubjects: eligRow.eligible_subjects ?? [],
          registeredSubjects: regRow?.subject_codes ?? [],
          openDate: eligRow.open_date,
          closeDate: eligRow.close_date,
        } : null,
        collegeName: 'RV College of Engineering, Bengaluru',
        academicYear: '2025-26',
        topicMastery: await this.fetchTopicMastery(usn),
      };
    };

    return this.withTimeout(build(), this.emptyStudentGraph(usn));
  }

  /** LMS topic-mastery rollup for the student. Reads directly from
   *  lms_topic_mastery to avoid a circular dep on LmsService. Returns
   *  [] when the LMS module isn't deployed or the table is missing. */
  private async fetchTopicMastery(usn: string): Promise<TopicMasteryNode[]> {
    if (!this.db) return [];
    try {
      const rows = await this.db.query(
        `SELECT topic, course_id, mastery_score
         FROM lms_topic_mastery
         WHERE student_usn = $1
         ORDER BY mastery_score DESC
         LIMIT 50`,
        [usn],
      );
      return (rows ?? []).map((r: { topic: string; course_id: string; mastery_score: number | string }) => ({
        topic: r.topic,
        courseId: r.course_id,
        masteryScore: +r.mastery_score,
      }));
    } catch {
      return [];
    }
  }

  // Demo seed map: parent JWT subject (UUID) → child USN.
  // Keeps the parent chatbot personalised on the prod demo where the seeded
  // parent user has no parent_phone column on `users` and the WhatsApp-style
  // phone-key lookup misses. Real parents are still resolved via parent_phone.
  // Mirrors SeedService.seedParentPortal (parent_id 'u-parent-01' → 1RV21CS001).
  private readonly DEMO_PARENT_USN: Record<string, string> = {
    'u-parent-01': '1RV21CS001',
  };

  async buildParentGraph(identifier: string): Promise<ParentKnowledgeGraph> {
    if (!this.db) {
      // Even without a DB, give the seed parent a personalised demo graph.
      const demoUsn = this.DEMO_PARENT_USN[identifier];
      if (demoUsn) {
        const child = await this.buildStudentGraph(demoUsn).catch(() => this.emptyStudentGraph(demoUsn));
        const { role: _r, ...childWithoutRole } = child;
        return { role: 'PARENT', phone: identifier, preferredLanguage: 'en', child: childWithoutRole, announcements: [] };
      }
      return { role: 'PARENT', phone: identifier, preferredLanguage: 'en', child: this.emptyStudentGraph('UNKNOWN'), announcements: [] };
    }

    const build = async () => {
      // 1) Try the WhatsApp/SMS path: identifier is a digits-only phone.
      let rows = await this.db!.query(
        `SELECT student_id, COALESCE(preferred_language, 'en') AS lang
         FROM students WHERE parent_phone = $1 LIMIT 1`, [identifier],
      ).catch(() => []);

      // 2) Fall back: identifier is a parent user UUID — look up via parent_student_links.
      if (!rows[0]) {
        rows = await this.db!.query(
          `SELECT s.student_id AS student_id, COALESCE(s.preferred_language, 'en') AS lang
           FROM parent_student_links psl
           JOIN students s ON s.id = psl.student_id
           WHERE psl.parent_id = $1
           ORDER BY psl.is_primary DESC NULLS LAST
           LIMIT 1`, [identifier],
        ).catch(() => []);
      }

      // 3) Demo seed fallback so prod demo works even when neither table is
      //    populated for the seeded parent user.
      if (!rows[0] && this.DEMO_PARENT_USN[identifier]) {
        rows = [{ student_id: this.DEMO_PARENT_USN[identifier], lang: 'en' }];
      }

      if (!rows[0]) throw new Error('Parent not found');

      const [childGraph, parentAnnouncements] = await Promise.all([
        this.buildStudentGraph(rows[0].student_id),
        this.db!.query(`SELECT title, content FROM announcements WHERE audience IN ('PARENT','ALL') ORDER BY created_at DESC LIMIT 5`).catch(() => []),
      ]);
      return {
        role: 'PARENT' as const,
        phone: identifier,
        preferredLanguage: rows[0].lang,
        child: { ...childGraph, role: undefined as any },
        announcements: (parentAnnouncements as any[]).map(a => ({ title: a.title, content: a.content })),
      } as ParentKnowledgeGraph;
    };

    // On total failure (e.g. timeout) at least return a personalised demo
    // graph for the seed parent rather than an empty UNKNOWN child.
    const demoUsn = this.DEMO_PARENT_USN[identifier];
    const fallback: ParentKnowledgeGraph = {
      role: 'PARENT',
      phone: identifier,
      preferredLanguage: 'en',
      child: this.emptyStudentGraph(demoUsn ?? 'UNKNOWN'),
      announcements: [],
    };
    return this.withTimeout(build(), fallback);
  }

  async buildTeacherGraph(empId: string): Promise<TeacherKnowledgeGraph> {
    if (!this.db) {
      return this.emptyTeacherGraph(empId);
    }

    const build = async () => {
      const today = this.todayName();

      const [teachers, todaySlots, weekSlots, subjects, atRisk, announcements] = await Promise.all([
        this.db!.query(
          `SELECT name, emp_id, department, COALESCE(preferred_language, 'en') AS lang
           FROM faculty WHERE emp_id = $1 LIMIT 1`, [empId],
        ).catch(() => []),
        this.db!.query(
          `SELECT ts.period AS slot_index, ts.subject_name, ts.section,
                  ts.classroom_name AS room_number, tc.semester
           FROM timetable_slots ts
           JOIN timetable_configs tc ON ts.config_id = tc.id
           WHERE ts.faculty_name = (SELECT name FROM faculty WHERE emp_id = $1)
             AND ts.day = $2 AND tc.status = 'PUBLISHED'
             AND ts.is_break = false AND ts.faculty_name != 'N/A'
           ORDER BY ts.period`, [empId, today],
        ).catch(() => []),
        this.db!.query(
          `SELECT ts.period AS slot_index, ts.subject_name, ts.section,
                  ts.classroom_name AS room_number, tc.semester, ts.day
           FROM timetable_slots ts
           JOIN timetable_configs tc ON ts.config_id = tc.id
           WHERE ts.faculty_name = (SELECT name FROM faculty WHERE emp_id = $1)
             AND tc.status = 'PUBLISHED'
             AND ts.is_break = false AND ts.faculty_name != 'N/A'
           ORDER BY ts.day, ts.period`, [empId],
        ).catch(() => []),
        this.db!.query(
          `SELECT ts.subject_name,
                  STRING_AGG(DISTINCT ts.section, ', ') AS sections,
                  COUNT(DISTINCT s.student_id)::int AS total_students,
                  ROUND(AVG(COALESCE(att.pct,0)), 1)::float AS avg_att
           FROM timetable_slots ts
           JOIN timetable_configs tc ON ts.config_id = tc.id
           JOIN students s ON s.section = ts.section AND s.semester = tc.semester
           LEFT JOIN (
             SELECT student_id, subject_name,
                    ROUND(COUNT(*) FILTER (WHERE status='PRESENT') * 100.0 / NULLIF(COUNT(*),0), 1) AS pct
             FROM attendance GROUP BY student_id, subject_name
           ) att ON att.student_id = s.student_id AND att.subject_name = ts.subject_name
           WHERE ts.faculty_name = (SELECT name FROM faculty WHERE emp_id = $1)
             AND tc.status = 'PUBLISHED' AND ts.is_break = false
           GROUP BY ts.subject_name`, [empId],
        ).catch(() => []),
        this.db!.query(
          `SELECT srs.student_usn AS usn, s.name, srs.risk_score::float, srs.risk_level,
                  COALESCE(srs.primary_concern, 'Low attendance') AS primary_concern
           FROM student_risk_scores srs
           JOIN students s ON s.student_id = srs.student_usn
           WHERE srs.risk_level IN ('HIGH','CRITICAL')
             AND s.section IN (
               SELECT DISTINCT ts2.section FROM timetable_slots ts2
               JOIN timetable_configs tc2 ON ts2.config_id = tc2.id
               WHERE ts2.faculty_name = (SELECT name FROM faculty WHERE emp_id = $1)
                 AND tc2.status = 'PUBLISHED'
             )
           ORDER BY srs.risk_score DESC LIMIT 20`, [empId],
        ).catch(() => []),
        this.db!.query(
          `SELECT title, content FROM announcements
           WHERE audience IN ('FACULTY','ALL') ORDER BY created_at DESC LIMIT 5`,
        ).catch(() => []),
      ]);

      if (!teachers[0]) return this.emptyTeacherGraph(empId);
      const t = teachers[0];

      const toTeacherSlot = (sl: any): TeacherScheduleSlot => ({
        time: `Slot ${+sl.slot_index + 1}`,
        subject: sl.subject_name,
        section: sl.section,
        room: sl.room_number || 'TBD',
        semester: +sl.semester,
      });

      const teacherWeekSchedule: Record<string, TeacherScheduleSlot[]> = {};
      for (const sl of weekSlots as any[]) {
        const d = sl.day as string;
        if (!teacherWeekSchedule[d]) teacherWeekSchedule[d] = [];
        teacherWeekSchedule[d].push(toTeacherSlot(sl));
      }

      return {
        role: 'TEACHER' as const,
        name: t.name,
        empId,
        department: t.department,
        preferredLanguage: t.lang,
        todaySchedule: (todaySlots as any[]).map(toTeacherSlot),
        weekSchedule: teacherWeekSchedule,
        subjects: subjects.map((sub: any) => ({
          name: sub.subject_name,
          sections: String(sub.sections || '').split(', ').filter(Boolean),
          totalStudents: +sub.total_students,
          avgAttendance: +sub.avg_att || 0,
        })),
        atRiskStudents: atRisk.map((r: any) => ({
          usn: r.usn,
          name: r.name,
          riskScore: +r.risk_score,
          riskLevel: r.risk_level,
          primaryConcern: r.primary_concern,
        })),
        totalStudents: subjects.reduce((sum: number, s: any) => sum + (+s.total_students || 0), 0),
        announcements: (announcements as any[]).map(a => ({ title: a.title, content: a.content })),
        collegeName: 'RV College of Engineering, Bengaluru',
      };
    };

    return this.withTimeout(build(), this.emptyTeacherGraph(empId));
  }

  /**
   * Degraded fallback used when there is no DataSource, the student can't be
   * resolved, or build() exceeds GRAPH_TIMEOUT_MS. It mirrors the demo-data
   * substitution inside build(): rather than leaving the graph empty (which
   * makes the assistant reply "I don't have that information right now" to
   * every question), it returns realistic demo data so core questions —
   * schedule, fees, attendance, marks — always get a useful answer. Real DB
   * data always wins when build() completes in time.
   */
  private emptyStudentGraph(usn: string): StudentKnowledgeGraph {
    const overallPct = DEMO_ATTENDANCE.length
      ? Math.round(DEMO_ATTENDANCE.reduce((sum, a) => sum + a.percentage, 0) / DEMO_ATTENDANCE.length)
      : 0;
    return {
      role: 'STUDENT',
      name: 'Demo Student',
      usn,
      semester: 5,
      section: 'A',
      department: 'Computer Science & Engineering',
      parentName: 'Mr. Sharma',
      preferredLanguage: 'en',
      todaySchedule: DEMO_TODAY_SCHEDULE,
      weekSchedule: DEMO_WEEK_SCHEDULE,
      attendanceSummary: DEMO_ATTENDANCE,
      overallAttendancePct: overallPct,
      detentionRisk: DEMO_ATTENDANCE.some(a => a.percentage < 75),
      marksSummary: DEMO_MARKS,
      feeStatus: DEMO_FEES,
      feeBreakdown: DEMO_FEE_BREAKDOWN,
      riskScore: 0.18,
      riskLevel: 'LOW',
      recentAbsenceCount: 0,
      announcements: DEMO_ANNOUNCEMENTS,
      upcomingPlacements: DEMO_PLACEMENTS,
      vtuWindow: null,
      vtuEligibility: null,
      collegeName: 'RV College of Engineering, Bengaluru',
      academicYear: '2025-26',
      topicMastery: [],
    };
  }

  private emptyTeacherGraph(empId: string): TeacherKnowledgeGraph {
    return {
      role: 'TEACHER',
      name: 'Unknown',
      empId,
      department: '',
      preferredLanguage: 'en',
      todaySchedule: [],
      weekSchedule: {},
      subjects: [],
      atRiskStudents: [],
      totalStudents: 0,
      announcements: [],
      collegeName: 'RV College of Engineering, Bengaluru',
    };
  }

  async buildAdminGraph(empId: string): Promise<AdminKnowledgeGraph> {
    if (!this.db) {
      return this.emptyAdminGraph(empId);
    }

    const build = async (): Promise<AdminKnowledgeGraph> => {
      const [adminRow, stats, atRisk, announcements, placements, alumniRows] = await Promise.all([
        this.db!.query(
          `SELECT name, COALESCE(preferred_language,'en') AS lang FROM faculty WHERE emp_id = $1 LIMIT 1`, [empId],
        ).catch(() => []),
        this.db!.query(
          `SELECT
             (SELECT count(*)::int FROM students) AS total_students,
             (SELECT count(*)::int FROM faculty) AS total_faculty,
             (SELECT count(*)::int FROM student_risk_scores WHERE risk_level IN ('HIGH','CRITICAL')) AS high_risk_count,
             (SELECT count(*)::int FROM fee_payments WHERE payment_status IN ('PARTIAL','PENDING')) AS fee_defaulter_count,
             (SELECT count(*)::int FROM chat_conversations WHERE is_active = true) AS active_conversations`,
        ).catch(() => [{}]),
        this.db!.query(
          `SELECT srs.student_usn AS usn, s.name, srs.risk_score::float, srs.risk_level,
                  COALESCE(srs.primary_concern, 'Low attendance') AS primary_concern
           FROM student_risk_scores srs
           JOIN students s ON s.student_id = srs.student_usn
           WHERE srs.risk_level IN ('HIGH','CRITICAL')
           ORDER BY srs.risk_score DESC LIMIT 20`,
        ).catch(() => []),
        this.db!.query(
          `SELECT title, content FROM announcements ORDER BY created_at DESC LIMIT 5`,
        ).catch(() => []),
        this.db!.query(
          `SELECT company, status, scheduled_date, min_cgpa, rounds, venue
           FROM placement_drives WHERE status = 'OPEN' ORDER BY scheduled_date ASC LIMIT 5`,
        ).catch(() => []),
        this.db!.query(
          `SELECT dept,
                  ROUND(AVG(package_lpa)::numeric, 1)::float AS avg_pkg,
                  MAX(package_lpa)::float AS max_pkg,
                  COUNT(*)::int AS total
           FROM alumni_outcomes
           GROUP BY dept ORDER BY avg_pkg DESC LIMIT 10`,
        ).catch(() => []),
      ]);

      const s = stats[0] ?? {};
      const realAtRisk = atRisk.map((r: any) => ({
        usn: r.usn, name: r.name,
        riskScore: +r.risk_score, riskLevel: r.risk_level, primaryConcern: r.primary_concern,
      }));
      const realAnnouncements = (announcements as any[]).map(a => ({ title: a.title, content: a.content }));
      const realPlacements = (placements as any[]).map(p => ({
        company: p.company, status: p.status, scheduledDate: p.scheduled_date,
        minCgpa: +p.min_cgpa, rounds: p.rounds ?? [], venue: p.venue,
      }));
      return {
        role: 'ADMIN' as const,
        name: adminRow[0]?.name ?? 'Administrator',
        empId,
        preferredLanguage: adminRow[0]?.lang ?? 'en',
        collegeName: 'RV College of Engineering, Bengaluru',
        academicYear: '2025-26',
        stats: {
          totalStudents: +s.total_students || 450,
          totalFaculty: +s.total_faculty || 35,
          highRiskCount: +s.high_risk_count || 47,
          feeDefaulterCount: +s.fee_defaulter_count || 23,
          activeConversations: +s.active_conversations || 12,
        },
        atRiskStudents: realAtRisk.length ? realAtRisk : [
          { usn: '1RV21CS003', name: 'Karthik Reddy', riskScore: 0.78, riskLevel: 'HIGH', primaryConcern: 'Low attendance + Low marks' },
          { usn: '1RV21ME002', name: 'Sneha Iyer', riskScore: 0.65, riskLevel: 'HIGH', primaryConcern: 'Fee pending + attendance risk' },
          { usn: '1RV21CS004', name: 'Rohit Kumar', riskScore: 0.45, riskLevel: 'MEDIUM', primaryConcern: 'Attendance borderline in CN' },
        ],
        announcements: realAnnouncements.length ? realAnnouncements : DEMO_ANNOUNCEMENTS,
        upcomingPlacements: realPlacements.length ? realPlacements : DEMO_PLACEMENTS,
        todaySchedule: DEMO_TODAY_SCHEDULE,
        weekSchedule: DEMO_WEEK_SCHEDULE,
        feeCollectionSummary: { totalCollected: 24000000, pendingAmount: 2875000, defaulterCount: 23 },
        examWindow: { name: 'IA-3 (Sem 5)', startDate: '2026-05-18', endDate: '2026-05-25' },
        alumniStats: (alumniRows as any[]).map(r => ({
          dept: r.dept,
          avgPackageLpa: +r.avg_pkg || 0,
          maxPackageLpa: +r.max_pkg || 0,
          totalAlumni: +r.total,
        })),
      };
    };

    return this.withTimeout(build(), this.emptyAdminGraph(empId));
  }

  // ── Recruiter knowledge graph ──────────────────────────────────────────────
  // Used by the chatbot to answer "what jobs have I posted", "how many
  // candidates applied", "show my hiring funnel". Falls back to a realistic
  // demo graph when the recruiter has no jobs (or DB tables are missing) so
  // the prod demo is never empty.
  async buildRecruiterGraph(recruiterId: string, name?: string): Promise<RecruiterKnowledgeGraph> {
    if (!this.db) return this.emptyRecruiterGraph(recruiterId, name);

    const build = async (): Promise<RecruiterKnowledgeGraph> => {
      const [jobs, statusCounts, partnerColleges] = await Promise.all([
        this.db!.query(
          `SELECT id, title, ctc_lpa::float AS ctc_lpa, min_cgpa::float AS min_cgpa,
                  location, status, posted_at,
                  (SELECT COUNT(*)::int FROM recruiter_applications ra WHERE ra.job_id = rj.id AND ra.status = 'APPLIED') AS applicant_count,
                  (SELECT COUNT(*)::int FROM recruiter_applications ra WHERE ra.job_id = rj.id AND ra.status = 'SHORTLISTED') AS shortlisted_count,
                  (SELECT COUNT(*)::int FROM recruiter_applications ra WHERE ra.job_id = rj.id AND ra.status = 'OFFERED') AS offer_count
           FROM recruiter_jobs rj
           WHERE rj.recruiter_id = $1
           ORDER BY rj.posted_at DESC LIMIT 5`, [recruiterId],
        ).catch(() => []),
        this.db!.query(
          `SELECT ra.status, COUNT(*)::int AS cnt
           FROM recruiter_applications ra
           JOIN recruiter_jobs rj ON rj.id = ra.job_id
           WHERE rj.recruiter_id = $1
           GROUP BY ra.status`, [recruiterId],
        ).catch(() => []),
        this.db!.query(
          `SELECT DISTINCT s.institution_id AS college
           FROM recruiter_applications ra
           JOIN recruiter_jobs rj ON rj.id = ra.job_id
           JOIN students s ON s.student_id = ra.student_usn
           WHERE rj.recruiter_id = $1 LIMIT 10`, [recruiterId],
        ).catch(() => []),
      ]);

      const counts: Record<string, number> = {};
      for (const r of statusCounts as Array<{ status: string; cnt: number }>) {
        counts[r.status] = r.cnt;
      }

      const totalApplicants = Object.values(counts).reduce((a, b) => a + b, 0);
      const totalShortlisted = counts['SHORTLISTED'] ?? 0;
      const totalOffersMade = counts['OFFERED'] ?? 0;

      const recentJobs: RecruiterJobSummary[] = (jobs as Record<string, unknown>[]).map((j) => ({
        id: String(j['id'] ?? ''),
        title: String(j['title'] ?? ''),
        ctcLpa: +(j['ctc_lpa'] ?? 0),
        minCgpa: +(j['min_cgpa'] ?? 0),
        location: String(j['location'] ?? ''),
        status: String(j['status'] ?? 'OPEN'),
        postedAt: String(j['posted_at'] ?? ''),
        applicantCount: +(j['applicant_count'] ?? 0),
        shortlistedCount: +(j['shortlisted_count'] ?? 0),
        offerCount: +(j['offer_count'] ?? 0),
      }));

      // Demo fallback: recruiter exists but has no jobs yet (cold-start).
      // Surface a realistic 2-job sample so the chatbot can answer
      // questions without saying "I don't have any jobs". Prefer real
      // partner colleges when available, otherwise keep the demo list.
      if (!recentJobs.length) {
        const empty = this.emptyRecruiterGraph(recruiterId, name);
        const liveColleges = (partnerColleges as Array<{ college: string }>).map(r => r.college).filter(Boolean);
        return { ...empty, partnerColleges: liveColleges.length ? liveColleges : empty.partnerColleges };
      }

      return {
        role: 'RECRUITER',
        name: name ?? 'Recruiter',
        recruiterId,
        preferredLanguage: 'en',
        companyName: name?.replace(/^Recruiter\s*-?\s*/i, '') || 'your company',
        recentJobs,
        totalJobsPosted: recentJobs.length,
        totalApplicants,
        totalShortlisted,
        totalOffersMade,
        partnerColleges: (partnerColleges as Array<{ college: string }>).map(r => r.college).filter(Boolean),
      };
    };

    return this.withTimeout(build(), this.emptyRecruiterGraph(recruiterId, name));
  }

  private emptyRecruiterGraph(recruiterId: string, name?: string): RecruiterKnowledgeGraph {
    return {
      role: 'RECRUITER',
      name: name ?? 'Recruiter',
      recruiterId,
      preferredLanguage: 'en',
      companyName: name?.replace(/^Recruiter\s*-?\s*/i, '') || 'your company',
      recentJobs: [
        { id: 'demo-job-1', title: 'Software Engineer', ctcLpa: 8.5, minCgpa: 7.0, location: 'Bengaluru', status: 'OPEN', postedAt: '2026-05-01', applicantCount: 24, shortlistedCount: 8, offerCount: 0 },
        { id: 'demo-job-2', title: 'Frontend Developer', ctcLpa: 12, minCgpa: 8.0, location: 'Bengaluru / Remote', status: 'OPEN', postedAt: '2026-04-28', applicantCount: 41, shortlistedCount: 12, offerCount: 2 },
      ],
      totalJobsPosted: 2,
      totalApplicants: 65,
      totalShortlisted: 20,
      totalOffersMade: 2,
      partnerColleges: ['RV College of Engineering', 'MS Ramaiah Institute of Technology', 'BMS College of Engineering'],
    };
  }

  private emptyAdminGraph(empId: string): AdminKnowledgeGraph {
    return {
      role: 'ADMIN',
      name: 'Administrator',
      empId,
      preferredLanguage: 'en',
      collegeName: 'RV College of Engineering, Bengaluru',
      academicYear: '2025-26',
      stats: { totalStudents: 450, totalFaculty: 35, highRiskCount: 47, feeDefaulterCount: 23, activeConversations: 12 },
      atRiskStudents: [],
      announcements: DEMO_ANNOUNCEMENTS,
      upcomingPlacements: DEMO_PLACEMENTS,
      alumniStats: [],
      todaySchedule: DEMO_TODAY_SCHEDULE,
      weekSchedule: DEMO_WEEK_SCHEDULE,
      feeCollectionSummary: { totalCollected: 24000000, pendingAmount: 2875000, defaulterCount: 23 },
      examWindow: { name: 'IA-3 (Sem 5)', startDate: '2026-05-18', endDate: '2026-05-25' },
    };
  }
}
