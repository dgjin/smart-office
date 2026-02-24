import { useMemo } from 'react';
import { ROLE_PERMISSIONS, Permission } from '../permissions';

export function usePermissions(userRoles: string[] = []) {
  const permissions = useMemo(() => {
    const allPermissions = new Set<string>();
    userRoles.forEach(role => {
      const rolePerms = ROLE_PERMISSIONS[role] || [];
      rolePerms.forEach(perm => allPermissions.add(perm));
    });
    console.log('usePermissions', { userRoles, permissions: Array.from(allPermissions) });
    return allPermissions;
  }, [userRoles]);

  const hasPermission = (permission: Permission | string): boolean => {
    const result = permissions.has(permission);
    console.log('hasPermission check', { permission, result });
    return result;
  };

  const hasAnyPermission = (perms: (Permission | string)[]): boolean => {
    return perms.some(p => permissions.has(p));
  };

  const hasAllPermissions = (perms: (Permission | string)[]): boolean => {
    return perms.every(p => permissions.has(p));
  };

  const hasRole = (role: string): boolean => {
    return userRoles.includes(role);
  };

  const hasAnyRole = (roles: string[]): boolean => {
    return roles.some(r => userRoles.includes(r));
  };

  return {
    permissions,
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
    hasRole,
    hasAnyRole,
  };
}
