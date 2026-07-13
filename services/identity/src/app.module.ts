import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { RolesModule } from './roles/roles.module';
import { ParentsModule } from './parents/parents.module';
import { StudentsModule } from './students/students.module';
import { DirectoryModule } from './directory/directory.module';
import { HealthModule } from './health/health.module';
import { RolesGuard } from './roles/roles.guard';
import { EventsModule } from './events/events.module';
import { CoursesModule } from './courses/courses.module';
import { AttendanceApiModule } from './attendance-api/attendance-api.module';
import { AssignmentsApiModule } from './assignments-api/assignments-api.module';
import { IaModule } from './ia/ia.module';
import { FeesApiModule } from './fees-api/fees-api.module';
import { VtuModule } from './vtu/vtu.module';
import { WellnessModule } from './wellness/wellness.module';
import { JobsModule } from './jobs/jobs.module';
import { ClassesApiModule } from './classes-api/classes-api.module';
import { StudentPortalModule } from './student-portal/student-portal.module';
import { ParentPortalModule } from './parent-portal/parent-portal.module';
import { AdminPortalModule } from './admin-portal/admin-portal.module';
import { CommsModule } from './comms/comms.module';
import { DepartmentsModule } from './departments/departments.module';
import { SeedModule } from './seed/seed.module';
import { PromotionModule } from './promotion/promotion.module';
import { ChatbotModule } from './chatbot/chatbot.module';
import { AbcCreditsModule } from './abc-credits/abc-credits.module';
import { NlQueryModule } from './nl-query/nl-query.module';
import { RiskModule } from './risk/risk.module';
import { DocumentsModule } from './documents/documents.module';
import { FeeRemindersModule } from './fee-reminders/fee-reminders.module';
import { NaacModule } from './naac/naac.module';
import { TimetableModule } from './timetable/timetable.module';
import { ReportGeneratorModule } from './report-generator/report-generator.module';
import { PlacementModule } from './placement/placement.module';
import { RecruiterModule } from './recruiter/recruiter.module';
import { LmsModule } from './lms/lms.module';
import { ObeModule } from './obe/obe.module';
import { BulkImportModule } from './bulk-import/bulk-import.module';
import { FeatureStoreModule } from './feature-store/feature-store.module';
import { PredictionModule } from './prediction/prediction.module';
import { HostelModule } from './hostel/hostel.module';
import { TransportModule } from './transport/transport.module';

@Module({
  imports: [
    // Database (connects when DATABASE_URL is set; no-op in tests)
    DatabaseModule,
    // Existing
    AuthModule,
    UsersModule,
    RolesModule,
    StudentsModule,
    ParentsModule,
    DirectoryModule,
    HealthModule,
    // New infrastructure
    EventsModule,
    // Domain modules
    CoursesModule,
    AttendanceApiModule,
    AssignmentsApiModule,
    IaModule,
    FeesApiModule,
    VtuModule,
    WellnessModule,
    JobsModule,
    ClassesApiModule,
    StudentPortalModule,
    ParentPortalModule,
    AdminPortalModule,
    CommsModule,
    DepartmentsModule,
    PromotionModule,
    ChatbotModule,
    AbcCreditsModule,
    NlQueryModule,
    RiskModule,
    DocumentsModule,
    FeeRemindersModule,
    NaacModule,
    TimetableModule,
    ReportGeneratorModule,
    PlacementModule,
    RecruiterModule,
    LmsModule,
    ObeModule,
    BulkImportModule,
    // Phase 0 — shared AI foundation (feature store + prediction engine)
    FeatureStoreModule,
    PredictionModule,
    // Campus services — hostel management + bus transportation
    HostelModule,
    TransportModule,
    // Seed (must be last — imports all domain modules)
    SeedModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
})
export class AppModule {}
