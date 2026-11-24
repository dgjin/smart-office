import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import ExcelJS from 'exceljs';
import { createHq3dLayoutExcel, buildHq3dLayoutFromFloorplan, parseHq3dLayoutExcel } from '../server/hq3dLayoutExcel.ts';
import { buildHq3dLayoutFromOcr, readHq3dImageDimensions } from '../server/hq3dLayoutOcr.ts';
import type { Hq3dLayoutDocument } from '../server/hq3dLayoutImport.ts';

const document = (): Hq3dLayoutDocument => ({
  format: 'smart-office.hq3d-layout',
  schemaVersion: 1,
  scope: { kind: 'FLOOR', buildingId: 'main', floorNo: 1 },
  building: {
    id: 'main',
    name: '主楼',
    aspect: 1.4,
    aspAll: [1.4],
    floors: [{
      floorNo: 1,
      tag: '1F',
      sheet: '主楼一层',
      rooms: [{
        uid: 'main#1F#101#会议室', no: '101', cat: 'meeting', label: '会议室', dept: '综合管理部', person: '',
        notes: '', lines: ['会议室'], nx: 0.05, nz: 0.08, nw: 0.3, nd: 0.35, frac: 0.16
      }]
    }]
  }
});

const addFloorplanSheet = (
  workbook: ExcelJS.Workbook,
  name: string,
  rooms: Array<[string, string]>,
  printArea: string | undefined = 'B1:J25'
) => {
  const sheet = workbook.addWorksheet(name);
  for (let column = 2; column <= 10; column += 1) sheet.getColumn(column).width = 10;
  for (let row = 4; row <= 24; row += 1) sheet.getRow(row).height = 20;
  sheet.mergeCells('B1:J2');
  sheet.getCell('B1').value = name.replace(/[（(].*[）)]/, '');
  rooms.forEach(([range, value]) => {
    sheet.mergeCells(range);
    sheet.getCell(range.split(':')[0]).value = value;
  });
  if (printArea) sheet.pageSetup.printArea = printArea;
  return sheet;
};

const buildingDocument = (): Hq3dLayoutDocument => {
  const result = document();
  result.scope = { kind: 'BUILDING', buildingId: 'main' };
  result.building.aspAll = [1.4, 1.4, 1.4];
  result.building.floors = [1, 2, 14].map(floorNo => ({
    floorNo,
    tag: `${floorNo}F`,
    sheet: `主楼${floorNo}层`,
    rooms: [{
      uid: `main#${floorNo}F#${floorNo === 14 ? '_' : floorNo === 1 ? '101' : '201'}#会议室`,
      no: floorNo === 14 ? '' : floorNo === 1 ? '101' : '201',
      cat: 'meeting', label: '会议室', dept: '会议室', person: '', notes: '', lines: ['会议室'],
      nx: 0, nz: 0, nw: 0.4, nd: 0.4, frac: 1
    }]
  }));
  return result;
};

describe('总部3D Excel与图片识别转换', () => {
  it('Excel整层模板往返保留范围、元数据、空房间与全部布局字段', async () => {
    const original = document();
    original.building.floors[0].rooms[0].lines = ['会议室', '综合管理部'];
    const buffer = await createHq3dLayoutExcel(original);
    assert.ok(buffer.length > 1000);
    assert.deepEqual(await parseHq3dLayoutExcel(buffer), original);

    const empty = document();
    empty.building.floors[0].rooms = [];
    assert.deepEqual(await parseHq3dLayoutExcel(await createHq3dLayoutExcel(empty)), empty);
  });

  it('拒绝仅修改扩展名的伪Excel文件', async () => {
    await assert.rejects(() => parseHq3dLayoutExcel(Buffer.from('{"not":"xlsx"}')), /INVALID_HQ3D_EXCEL/);
  });

  it('原生楼层图按单层范围、打印区域和合并单元格识别并沿用既有UID', () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('封皮').getCell('B4').value = '999封皮杂值';
    const sheet = addFloorplanSheet(workbook, '主楼一层', [
      ['B4:D6', '101\n会议室'],
      ['F4:G6', '102\n文档保密室'],
      ['B8:C10', '楼\n梯']
    ]);
    sheet.getCell('K9').value = '999打印区域外杂值';
    addFloorplanSheet(workbook, '主楼二层', [['B4:D6', '201\n会议室']]);

    const result = buildHq3dLayoutFromFloorplan(document(), workbook);
    assert.equal(result.layout.building.floors.length, 1);
    assert.equal(result.recognizedRooms, 3);
    assert.equal(result.createdRooms, 2);
    const rooms = result.layout.building.floors[0].rooms;
    assert.equal(rooms[0].uid, 'main#1F#101#会议室');
    assert.equal(rooms[0].no, '101');
    assert.equal(rooms[0].nz, 0);
    assert.equal(rooms[0].nd, 0.4286);
    assert.equal(rooms[1].label, '文档保密室');
    assert.equal(rooms[2].label, '楼梯');
    assert.equal(rooms[2].person, '');
    assert.ok(rooms.every(room => room.no !== '999'));
    assert.ok(Math.abs(rooms.reduce((total, room) => total + (room.frac || 0), 0) - 1) < 0.001);
  });

  it('原生楼层图整栋识别优先二层全量与十四层新版并兼容无打印区域工作表', () => {
    const workbook = new ExcelJS.Workbook();
    addFloorplanSheet(workbook, '主楼一层', [['B4:D6', '101\n会议室']]);
    addFloorplanSheet(workbook, '主楼二层 (部分)', [['B4:D6', '999\n不应导入']]);
    addFloorplanSheet(workbook, '主楼二层（全）', [
      ['B4:D6', '201\n会议室'], ['F4:G6', '202\n办公室']
    ], undefined);
    addFloorplanSheet(workbook, '主楼十四层', [['B4:D6', '会议室(8人)']]);
    addFloorplanSheet(workbook, '主楼十四层（新）', [['B4:D6', '会议室(24人)']], undefined);

    const result = buildHq3dLayoutFromFloorplan(buildingDocument(), workbook);
    assert.deepEqual(result.layout.building.floors.map(floor => floor.floorNo), [1, 2, 14]);
    assert.equal(result.layout.building.floors[1].sheet, '主楼二层（全）');
    assert.deepEqual(result.layout.building.floors[1].rooms.map(room => room.no), ['201', '202']);
    assert.equal(result.layout.building.floors[1].rooms[0].uid, 'main#2F#201#会议室');
    assert.equal(result.layout.building.floors[2].sheet, '主楼十四层（新）');
    assert.equal(result.layout.building.floors[2].rooms[0].uid, 'main#14F#_#会议室');
    assert.equal(result.layout.building.floors[2].rooms[0].label, '会议室(24人)');
    assert.match(result.notices.join(''), /2F选用“主楼二层（全）”/);
    assert.match(result.notices.join(''), /14F选用“主楼十四层（新）”/);
  });

  it('原生楼层图整栋导入缺少现有楼层时拒绝识别', () => {
    const workbook = new ExcelJS.Workbook();
    addFloorplanSheet(workbook, '主楼一层', [['B4:D6', '101\n会议室']]);
    assert.throws(() => buildHq3dLayoutFromFloorplan(buildingDocument(), workbook), (error: any) => {
      assert.equal(error.message, 'INVALID_HQ3D_EXCEL');
      assert.match(error.details.detail, /缺少主楼2层/);
      return true;
    });
  });
  it('图片OCR只追加新房间并保留全部未识别现有房间', () => {
    const result = buildHq3dLayoutFromOcr(document(), [{
      text: '103 图片会议室', confidence: 96, bbox: { x0: 400, y0: 240, x1: 590, y1: 280 }
    }], { width: 1000, height: 700 });
    assert.equal(result.recognizedRooms, 1);
    assert.equal(result.createdRooms, 1);
    assert.equal(result.preservedRooms, 1);
    assert.equal(result.layout.building.floors[0].rooms.length, 2);
    assert.equal(result.layout.building.floors[0].rooms[0].uid, 'main#1F#101#会议室');
    const created = result.layout.building.floors[0].rooms[1];
    assert.equal(created.no, '103');
    assert.equal(created.label, '103 图片会议室');
    assert.ok(created.nx >= 0 && created.nx + created.nw <= 1);
    assert.ok(created.nz >= 0 && created.nz + created.nd <= 1);
    assert.match(result.notices.join(''), /不会因漏识别而停用/);
  });

  it('图片OCR沿用匹配房间且重复新标注不重复创建', () => {
    const result = buildHq3dLayoutFromOcr(document(), [
      { text: '101 会议室', confidence: 95, bbox: { x0: 10, y0: 10, x1: 100, y1: 30 } },
      { text: '103 图片会议室', confidence: 95, bbox: { x0: 100, y0: 100, x1: 240, y1: 130 } },
      { text: '103 图片会议室', confidence: 95, bbox: { x0: 100, y0: 100, x1: 240, y1: 130 } }
    ], { width: 1000, height: 700 });
    assert.equal(result.createdRooms, 1);
    assert.equal(result.preservedRooms, 0);
    assert.equal(result.layout.building.floors[0].rooms.length, 2);
  });

  it('合并上下相邻的房号与房名并保留完整标注几何', () => {
    const result = buildHq3dLayoutFromOcr(document(), [
      { text: '101', confidence: 90, bbox: { x0: 184, y0: 152, x1: 246, y1: 189 } },
      { text: '103', confidence: 90, bbox: { x0: 747, y0: 152, x1: 821, y1: 189 } },
      { text: '会议室', confidence: 96, bbox: { x0: 166, y0: 230, x1: 265, y1: 261 } },
      { text: '图片会议室', confidence: 96, bbox: { x0: 704, y0: 230, x1: 866, y1: 261 } }
    ], { width: 1000, height: 700 });
    assert.equal(result.recognizedRooms, 2);
    assert.equal(result.createdRooms, 1);
    assert.equal(result.preservedRooms, 0);
    const created = result.layout.building.floors[0].rooms[1];
    assert.equal(created.label, '103 图片会议室');
    assert.equal(created.no, '103');
    assert.ok(created.nx <= 0.704 && created.nx + created.nw >= 0.866);
    assert.ok(created.nz <= 0.152 && created.nz + created.nd >= 0.261);
  });

  it('图片仅接受真实PNG或JPEG头并限制尺寸', () => {
    assert.throws(() => readHq3dImageDimensions(Buffer.from('not an image')), /HQ3D_LAYOUT_IMAGE_FORMAT/);
    const png = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png);
    png.writeUInt32BE(1000, 16);
    png.writeUInt32BE(700, 20);
    assert.deepEqual(readHq3dImageDimensions(png), { width: 1000, height: 700 });
  });
});
