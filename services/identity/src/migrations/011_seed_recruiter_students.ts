import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration 011 — Seed recruiter-searchable students into the DB.
 * The in-memory seed (seed.service.ts) populates attendance/marks services
 * but not the `students` PostgreSQL table. The recruiter `searchCandidates`
 * queries the DB directly, so without this seed it returns empty/garbage rows.
 */

export class SeedRecruiterStudents1700000000011 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO students (student_id, name, email, department, semester, cgpa, skills, institution_id, status)
      VALUES
        ('1RV21CS001', 'Arjun Sharma',   'arjun.sharma@student.rvce.edu.in',   'CSE', '8', 8.90, ARRAY['Java','Python','React','AWS'],          'rvce', 'active'),
        ('1RV21CS047', 'Priya Patel',    'priya.patel@student.rvce.edu.in',    'CSE', '8', 9.20, ARRAY['Java','ML','SQL','TensorFlow'],         'rvce', 'active'),
        ('1RV21IS012', 'Rohit Kumar',    'rohit.kumar@student.rvce.edu.in',    'ISE', '8', 7.80, ARRAY['Java','Spring','React','Docker'],        'rvce', 'active'),
        ('1RV21ECE024','Sneha Reddy',    'sneha.reddy@student.rvce.edu.in',    'ECE', '8', 8.40, ARRAY['Embedded C','Python','VLSI','IoT'],      'rvce', 'active'),
        ('1RV21CS002', 'Kiran Menon',    'kiran.menon@student.rvce.edu.in',    'CSE', '8', 7.90, ARRAY['Node.js','TypeScript','PostgreSQL'],     'rvce', 'active'),
        ('1RV21CS003', 'Divya Nair',     'divya.nair@student.rvce.edu.in',     'CSE', '8', 6.80, ARRAY['Python','Django','MySQL','Git'],         'rvce', 'active'),
        ('1RV21CS004', 'Karan Joshi',    'karan.joshi@student.rvce.edu.in',    'CSE', '8', 8.70, ARRAY['Go','Kubernetes','Kafka','PostgreSQL'],  'rvce', 'active'),
        ('1RV21EEE005','Meera Pillai',   'meera.pillai@student.rvce.edu.in',   'EEE', '8', 7.50, ARRAY['MATLAB','Python','Power Systems'],       'rvce', 'active'),
        ('1RV21ME006',  'Suresh Babu',   'suresh.babu@student.rvce.edu.in',    'ME',  '8', 7.20, ARRAY['AutoCAD','SolidWorks','MATLAB'],         'rvce', 'active'),
        ('1RV21CV007',  'Ananya Rao',    'ananya.rao@student.rvce.edu.in',     'CV',  '8', 8.10, ARRAY['AutoCAD','STAAD Pro','MS Project'],      'rvce', 'active')
      ON CONFLICT (student_id) DO UPDATE SET
        name          = EXCLUDED.name,
        email         = EXCLUDED.email,
        department    = EXCLUDED.department,
        semester      = EXCLUDED.semester,
        cgpa          = EXCLUDED.cgpa,
        skills        = EXCLUDED.skills,
        institution_id= EXCLUDED.institution_id,
        status        = EXCLUDED.status;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM students WHERE student_id IN (
        '1RV21CS001','1RV21CS047','1RV21IS012','1RV21ECE024',
        '1RV21CS002','1RV21CS003','1RV21CS004',
        '1RV21EEE005','1RV21ME006','1RV21CV007'
      );
    `);
  }
}
