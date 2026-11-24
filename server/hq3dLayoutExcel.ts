import ExcelJS from 'exceljs';
import { DbError } from './errors.ts';
import {
  exportHq3dLayout,
  parseHq3dLayoutDocument,
  type Hq3dLayoutDocument,
  type Hq3dLayoutFloor,
  type Hq3dLayoutScope
} from './hq3dLayoutImport.ts';
import type { Hq3dSeedRoom } from './hq3dLayout.ts';

const INFO_SHEET = '布局信息';
const FLOOR_SHEET = '楼层';
const ROOM_SHEET = '房间';
const FLOOR_HEADERS = ['楼层号', '楼层标签', '楼层Sheet'];
const ROOM_HEADERS = ['楼层号', '房间UID', '房号', '类别', '房间名称', '部门', '人员', '备注', '标签行', 'nx', 'nz', 'nw', 'nd', 'frac'];

const excelError = (message: string) => new DbError('INVALID_HQ3D_EXCEL', 400, { detail: message });

const cellValue = (cell: ExcelJS.Cell): string | number => {
  const value = cell.value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number') return value;
  if (typeof value === 'object' && 'richText' in value && Array.isArray(value.richText)) {
    return value.richText.map(part => part.text).join('');
  }
  if (typeof value === 'object' && 'text' in value && typeof value.text === 'string' && !('formula' in value)) return value.text;
  throw excelError(`单元格 ${cell.address} 使用了不受支持的公式或对象，请填写固定文本或数字。`);
};

const text = (cell: ExcelJS.Cell) => String(cellValue(cell)).trim();
const number = (cell: ExcelJS.Cell, field: string) => {
  const value = cellValue(cell);
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  throw excelError(`${cell.address}（${field}）必须是有效数字。`);
};

const styleHeader = (row: ExcelJS.Row) => {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF174A7C' } };
  row.alignment = { vertical: 'middle' };
  row.height = 24;
};

const addHeader = (sheet: ExcelJS.Worksheet, headers: string[]) => {
  const row = sheet.addRow(headers);
  styleHeader(row);
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
};

export const createHq3dLayoutExcel = async (documentValue: unknown): Promise<Buffer> => {
  const document = parseHq3dLayoutDocument(documentValue);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = '智慧办公空间管理系统';
  workbook.created = new Date(0);
  workbook.modified = new Date(0);

  const info = workbook.addWorksheet(INFO_SHEET);
  addHeader(info, ['字段', '值']);
  const infoRows: Array<[string, string | number]> = [
    ['格式', document.format],
    ['版本', document.schemaVersion],
    ['范围', document.scope.kind],
    ['楼栋ID', document.building.id],
    ['楼层号', document.scope.floorNo ?? ''],
    ['楼栋名称', document.building.name],
    ['楼栋宽高比', document.building.aspect],
    ['全楼楼层比例JSON', JSON.stringify(document.building.aspAll)]
  ];
  infoRows.forEach(row => info.addRow(row));
  info.columns = [{ width: 24 }, { width: 72 }];

  const floors = workbook.addWorksheet(FLOOR_SHEET);
  addHeader(floors, FLOOR_HEADERS);
  document.building.floors.forEach(floor => floors.addRow([floor.floorNo, floor.tag, floor.sheet]));
  floors.columns = [{ width: 12 }, { width: 16 }, { width: 36 }];

  const rooms = workbook.addWorksheet(ROOM_SHEET);
  addHeader(rooms, ROOM_HEADERS);
  document.building.floors.forEach(floor => floor.rooms.forEach(room => rooms.addRow([
    floor.floorNo, room.uid, room.no || '', room.cat, room.label, room.dept || '', room.person || '', room.notes || '',
    (room.lines || [room.label]).join('\n'), room.nx, room.nz, room.nw, room.nd, room.frac ?? 0
  ])));
  rooms.columns = [
    { width: 12 }, { width: 44 }, { width: 16 }, { width: 14 }, { width: 30 }, { width: 24 }, { width: 20 },
    { width: 36 }, { width: 32 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 12 }
  ];
  rooms.eachRow(row => { row.alignment = { vertical: 'top', wrapText: true }; });

  const guide = workbook.addWorksheet('填写说明');
  guide.columns = [{ width: 110 }];
  [
    '仅修改“布局信息”“楼层”“房间”三张表的值，不要修改格式、版本、表头或工作表名称。',
    '整栋导入必须保留全部现有楼层；单层导入只能保留目标楼层。新增、删除或重排楼层不在本模板能力范围内。',
    '既有房间请保留稳定UID。省略未绑定资源的房间会软停用；仍绑定预约资源的房间不能通过省略停用。',
    'nx/nz为左上角归一化坐标，nw/nd为归一化宽深，frac为本层面积占比。标签行使用单元格内换行分隔。',
    '新增房间不会自动成为可预约资源。保存为.xlsx后上传，必须完成服务端预检并人工确认才会正式导入。'
  ].forEach(line => guide.addRow([line]));

  return Buffer.from(await workbook.xlsx.writeBuffer());
};

const readHeaders = (sheet: ExcelJS.Worksheet | undefined, expected: string[], sheetName: string) => {
  if (!sheet) throw excelError(`缺少“${sheetName}”工作表，请使用系统导出的Excel模板。`);
  const actual = expected.map((_, index) => text(sheet.getRow(1).getCell(index + 1)));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw excelError(`“${sheetName}”工作表表头已改变，请重新导出模板。`);
  return sheet;
};

const loadHq3dWorkbook = async (buffer: Buffer) => {
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) throw excelError('文件不是有效的XLSX工作簿，请使用系统模板或原生楼层图Excel。');
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw excelError('Excel文件无法读取，请确认文件未损坏且格式为.xlsx。');
  }
  return workbook;
};

const parseHq3dLayoutTemplate = (workbook: ExcelJS.Workbook): Hq3dLayoutDocument => {
  const info = readHeaders(workbook.getWorksheet(INFO_SHEET), ['字段', '值'], INFO_SHEET);
  const floorSheet = readHeaders(workbook.getWorksheet(FLOOR_SHEET), FLOOR_HEADERS, FLOOR_SHEET);
  const roomSheet = readHeaders(workbook.getWorksheet(ROOM_SHEET), ROOM_HEADERS, ROOM_SHEET);
  const metadata = new Map<string, string | number>();
  info.eachRow((row, rowNumber) => {
    if (rowNumber > 1) metadata.set(text(row.getCell(1)), cellValue(row.getCell(2)));
  });
  const requiredText = (key: string) => {
    const value = metadata.get(key);
    if (value === undefined || String(value).trim() === '') throw excelError(`布局信息缺少“${key}”。`);
    return String(value).trim();
  };
  let aspAll: unknown;
  try { aspAll = JSON.parse(requiredText('全楼楼层比例JSON')); } catch { throw excelError('全楼楼层比例JSON不是有效数字数组。'); }
  const scopeKind = requiredText('范围');
  if (scopeKind !== 'BUILDING' && scopeKind !== 'FLOOR') throw excelError('范围仅支持BUILDING或FLOOR。');
  const floorNoText = String(metadata.get('楼层号') ?? '').trim();
  const scopeFloorNo = scopeKind === 'FLOOR' ? Number(floorNoText) : undefined;
  if (scopeKind === 'FLOOR' && !Number.isSafeInteger(scopeFloorNo)) throw excelError('单层导入的布局信息必须填写有效楼层号。');

  const floors: Hq3dLayoutFloor[] = [];
  floorSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1 || row.cellCount === 0) return;
    floors.push({
      floorNo: number(row.getCell(1), '楼层号'),
      tag: text(row.getCell(2)),
      sheet: text(row.getCell(3)),
      rooms: []
    });
  });
  const floorMap = new Map(floors.map(floor => [floor.floorNo, floor]));
  roomSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1 || row.cellCount === 0) return;
    const floorNo = number(row.getCell(1), '房间所属楼层号');
    const floor = floorMap.get(floorNo);
    if (!floor) throw excelError(`房间第${rowNumber}行引用了不存在的楼层 ${floorNo}。`);
    const label = text(row.getCell(5));
    const linesText = text(row.getCell(9));
    const room: Hq3dSeedRoom = {
      uid: text(row.getCell(2)),
      no: text(row.getCell(3)),
      cat: text(row.getCell(4)),
      label,
      dept: text(row.getCell(6)),
      person: text(row.getCell(7)),
      notes: text(row.getCell(8)),
      lines: linesText ? linesText.split(/\r?\n/) : [label],
      nx: number(row.getCell(10), 'nx'),
      nz: number(row.getCell(11), 'nz'),
      nw: number(row.getCell(12), 'nw'),
      nd: number(row.getCell(13), 'nd'),
      frac: number(row.getCell(14), 'frac')
    };
    floor.rooms.push(room);
  });

  return parseHq3dLayoutDocument({
    format: requiredText('格式'),
    schemaVersion: Number(metadata.get('版本')),
    scope: { kind: scopeKind, buildingId: requiredText('楼栋ID'), floorNo: scopeFloorNo },
    building: {
      id: requiredText('楼栋ID'),
      name: requiredText('楼栋名称'),
      aspect: Number(metadata.get('楼栋宽高比')),
      aspAll,
      floors
    }
  });
};

type Rectangle = { left: number; top: number; right: number; bottom: number };
type FloorplanCell = { rect: Rectangle; lines: string[] };
type SheetCandidate = { sheet: ExcelJS.Worksheet; floorNo: number; version: string; priority: number };
type RoomSemantics = Pick<Hq3dSeedRoom, 'no' | 'cat' | 'label' | 'dept' | 'person' | 'notes' | 'lines'>;

export type Hq3dLayoutExcelRecognition = {
  layout: Hq3dLayoutDocument;
  notices: string[];
  recognizedRooms: number;
  createdRooms: number;
};

const COLUMN_GAP_PX = 5;
const rounded = (value: number) => Number(value.toFixed(4));
const compact = (value: string) => value.toLocaleLowerCase().replace(/[\s#_\-—–·,，。/\\（）()[\]【】]/g, '');
const normalizeLines = (value: string) => value.split(/\r?\n/).map(line => line.trim().replace(/[\t ]+/g, ' ')).filter(Boolean);

const columnNumber = (letters: string) => [...letters.toLocaleUpperCase()].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0);
const parseRange = (value: string): Rectangle | null => {
  const match = value.replace(/\$/g, '').split('!').at(-1)?.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i);
  if (!match) return null;
  return { left: columnNumber(match[1]), top: Number(match[2]), right: columnNumber(match[3]), bottom: Number(match[4]) };
};
const clipRectangle = (rect: Rectangle, bounds: Rectangle): Rectangle => ({
  left: Math.max(rect.left, bounds.left),
  top: Math.max(rect.top, bounds.top),
  right: Math.min(rect.right, bounds.right),
  bottom: Math.min(rect.bottom, bounds.bottom)
});

const chineseFloorNumber = (value: string) => {
  const digits: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (value === '十') return 10;
  if (value.includes('十')) {
    const [tens, ones] = value.split('十');
    return (tens ? digits[tens] : 1) * 10 + (ones ? digits[ones] : 0);
  }
  return digits[value] || 0;
};

const sheetCandidate = (sheet: ExcelJS.Worksheet, buildingName: string): SheetCandidate | null => {
  const match = sheet.name.replace(/\s+/g, '').match(/^(.+?)([一二三四五六七八九十]+)层(?:[（(](新|旧|全|部分)[）)])?$/);
  if (!match) return null;
  const prefix = match[1];
  const normalizedBuilding = buildingName.replace(/\s+/g, '');
  if (!normalizedBuilding.includes(prefix) && !prefix.includes(normalizedBuilding)) return null;
  const floorNo = chineseFloorNumber(match[2]);
  if (!floorNo) return null;
  const version = match[3] || '';
  const priority = { 新: 4, 全: 3, '': 2, 部分: 1, 旧: 0 }[version]!;
  return { sheet, floorNo, version, priority };
};

const mergedRectangles = (sheet: ExcelJS.Worksheet) => {
  const ranges = new Map<string, Rectangle>();
  for (const merge of sheet.model.merges || []) {
    const rect = parseRange(merge);
    if (rect) ranges.set(`${rect.left}:${rect.top}`, rect);
  }
  return ranges;
};

const usedBounds = (sheet: ExcelJS.Worksheet, merges: Map<string, Rectangle>): Rectangle | null => {
  let bounds: Rectangle | null = null;
  const include = (rect: Rectangle) => {
    if (!bounds) bounds = { ...rect };
    else {
      bounds.left = Math.min(bounds.left, rect.left);
      bounds.top = Math.min(bounds.top, rect.top);
      bounds.right = Math.max(bounds.right, rect.right);
      bounds.bottom = Math.max(bounds.bottom, rect.bottom);
    }
  };
  sheet.eachRow({ includeEmpty: false }, row => row.eachCell({ includeEmpty: false }, cell => {
    if (cell.master !== cell || !text(cell)) return;
    include(merges.get(`${cell.col}:${cell.row}`) || { left: Number(cell.col), top: Number(cell.row), right: Number(cell.col), bottom: Number(cell.row) });
  }));
  return bounds;
};

const readFloorplanCells = (sheet: ExcelJS.Worksheet): { cells: FloorplanCell[]; bounds: Rectangle } => {
  const merges = mergedRectangles(sheet);
  const printArea = sheet.pageSetup.printArea ? parseRange(sheet.pageSetup.printArea) : null;
  const bounds = printArea || usedBounds(sheet, merges);
  if (!bounds) throw excelError(`“${sheet.name}”没有可识别的打印区域或房间标注。`);
  const cells: FloorplanCell[] = [];
  for (let rowNumber = bounds.top; rowNumber <= bounds.bottom; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    for (let columnNumber = bounds.left; columnNumber <= bounds.right; columnNumber += 1) {
      const cell = row.getCell(columnNumber);
      if (cell.master !== cell || rowNumber <= 3) continue;
      const value = text(cell);
      if (!value) continue;
      const rect = clipRectangle(merges.get(`${cell.col}:${cell.row}`) || {
        left: Number(cell.col), top: Number(cell.row), right: Number(cell.col), bottom: Number(cell.row)
      }, bounds);
      if (rect.right < rect.left || rect.bottom < rect.top) continue;
      cells.push({ rect, lines: normalizeLines(value) });
    }
  }
  if (!cells.length) throw excelError(`“${sheet.name}”的打印区域内未识别到房间标注。`);
  return { cells, bounds };
};

const categoryFor = (value: string) => {
  if (/楼\s*梯/.test(value) || compact(value) === '楼梯') return 'stair';
  if (value.includes('电') && value.includes('梯')) return 'lift';
  if (/卫生间|洗手间|厕所/.test(value)) return 'wc';
  if (/餐厅|水房|后厨/.test(value)) return 'dining';
  if (/休息区/.test(value)) return 'welfare';
  if (/会议室|接待室|会服间|礼堂|签约大厅|贵宾会见厅/.test(value)) return 'meeting';
  if (/文档档案室/.test(value)) return 'archive';
  if (/库房|配电室|保卫科|机房|监控室|机要室|设备|物业|气体保护|控制室|备用间|储藏室|音控室|传票室|空房/.test(value)) return 'support';
  if (/前台/.test(value)) return 'front';
  if (/公司领导|董事|首席/.test(value)) return 'exec';
  if (/党建|党委|巡察|工会/.test(value)) return 'party';
  if (/办公区/.test(value)) return 'open';
  return '';
};

const roomSemantics = (lines: string[], fallbackCategory = ''): RoomSemantics => {
  const joined = lines.join('\n');
  const cat = categoryFor(joined) || fallbackCategory || 'office';
  const numberMatch = lines[0]?.match(/^([A-Za-z]?\d{2,4}[A-Za-z]?)(.*)$/);
  const no = numberMatch && !/^\d{4}[./-]\d{1,2}/.test(lines[0]) ? numberMatch[1] : '';
  const content = [numberMatch && no ? numberMatch[2].trim() : lines[0], ...lines.slice(1)].filter(Boolean);
  const notes = content.filter(line => /^(借用|暂借)$/.test(line)).join(' ');
  const details = content.filter(line => !/^(借用|暂借)$/.test(line));
  const compactLines = compact(lines.join(''));
  const utilityLabel = cat === 'stair' ? '楼梯' : cat === 'lift' ? '电梯' : compactLines === '库房' ? '库房' : '';
  const label = utilityLabel || details[0] || '未标注';
  const dept = ['office', 'meeting', 'open'].includes(cat) ? details[0] || label : '';
  const person = !utilityLabel && details.length > 1 && !/^[（(]/.test(details[1]) ? details.slice(1).join(' ') : '';
  const normalizedLines = utilityLabel && cat !== 'lift' ? [utilityLabel] : lines;
  return { no, cat, label, dept, person, notes, lines: normalizedLines };
};

const centerDistance = (rect: Rectangle, room: Hq3dSeedRoom) => {
  const x = (rect.left + rect.right) / 2;
  const y = (rect.top + rect.bottom) / 2;
  return (x - room.nx) ** 2 + (y - room.nz) ** 2;
};

const overlapRatio = (rect: Rectangle, room: Hq3dSeedRoom) => {
  const width = Math.max(0, Math.min(rect.right, room.nx + room.nw) - Math.max(rect.left, room.nx));
  const height = Math.max(0, Math.min(rect.bottom, room.nz + room.nd) - Math.max(rect.top, room.nz));
  return width * height / Math.min((rect.right - rect.left) * (rect.bottom - rect.top), room.nw * room.nd);
};

const matchRoom = (
  current: Hq3dSeedRoom[],
  remaining: Set<string>,
  semantic: RoomSemantics,
  geometry: Pick<Hq3dSeedRoom, 'nx' | 'nz' | 'nw' | 'nd'>
) => {
  const rect = { left: geometry.nx, top: geometry.nz, right: geometry.nx + geometry.nw, bottom: geometry.nz + geometry.nd };
  const available = current.filter(room => remaining.has(room.uid));
  const nearest = (rooms: Hq3dSeedRoom[]) => rooms.length
    ? rooms.reduce((best, room) => centerDistance(rect, room) < centerDistance(rect, best) ? room : best)
    : undefined;
  const sameNumber = semantic.no ? available.filter(room => compact(room.no || '') === compact(semantic.no!)) : [];
  if (sameNumber.length) {
    const sameLabel = sameNumber.filter(room => compact(room.label) === compact(semantic.label));
    return nearest(sameLabel.length ? sameLabel : sameNumber);
  }
  const sameLabel = available.filter(room => compact(room.label) === compact(semantic.label));
  if (sameLabel.length) return nearest(sameLabel);
  return nearest(available.filter(room => room.cat === semantic.cat && overlapRatio(rect, room) >= 0.5));
};

const recognizeFloor = (
  base: Hq3dLayoutDocument,
  floor: Hq3dLayoutFloor,
  sheet: ExcelJS.Worksheet,
  usedUids: Set<string>
) => {
  const { cells, bounds } = readFloorplanCells(sheet);
  const top = Math.min(...cells.map(cell => cell.rect.top));
  const bottom = Math.max(...cells.map(cell => cell.rect.bottom));
  const columnWidth = (column: number) => (sheet.getColumn(column).width ?? 8.43) * 7 + 5;
  const rowHeight = (row: number) => sheet.getRow(row).height ?? 15;
  const span = (start: number, end: number, size: (index: number) => number) => {
    let total = 0;
    for (let index = start; index <= end; index += 1) total += size(index);
    return total;
  };
  const totalWidth = span(bounds.left, bounds.right, columnWidth) - COLUMN_GAP_PX;
  const totalHeight = span(top, bottom, rowHeight);
  if (totalWidth <= 0 || totalHeight <= 0) throw excelError(`“${sheet.name}”的行高或列宽无法换算房间坐标。`);
  const measured = cells.map(cell => {
    const width = Math.max(1, span(cell.rect.left, cell.rect.right, columnWidth) - COLUMN_GAP_PX);
    const height = span(cell.rect.top, cell.rect.bottom, rowHeight);
    return {
      ...cell,
      area: width * height,
      geometry: {
        nx: rounded(span(bounds.left, cell.rect.left - 1, columnWidth) / totalWidth),
        nz: rounded(span(top, cell.rect.top - 1, rowHeight) / totalHeight),
        nw: rounded(width / totalWidth),
        nd: rounded(height / totalHeight)
      }
    };
  });
  const totalArea = measured.reduce((total, cell) => total + cell.area, 0);
  const remaining = new Set(floor.rooms.map(room => room.uid));
  let createdRooms = 0;
  const rooms = measured.map(cell => {
    const detected = roomSemantics(cell.lines);
    const matched = matchRoom(floor.rooms, remaining, detected, cell.geometry);
    if (matched) remaining.delete(matched.uid);
    else createdRooms += 1;
    const sameText = matched && normalizeLines((matched.lines || [matched.label]).join('\n')).join('\n') === detected.lines.join('\n');
    const semantic = sameText ? {
      no: matched.no || '', cat: matched.cat, label: matched.label, dept: matched.dept || '', person: matched.person || '',
      notes: matched.notes || '', lines: [...(matched.lines || [matched.label])]
    } : roomSemantics(cell.lines, matched?.cat);
    const labelKey = semantic.label.replace(/\s/g, '');
    const uidBase = `${base.building.id}#${floor.tag}#${semantic.no || '_'}#${labelKey}`;
    let uid = matched?.uid || uidBase;
    if (!matched) for (let suffix = 2; usedUids.has(uid); suffix += 1) uid = `${uidBase}#${suffix}`;
    usedUids.add(uid);
    return {
      uid,
      ...semantic,
      ...cell.geometry,
      frac: rounded(cell.area / totalArea)
    };
  });
  return { floor: { ...floor, sheet: sheet.name.trim(), rooms }, createdRooms };
};

export const buildHq3dLayoutFromFloorplan = (
  baseValue: unknown,
  workbook: ExcelJS.Workbook
): Hq3dLayoutExcelRecognition => {
  const base = parseHq3dLayoutDocument(baseValue);
  const candidates = workbook.worksheets.map(sheet => sheetCandidate(sheet, base.building.name)).filter((item): item is SheetCandidate => Boolean(item));
  const targetFloors = base.scope.kind === 'FLOOR'
    ? base.building.floors.filter(floor => floor.floorNo === base.scope.floorNo)
    : base.building.floors;
  const usedUids = new Set(base.building.floors.flatMap(floor => floor.rooms.map(room => room.uid)));
  const versionNotices: string[] = [];
  let createdRooms = 0;
  const floors = targetFloors.map(floor => {
    const choices = candidates.filter(candidate => candidate.floorNo === floor.floorNo).sort((a, b) => b.priority - a.priority);
    if (!choices.length) throw excelError(`附件中缺少${base.building.name}${floor.floorNo}层对应的工作表。`);
    if (choices[1]?.priority === choices[0].priority) throw excelError(`“${choices[0].sheet.name}”与“${choices[1].sheet.name}”版本优先级相同，请只保留一个有效版本。`);
    if (choices.length > 1) versionNotices.push(`${floor.floorNo}F选用“${choices[0].sheet.name}”`);
    const recognized = recognizeFloor(base, floor, choices[0].sheet, usedUids);
    createdRooms += recognized.createdRooms;
    return recognized.floor;
  });
  const recognizedRooms = floors.reduce((total, floor) => total + floor.rooms.length, 0);
  return {
    layout: parseHq3dLayoutDocument({ ...base, building: { ...base.building, floors } }),
    notices: [
      `已按原生楼层图Excel识别${floors.length}个楼层、${recognizedRooms}间空间，其中${createdRooms}间未匹配既有UID。`,
      ...(versionNotices.length ? [`重复楼层版本已自动选择：${versionNotices.join('；')}。`] : []),
      '房间位置按打印区域、合并单元格、行高和列宽换算；请在预检中核对文字、类别与坐标，确认后才会导入。',
      '新增空间仅更新3D布局，不会自动成为可预约资源。'
    ],
    recognizedRooms,
    createdRooms
  };
};

const isTemplateWorkbook = (workbook: ExcelJS.Workbook) =>
  [INFO_SHEET, FLOOR_SHEET, ROOM_SHEET].some(name => Boolean(workbook.getWorksheet(name)));

export const parseHq3dLayoutExcelUpload = async (buffer: Buffer, scopeValue?: unknown): Promise<Hq3dLayoutExcelRecognition> => {
  const workbook = await loadHq3dWorkbook(buffer);
  if (isTemplateWorkbook(workbook)) {
    return { layout: parseHq3dLayoutTemplate(workbook), notices: [], recognizedRooms: 0, createdRooms: 0 };
  }
  if (!scopeValue) throw excelError('原生楼层图Excel需要在导入对话框中选择整栋或单层更新范围。');
  const scope = scopeValue as Hq3dLayoutScope;
  const base = await exportHq3dLayout(scope);
  return buildHq3dLayoutFromFloorplan(base, workbook);
};

export const parseHq3dLayoutExcel = async (buffer: Buffer): Promise<Hq3dLayoutDocument> =>
  (await parseHq3dLayoutExcelUpload(buffer)).layout;
