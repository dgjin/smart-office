import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { closeDbPool, getDbPool } from '../server/db.ts';
import { getHq3dSnapshot } from '../server/hq3d.ts';

const baselineExtractPath = '.wb/reports/hq3d-resource-live-extract-20261122.json';
const baselineDiffPath = '.wb/reports/hq3d-resource-diff-20261122.json';
const outputExtractPath = '.wb/reports/hq3d-resource-live-extract-post-c07-20261122.json';
const outputDiffPath = '.wb/reports/hq3d-resource-diff-post-c07-20261122.json';
const checklistPath = '.wb/reports/hq3d-p0-confirmation-checklist-post-c07-20261122.json';
const baselineExtract = JSON.parse(await readFile(baselineExtractPath, 'utf8'));
const baselineDiff = JSON.parse(await readFile(baselineDiffPath, 'utf8'));

const resourceRow = (resource: any) => ({
  id: resource.id,
  code: resource.code || '',
  name: resource.name || '',
  capacity: resource.capacity ?? null,
  location: resource.location || '',
  building: resource.building || '',
  floor: resource.floor ?? null,
  roomNumber: resource.roomNumber || '',
  roomCategory: resource.roomCategory || '',
  campus: resource.campus || '',
  features: resource.features || [],
  status: resource.status || '',
  isExclusive: Boolean(resource.isExclusive),
  isPublic: resource.isPublic !== false,
  openStart: resource.openStart || '',
  openEnd: resource.openEnd || '',
  notes: resource.notes || ''
});
const counts = (values: string[]) => Object.fromEntries([...values.reduce((map, value) => map.set(value, (map.get(value) || 0) + 1), new Map<string, number>()).entries()].sort(([a], [b]) => a.localeCompare(b)));

try {
  const pool = getDbPool();
  const [[resourceState]] = await pool.query<any[]>("SELECT payload, updated_at FROM office_state WHERE state_key = 'resources'");
  const [[meta]] = await pool.query<any[]>('SELECT revision FROM office_snapshot_meta WHERE id = 1');
  const snapshot = await getHq3dSnapshot();
  const resources = (typeof resourceState.payload === 'string' ? JSON.parse(resourceState.payload) : resourceState.payload)
    .filter((resource: any) => resource.type === 'ROOM').map(resourceRow);
  const allRooms = snapshot.buildings.flatMap(building => building.floors.flatMap(floor => floor.rooms.map(room => ({
    room,
    buildingId: building.id,
    buildingName: building.name,
    floor: floor.floorNo,
    floorTag: floor.tag
  }))));
  const meetingRooms = allRooms.map(item => {
    const profile = snapshot.profiles[item.room.uid];
    const category = profile?.category || item.room.cat;
    return {
      uid: item.room.uid,
      buildingId: item.buildingId,
      buildingName: item.buildingName,
      floor: item.floor,
      floorTag: item.floorTag,
      roomNumber: item.room.no || '',
      category,
      label: profile?.label || item.room.label,
      dept: profile?.dept || item.room.dept || '',
      notes: profile?.notes || item.room.notes || '',
      baseCategory: item.room.cat,
      baseLabel: item.room.label,
      profileOverridden: Boolean(profile),
      profileUpdatedAt: profile?.updatedAt || null,
      maintenanceRecordCount: snapshot.maintenance[item.room.uid]?.records.length || 0
    };
  }).filter(room => room.category === 'meeting');
  const hq3d = {
    buildingCount: snapshot.buildings.length,
    floorCount: snapshot.buildings.reduce((total, building) => total + building.floors.length, 0),
    roomCount: allRooms.length,
    baseMeetingCount: allRooms.filter(item => item.room.cat === 'meeting').length,
    effectiveMeetingCount: meetingRooms.length,
    profileCount: Object.keys(snapshot.profiles).length,
    maintenanceRoomCount: Object.keys(snapshot.maintenance).length,
    maintenanceRecordCount: Object.values(snapshot.maintenance).reduce((total, item) => total + item.records.length, 0),
    categoryCounts: counts(allRooms.map(item => snapshot.profiles[item.room.uid]?.category || item.room.cat)),
    baseCategoryCounts: counts(allRooms.map(item => item.room.cat)),
    meetingRooms
  };
  const source = {
    databaseSnapshotRevision: Number(meta.revision),
    resourcesUpdatedAt: new Date(resourceState.updated_at).toISOString(),
    hq3dSnapshotGeneratedAt: snapshot.generatedAt,
    queryMode: 'READ_ONLY'
  };
  const extract = { generatedAt: new Date().toISOString(), source, resources, hq3d };
  const liveById = new Map(resources.map((resource: any) => [resource.id, resource]));
  const baselineById = new Map(baselineExtract.resources.map((resource: any) => [resource.id, resource]));
  const removedResources = baselineExtract.resources.filter((resource: any) => !liveById.has(resource.id));
  const addedResources = resources.filter((resource: any) => !baselineById.has(resource.id));
  const changedResources = resources.filter((resource: any) => {
    const baseline = baselineById.get(resource.id);
    if (!baseline) return false;
    try {
      assert.deepStrictEqual(resource, baseline);
      return false;
    } catch {
      return true;
    }
  });
  assert.equal(addedResources.length, 0, '存在新增资源，需执行完整差异算法');
  assert.equal(changedResources.length, 0, '存在既有资源字段变化，需执行完整差异算法');
  for (const removed of removedResources) {
    const row = baselineDiff.resourceRows.find((item: any) => item.id === removed.id);
    assert.equal(row?.scope, 'ADDITIONAL_4', '需求资源在基线后被移除，不能自动重算');
    assert.equal(row?.candidates.length, 0, '已有位置候选的资源被移除，需人工复核映射影响');
  }
  assert.deepStrictEqual(resources, baselineExtract.resources.filter((resource: any) => liveById.has(resource.id)));
  assert.deepStrictEqual(hq3d, baselineExtract.hq3d, '3D快照已变化，不能沿用P0差异行');
  await writeFile(outputExtractPath, `${JSON.stringify(extract, null, 2)}\n`);

  const [[identity]] = await pool.query<any[]>(`SELECT COUNT(*) AS total, COALESCE(SUM(is_active = 1), 0) AS active,
    COALESCE(SUM(is_active = 0), 0) AS retired FROM hq3d_room`);
  const [migrationRows] = await pool.query<any[]>('SELECT version FROM schema_migrations WHERE version = ?', ['015_hq3d_stable_room_identity.sql']);
  assert.equal(migrationRows.length, 1);
  assert.equal(Number(identity.total), 427);
  assert.equal(Number(identity.active), 427);
  const resourceRows = baselineDiff.resourceRows.filter((row: any) => liveById.has(row.id));
  const summary = {
    ...baselineDiff.summary,
    roomResourceCount: resourceRows.length,
    additionalResourceCount: resourceRows.filter((row: any) => row.scope === 'ADDITIONAL_4').length,
    availableResourceCount: resourceRows.filter((row: any) => row.status === 'AVAILABLE').length,
    pendingResourceCount: resourceRows.filter((row: any) => row.status === 'PENDING').length,
    manualMappingResourceCount: resourceRows.filter((row: any) => row.matchStatus === 'MANUAL_MAPPING_REQUIRED').length,
    additionalManualMappingCount: resourceRows.filter((row: any) => row.scope === 'ADDITIONAL_4' && row.matchStatus === 'MANUAL_MAPPING_REQUIRED').length
  };
  const diff = {
    ...baselineDiff,
    generatedAt: new Date().toISOString(),
    source,
    summary,
    resourceRows,
    baselineChanges: {
      removedResources: removedResources.map((resource: any) => ({
        id: resource.id,
        name: resource.name,
        scope: 'ADDITIONAL_4',
        detection: 'PRESENT_IN_FROZEN_P0_ABSENT_IN_CURRENT_LIVE_SNAPSHOT',
        restoredByThisRun: false
      })),
      addedResources,
      changedResources
    },
    c07Verification: {
      status: 'TECHNICALLY_IMPLEMENTED_AND_VERIFIED',
      migration: '015_hq3d_stable_room_identity.sql',
      explicitUidCount: 427,
      activeRoomCount: Number(identity.active),
      retiredRoomCount: Number(identity.retired),
      seedRetiredCount: 0,
      baselinePreserved: true,
      confirmedMappingsCreated: 0,
      businessResourcesChanged: 0
    }
  };
  await writeFile(outputDiffPath, `${JSON.stringify(diff, null, 2)}\n`);

  const additionalIds = baselineDiff.resourceRows.filter((row: any) => row.scope === 'ADDITIONAL_4').map((row: any) => row.id);
  const relatedIds = [...new Set([...additionalIds, ...baselineDiff.resourceRows.map((row: any) => row.possibleDuplicateResourceId).filter(Boolean)])];
  const bookingCounts = new Map<string, number>();
  if (relatedIds.length) {
    const [rows] = await pool.query<any[]>(`SELECT resource_id, COUNT(*) AS count FROM bookings WHERE resource_id IN (${relatedIds.map(() => '?').join(',')}) GROUP BY resource_id`, relatedIds);
    for (const row of rows) bookingCounts.set(String(row.resource_id), Number(row.count));
  }
  const [[deviceState]] = await pool.query<any[]>("SELECT payload FROM office_state WHERE state_key = 'devices'");
  const devices = deviceState ? (typeof deviceState.payload === 'string' ? JSON.parse(deviceState.payload) : deviceState.payload) : [];
  const deviceCounts = devices.reduce((map: Map<string, number>, device: any) => map.set(device.resourceId, (map.get(device.resourceId) || 0) + 1), new Map<string, number>());
  const confirmation = { decision: null, confirmedBy: null, confirmedAt: null, note: '' };
  const checklist = {
    generatedAt: new Date().toISOString(),
    sourceDiff: outputDiffPath,
    mappingStatus: 'AWAITING_RESPONSIBLE_PARTY_CONFIRMATION',
    c01: baselineDiff.resourceRows.filter((row: any) => row.matchStatus === 'LOCATION_CANDIDATE').map((row: any) => ({
      resourceId: row.id, resourceCode: row.code, resourceName: row.name, roomUid: row.candidates[0]?.uid || null,
      spatialName: row.candidates[0]?.label || null, ...confirmation
    })),
    c02: baselineDiff.resourceRows.filter((row: any) => row.nameStatus === 'SEMANTIC_CONFLICT').map((row: any) => ({
      resourceId: row.id, resourceCode: row.code, businessDisplayName: row.name, roomUid: row.candidates[0]?.uid || null,
      spatialName: row.candidates[0]?.label || null, dualNameApproved: null, ...confirmation
    })),
    c03: baselineDiff.resourceRows.filter((row: any) => row.scope === 'DEMAND_28' && row.matchStatus === 'MANUAL_MAPPING_REQUIRED').map((row: any) => ({
      resourceId: row.id, resourceCode: row.code, resourceName: row.name, sameFloorCandidates: row.candidates,
      recommendedAction: row.recommendedAction, selectedRoomUid: null, deferredReason: null, ...confirmation
    })),
    c04: baselineDiff.resourceRows.filter((row: any) => row.scope === 'ADDITIONAL_4').map((row: any) => ({
      resourceId: row.id, resourceName: row.name, possibleDuplicateResourceId: row.possibleDuplicateResourceId,
      presentInLive: liveById.has(row.id),
      bookingCount: bookingCounts.get(row.id) || 0, deviceCount: deviceCounts.get(row.id) || 0,
      possibleDuplicateBookingCount: bookingCounts.get(row.possibleDuplicateResourceId) || 0,
      possibleDuplicateDeviceCount: deviceCounts.get(row.possibleDuplicateResourceId) || 0,
      disposition: null, canonicalResourceId: null, ...confirmation
    })),
    c05: baselineDiff.unmatchedHq3dRooms.map((room: any) => ({
      roomUid: room.uid, spatialName: room.label, classification: room.classification,
      recommendedAction: room.recommendedAction, finalDisposition: null, ...confirmation
    })),
    c06: baselineDiff.resourceRows.filter((row: any) => row.scope === 'DEMAND_28' && row.status === 'PENDING').map((row: any) => ({
      resourceId: row.id, resourceCode: row.code, resourceName: row.name, currentCapacity: row.capacity,
      verifiedCapacity: null, equipmentVerified: false, openingRulesVerified: false, openingApproved: false, ...confirmation
    })),
    safeguards: [
      '所有空确认栏必须由责任方填写，不得由同步程序自动补齐',
      'C-03和C-04结论形成后必须重新运行差异，再最终处理C-05',
      '未建立resourceId与roomUid映射，未修改资源容量、状态或预约数据'
    ]
  };
  await writeFile(checklistPath, `${JSON.stringify(checklist, null, 2)}\n`);
  console.log(JSON.stringify({
    extract: outputExtractPath,
    diff: outputDiffPath,
    checklist: checklistPath,
    summary: diff.summary,
    c07: diff.c07Verification,
    checklistCounts: Object.fromEntries(['c01', 'c02', 'c03', 'c04', 'c05', 'c06'].map(key => [key, checklist[key].length]))
  }, null, 2));
} finally {
  await closeDbPool();
}
