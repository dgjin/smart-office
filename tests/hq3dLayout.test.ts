import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { validateHq3dLayout, type Hq3dSeedData } from '../server/hq3dLayout.ts';

const layoutPath = new URL('../server/data/hq3d-floorplan.json', import.meta.url);

describe('总部3D显式UID布局基线', () => {
  it('427个空间均有唯一显式UID', async () => {
    const data = JSON.parse(await readFile(layoutPath, 'utf8')) as Hq3dSeedData;
    const uids = validateHq3dLayout(data);
    const rooms = data.buildings.flatMap(building => building.floors.flatMap(floor => floor.rooms));
    assert.equal(rooms.length, 427);
    assert.equal(uids.size, 427);
    assert.ok(rooms.every(room => room.uid));
  });

  it('缺失或重复UID会在写库前拒绝', async () => {
    const data = JSON.parse(await readFile(layoutPath, 'utf8')) as Hq3dSeedData;
    const missing = structuredClone(data);
    delete (missing.buildings[0].floors[0].rooms[0] as Partial<Hq3dSeedData['buildings'][number]['floors'][number]['rooms'][number]>).uid;
    assert.throws(() => validateHq3dLayout(missing), /无效3D空间UID/);

    const duplicate = structuredClone(data);
    duplicate.buildings[0].floors[0].rooms[1].uid = duplicate.buildings[0].floors[0].rooms[0].uid;
    assert.throws(() => validateHq3dLayout(duplicate), /3D空间UID重复/);
  });
});
