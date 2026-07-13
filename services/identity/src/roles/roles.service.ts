import { Injectable } from '@nestjs/common';
import type { UserRole } from '../entities/user.entity';

interface RoleDefinition {
  name: UserRole;
  permissions: string[];
}

@Injectable()
export class RolesService {
  private readonly roles: RoleDefinition[] = [
    { name: 'ADMIN', permissions: ['*'] },
    { name: 'PRINCIPAL', permissions: ['reports:read', 'users:read', 'students:read'] },
    { name: 'DEAN', permissions: ['reports:read', 'students:read', 'faculty:read'] },
    { name: 'HOD', permissions: ['students:read', 'faculty:read', 'attendance:read'] },
    { name: 'FACULTY', permissions: ['students:read:section', 'attendance:write', 'marks:write'] },
    { name: 'COUNSELLOR', permissions: ['students:read', 'mentorship:write'] },
    { name: 'PARENT', permissions: ['students:read:linked', 'attendance:read:linked', 'fees:read:linked'] },
    { name: 'STUDENT', permissions: ['students:read:self', 'attendance:read:self', 'fees:read:self'] },
    { name: 'TRUSTEE', permissions: ['analytics:read', 'reports:read'] },
    { name: 'RECRUITER', permissions: ['placements:read', 'placements:write'] },
    { name: 'APPLICANT', permissions: ['admissions:read:self', 'admissions:write:self'] },
    { name: 'DRIVER', permissions: ['transport:location:write'] },
  ];

  findAll(): RoleDefinition[] {
    return this.roles;
  }

  findByName(name: UserRole): RoleDefinition | undefined {
    return this.roles.find((r) => r.name === name);
  }

  hasPermission(role: UserRole, permission: string): boolean {
    const def = this.findByName(role);
    if (!def) return false;
    return def.permissions.includes('*') || def.permissions.includes(permission);
  }
}
