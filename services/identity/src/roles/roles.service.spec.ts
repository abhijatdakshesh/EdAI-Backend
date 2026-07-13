import { Test, TestingModule } from '@nestjs/testing';
import { RolesService } from './roles.service';
import type { UserRole } from '../entities/user.entity';

describe('RolesService', () => {
  let service: RolesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RolesService],
    }).compile();

    service = module.get<RolesService>(RolesService);
  });

  // ─── findAll ────────────────────────────────────────────────────────────────

  describe('findAll()', () => {
    it('returns all 12 role definitions', () => {
      expect(service.findAll()).toHaveLength(12);
    });

    it('includes ADMIN role', () => {
      expect(service.findAll().some((r) => r.name === 'ADMIN')).toBe(true);
    });
  });

  // ─── findByName ─────────────────────────────────────────────────────────────

  describe('findByName()', () => {
    it('returns role definition for ADMIN', () => {
      const role = service.findByName('ADMIN');
      expect(role).toBeDefined();
      expect(role!.name).toBe('ADMIN');
      expect(role!.permissions).toContain('*');
    });

    it('returns role definition for STUDENT', () => {
      const role = service.findByName('STUDENT');
      expect(role).toBeDefined();
      expect(role!.permissions).toContain('students:read:self');
    });

    it('returns undefined for unknown role name', () => {
      expect(service.findByName('UNKNOWN' as UserRole)).toBeUndefined();
    });

    const allRoles: UserRole[] = ['ADMIN', 'PRINCIPAL', 'DEAN', 'HOD', 'FACULTY', 'COUNSELLOR', 'PARENT', 'STUDENT', 'TRUSTEE', 'RECRUITER', 'APPLICANT', 'DRIVER'];
    allRoles.forEach((role) => {
      it(`returns definition for ${role}`, () => {
        expect(service.findByName(role)).toBeDefined();
      });
    });
  });

  // ─── hasPermission ──────────────────────────────────────────────────────────

  describe('hasPermission()', () => {
    it('ADMIN has all permissions via wildcard', () => {
      expect(service.hasPermission('ADMIN', 'any:permission:at:all')).toBe(true);
    });

    it('FACULTY has attendance:write permission', () => {
      expect(service.hasPermission('FACULTY', 'attendance:write')).toBe(true);
    });

    it('FACULTY does NOT have reports:read permission', () => {
      expect(service.hasPermission('FACULTY', 'reports:read')).toBe(false);
    });

    it('STUDENT has students:read:self permission', () => {
      expect(service.hasPermission('STUDENT', 'students:read:self')).toBe(true);
    });

    it('STUDENT does NOT have marks:write permission', () => {
      expect(service.hasPermission('STUDENT', 'marks:write')).toBe(false);
    });

    it('returns false for unknown role', () => {
      expect(service.hasPermission('UNKNOWN' as UserRole, 'any:permission')).toBe(false);
    });

    it('PARENT has fees:read:linked permission', () => {
      expect(service.hasPermission('PARENT', 'fees:read:linked')).toBe(true);
    });
  });
});
