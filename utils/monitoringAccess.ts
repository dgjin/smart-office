import type { MonitoringScope, RoleDefinition, User } from '../types.ts';

export const MONITORING_SCOPES: readonly MonitoringScope[] = ['MEETING_ROOMS', 'OFFICES'];

export const isMonitoringScope = (value: unknown): value is MonitoringScope =>
  typeof value === 'string' && MONITORING_SCOPES.includes(value as MonitoringScope);

export const canViewMonitoring = (
  actor: Pick<User, 'role'> | null | undefined,
  roles: RoleDefinition[],
  scope: MonitoringScope
) => Boolean(actor && (
  actor.role.includes('SYSTEM_ADMIN')
  || actor.role.some(roleId => roles.find(role => role.id === roleId)?.monitoringScopes?.includes(scope))
));
