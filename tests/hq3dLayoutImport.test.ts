import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import type { Hq3dSeedData, Hq3dSeedRoom } from '../server/hq3dLayout.ts';
import { parseHq3dLayoutDocument } from '../server/hq3dLayoutImport.ts';

const room = (uid = 'main#1F#_#会议室'): Hq3dSeedRoom => ({
  uid,
  no: '101',
  cat: 'meeting',
  label: '会议室',
  dept: '',
  person: '',
  notes: '',
  lines: ['会议室'],
  nx: 0,
  nz: 0,
  nw: 0.4,
  nd: 0.4,
  frac: 0.16
});
const floorDocument = () => ({
  format: 'smart-office.hq3d-layout',
  schemaVersion: 1,
  scope: { kind: 'FLOOR', buildingId: 'main', floorNo: 1 },
  building: {
    id: 'main',
    name: '主楼',
    aspect: 1.4,
    aspAll: [1.4],
    floors: [{ floorNo: 1, tag: '1F', sheet: '主楼一层', rooms: [room()] }]
  }
});

describe('总部3D布局文件校验', () => {
  it('接受版本化单层文件并补齐可选字段', () => {
    const document = floorDocument();
    const parsed = parseHq3dLayoutDocument(document);
    assert.equal(parsed.scope.kind, 'FLOOR');
    assert.equal(parsed.building.floors[0].rooms[0].uid, room().uid);
    assert.deepEqual(parsed.building.floors[0].rooms[0].lines, ['会议室']);
  });

  it('拒绝越界几何、重复UID和跨楼层声明', () => {
    const geometry = floorDocument();
    geometry.building.floors[0].rooms[0].nx = 0.8;
    assert.throws(() => parseHq3dLayoutDocument(geometry), /INVALID_HQ3D_LAYOUT/);

    const duplicate = floorDocument();
    duplicate.building.floors[0].rooms.push(room());
    assert.throws(() => parseHq3dLayoutDocument(duplicate), /INVALID_HQ3D_LAYOUT/);

    const wrongFloor = floorDocument();
    wrongFloor.building.floors[0].floorNo = 2;
    assert.throws(() => parseHq3dLayoutDocument(wrongFloor), /INVALID_HQ3D_LAYOUT/);
  });

  it('权威427间基线可直接转换为整栋和单层导入文件', async () => {
    const data = JSON.parse(await readFile(new URL('../server/data/hq3d-floorplan.json', import.meta.url), 'utf8')) as Hq3dSeedData;
    let rooms = 0;
    for (const building of data.buildings) {
      const floors = building.floors.map((floor, index) => ({ ...floor, floorNo: index + 1, tag: `${index + 1}F` }));
      const parsed = parseHq3dLayoutDocument({
        format: 'smart-office.hq3d-layout',
        schemaVersion: 1,
        scope: { kind: 'BUILDING', buildingId: building.id },
        building: { ...building, floors }
      });
      rooms += parsed.building.floors.flatMap(floor => floor.rooms).length;
      for (const floor of floors) {
        const single = parseHq3dLayoutDocument({
          format: 'smart-office.hq3d-layout',
          schemaVersion: 1,
          scope: { kind: 'FLOOR', buildingId: building.id, floorNo: floor.floorNo },
          building: { ...building, floors: [floor] }
        });
        assert.equal(single.building.floors.length, 1);
      }
    }
    assert.equal(rooms, 427);
  });
});
