import crypto from 'node:crypto';
import type { Resource, ResourceImportIssue, ResourceImportItemReport, ResourceImportReport } from '../types.ts';
import { getResourceUpdateError } from '../utils/bookingRules.ts';
import { getCurrentRuleSettings } from '../utils/resourceDomain.ts';
import { DbError, mutateDb, normalizeResource, readSnapshot } from './db.ts';
import type { OfficeDb } from './tools.ts';

const RESOURCE_FIELDS: Array<keyof Resource> = [
  'name', 'type', 'capacity', 'location', 'building', 'floor', 'roomNumber', 'roomCategory', 'campus',
  'features', 'status', 'isExclusive', 'exclusiveLeaderLevel', 'openStart', 'openEnd', 'isPublic', 'notes'
];

const sameValue = (left: unknown, right: unknown) => JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
const resourceCode = (resource: Resource) => resource.code || resource.id.toUpperCase();

const issue = (row: number, code: string, resourceCode?: string, field?: string): ResourceImportIssue => ({ row, code, resourceCode, field });

export const buildResourceImportReport = (db: OfficeDb, input: any, revision?: number): ResourceImportReport => {
  if (!Array.isArray(input) || !input.length || input.length > 500) throw new DbError('INVALID_IMPORT', 400);
  const currentResources = db.resources || [];
  const settings = getCurrentRuleSettings(db.ruleVersions);
  const items: ResourceImportItemReport[] = input.map((raw, index) => {
    const row = index + 1;
    const rawCode = typeof raw?.code === 'string' ? raw.code.trim().toUpperCase() : undefined;
    try {
      if (!rawCode) throw new DbError('RESOURCE_CODE_REQUIRED', 400);
      const normalized = normalizeResource({ ...raw, id: raw.id || `r-${rawCode.toLowerCase()}` }, undefined, settings);
      if (normalized.type === 'ROOM' && (!normalized.building || !normalized.floor)) throw new DbError('RESOURCE_STRUCTURED_LOCATION_REQUIRED', 400);
      let resource = normalized;
      const byId = currentResources.find(candidate => candidate.id === resource.id);
      const byCode = currentResources.find(candidate => resourceCode(candidate) === resource.code);
      if (byId && byCode && byId.id !== byCode.id) throw new DbError('RESOURCE_CODE_ID_CONFLICT', 409);
      if (byId && resourceCode(byId) !== resource.code) throw new DbError('RESOURCE_CODE_IMMUTABLE', 409);
      if (byCode && byId?.id !== byCode.id) resource = { ...resource, id: byCode.id };
      const current = byCode || byId;
      if (current) {
        const impact = getResourceUpdateError(current, resource, db.bookings || []);
        if (impact) throw new DbError(impact.code, 409);
      }
      const changedFields = current ? RESOURCE_FIELDS.filter(field => !sameValue(current[field], resource[field])).map(String) : [];
      return {
        row,
        action: current ? changedFields.length ? 'UPDATE' : 'UNCHANGED' : 'CREATE',
        resourceCode: resource.code,
        resource,
        changedFields,
        issues: []
      };
    } catch (error: any) {
      const code = error instanceof DbError ? error.message : 'INVALID_RESOURCE';
      return { row, action: 'ERROR', resourceCode: rawCode, changedFields: [], issues: [issue(row, code, rawCode)] };
    }
  });

  const markErrors = (code: string, candidates: ResourceImportItemReport[]) => {
    for (const item of candidates) {
      if (item.action === 'ERROR') continue;
      item.issues.push(issue(item.row, code, item.resourceCode));
      item.action = 'ERROR';
    }
  };
  const validItems = () => items.filter(item => item.action !== 'ERROR');
  for (const key of ['id', 'code', 'name'] as const) {
    const groups = new Map<string, ResourceImportItemReport[]>();
    for (const item of validItems()) {
      const resource = item.resource!;
      const value = key === 'code' ? resourceCode(resource) : String(resource[key]);
      groups.set(value, [...(groups.get(value) || []), item]);
    }
    for (const group of groups.values()) {
      if (group.length > 1) markErrors(`DUPLICATE_RESOURCE_${key.toUpperCase()}`, group);
    }
  }
  for (const item of validItems()) {
    const resource = item.resource!;
    if (currentResources.some(current => current.id !== resource.id && current.name === resource.name)) {
      markErrors('DUPLICATE_RESOURCE_NAME', [item]);
    }
  }

  const creates = items.filter(item => item.action === 'CREATE').length;
  const updates = items.filter(item => item.action === 'UPDATE').length;
  const unchanged = items.filter(item => item.action === 'UNCHANGED').length;
  const invalid = items.filter(item => item.action === 'ERROR').length;
  return { revision, total: items.length, valid: items.length - invalid, invalid, creates, updates, unchanged, items };
};

export const preflightResourceImport = async (input: any) => {
  const { db, revision } = await readSnapshot();
  return buildResourceImportReport(db, input, revision);
};

export const importResourceLedger = async (input: any, actorId: string) => mutateDb(async (db, { audit }) => {
  const report = buildResourceImportReport(db, input);
  if (report.invalid) throw new DbError('RESOURCE_IMPORT_INVALID', 409, report);
  if (!report.creates && !report.updates) throw new DbError('RESOURCE_IMPORT_NO_CHANGES', 409, report);
  const changed = report.items.filter(item => item.action === 'CREATE' || item.action === 'UPDATE');
  const changedById = new Map(changed.map(item => [item.resource!.id, item.resource!]));
  db.resources = (db.resources || []).map(resource => changedById.get(resource.id) || resource);
  const existingIds = new Set((db.resources || []).map(resource => resource.id));
  db.resources = [...db.resources, ...changed.filter(item => item.action === 'CREATE' && !existingIds.has(item.resource!.id)).map(item => item.resource!)];
  const batch = { id: crypto.randomUUID(), actorId, createdAt: new Date().toISOString(), report };
  db.resourceImportBatches = [batch, ...(db.resourceImportBatches || [])].slice(0, 50);
  await audit({
    actorId,
    action: 'RESOURCE_LEDGER_IMPORT',
    entityType: 'RESOURCE_IMPORT',
    entityId: batch.id,
    details: { total: report.total, creates: report.creates, updates: report.updates, unchanged: report.unchanged }
  });
  return { batch, report, items: changed.map(item => item.resource!) };
});
