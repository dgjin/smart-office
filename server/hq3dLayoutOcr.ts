import { createRequire } from 'node:module';
import { createWorker, OEM, PSM, type Line } from 'tesseract.js';
import { DbError } from './errors.ts';
import {
  exportHq3dLayout,
  parseHq3dLayoutDocument,
  type Hq3dLayoutDocument,
  type Hq3dLayoutScope
} from './hq3dLayoutImport.ts';
import type { Hq3dSeedRoom } from './hq3dLayout.ts';

const require = createRequire(import.meta.url);
const { langPath } = require('@tesseract.js-data/chi_sim') as { langPath: string };
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 24_000_000;

export type Hq3dOcrLine = {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  textLines?: string[];
};

export type Hq3dImageRecognition = {
  layout: Hq3dLayoutDocument;
  notices: string[];
  recognizedRooms: number;
  createdRooms: number;
  preservedRooms: number;
};

const imageError = (code: string, message: string) => new DbError(code, 400, { detail: message });
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const rounded = (value: number) => Number(value.toFixed(6));
const compact = (value: string) => value.toLocaleLowerCase().replace(/[\s#_\-—–·,，。/\\（）()[\]【】|‖]/g, '');

const pngDimensions = (buffer: Buffer) => {
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
};

const jpegDimensions = (buffer: Buffer) => {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  const sofMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  while (offset + 3 < buffer.length) {
    if (buffer[offset] !== 0xff) return null;
    const marker = buffer[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue;
    if (offset + 2 > buffer.length) return null;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) return null;
    if (sofMarkers.has(marker)) {
      if (length < 7) return null;
      return { height: buffer.readUInt16BE(offset + 3), width: buffer.readUInt16BE(offset + 5) };
    }
    offset += length;
  }
  return null;
};

export const readHq3dImageDimensions = (buffer: Buffer) => {
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) throw imageError('HQ3D_LAYOUT_IMAGE_SIZE', '图片不能为空且不能超过8 MiB。');
  const dimensions = pngDimensions(buffer) || jpegDimensions(buffer);
  if (!dimensions || !dimensions.width || !dimensions.height) {
    throw imageError('HQ3D_LAYOUT_IMAGE_FORMAT', '仅支持有效的PNG或JPEG图片，不能仅修改文件扩展名。');
  }
  if (dimensions.width > 10_000 || dimensions.height > 10_000 || dimensions.width * dimensions.height > MAX_IMAGE_PIXELS) {
    throw imageError('HQ3D_LAYOUT_IMAGE_DIMENSIONS', '图片尺寸过大，请压缩到不超过2400万像素且单边不超过10000像素。');
  }
  return dimensions;
};

const extractLines = (lines: Line[]): Hq3dOcrLine[] => lines.map(line => ({
  text: String(line.text || '').trim(),
  confidence: Number(line.confidence || 0),
  bbox: {
    x0: Number(line.bbox.x0),
    y0: Number(line.bbox.y0),
    x1: Number(line.bbox.x1),
    y1: Number(line.bbox.y1)
  }
})).filter(line => line.text && line.confidence >= 20 && line.bbox.x1 > line.bbox.x0 && line.bbox.y1 > line.bbox.y0);

const roomNumber = (text: string) => {
  const match = text.match(/(?<![A-Za-z0-9])([A-Za-z]?\d{2,4}[A-Za-z]?)(?![A-Za-z0-9])/);
  return match?.[1] || '';
};

const tokens = (text: string) => text.match(/[A-Za-z]?\d{2,4}[A-Za-z]?/g)?.map(item => item.toLocaleLowerCase()) || [];

const geometryFromLine = (line: Hq3dOcrLine, width: number, height: number) => {
  const textWidth = line.bbox.x1 - line.bbox.x0;
  const textHeight = line.bbox.y1 - line.bbox.y0;
  const padX = Math.max(textWidth * 0.45, width * 0.012);
  const padY = Math.max(textHeight * 1.2, height * 0.018);
  const x0 = clamp(line.bbox.x0 - padX, 0, width - 1);
  const y0 = clamp(line.bbox.y0 - padY, 0, height - 1);
  const x1 = clamp(line.bbox.x1 + padX, x0 + 1, width);
  const y1 = clamp(line.bbox.y1 + padY, y0 + 1, height);
  const nw = clamp((x1 - x0) / width, 0.04, 0.6);
  const nd = clamp((y1 - y0) / height, 0.035, 0.4);
  return {
    nx: rounded(clamp(x0 / width, 0, 1 - nw)),
    nz: rounded(clamp(y0 / height, 0, 1 - nd)),
    nw: rounded(nw),
    nd: rounded(nd),
    frac: 0
  };
};

const mergeAdjacentRoomLabels = (lines: Hq3dOcrLine[], dimensions: { width: number; height: number }) => {
  const consumed = new Set<number>();
  const merged = lines.map((line, index) => {
    const no = roomNumber(line.text);
    if (!no || compact(line.text) !== compact(no) || consumed.has(index)) return line;
    const lineHeight = line.bbox.y1 - line.bbox.y0;
    const centerX = (line.bbox.x0 + line.bbox.x1) / 2;
    const maxVerticalGap = Math.max(dimensions.height * 0.2, lineHeight * 3);
    const labels = lines.filter((candidate, candidateIndex) => {
      if (candidateIndex === index || consumed.has(candidateIndex) || roomNumber(candidate.text)) return false;
      const verticalGap = candidate.bbox.y0 - line.bbox.y1;
      if (verticalGap < -lineHeight * 0.25 || verticalGap > maxVerticalGap) return false;
      const candidateCenterX = (candidate.bbox.x0 + candidate.bbox.x1) / 2;
      const horizontalGap = Math.abs(candidateCenterX - centerX);
      const overlap = Math.min(line.bbox.x1, candidate.bbox.x1) - Math.max(line.bbox.x0, candidate.bbox.x0);
      return overlap > 0 || horizontalGap <= dimensions.width * 0.05;
    }).sort((left, right) => left.bbox.y0 - right.bbox.y0 || left.bbox.x0 - right.bbox.x0);
    if (!labels.length) return line;
    labels.forEach(label => consumed.add(lines.indexOf(label)));
    const textLines = [line.text.trim(), ...labels.map(label => label.text.trim())];
    return {
      text: textLines.join(' '),
      textLines,
      confidence: Math.min(line.confidence, ...labels.map(label => label.confidence)),
      bbox: {
        x0: Math.min(line.bbox.x0, ...labels.map(label => label.bbox.x0)),
        y0: line.bbox.y0,
        x1: Math.max(line.bbox.x1, ...labels.map(label => label.bbox.x1)),
        y1: Math.max(line.bbox.y1, ...labels.map(label => label.bbox.y1))
      }
    };
  });
  return merged.filter((_, index) => !consumed.has(index));
};

const recognizedTextLines = (line: Hq3dOcrLine) => {
  if (line.textLines?.length) return line.textLines.map(text => text.trim()).filter(Boolean);
  const no = roomNumber(line.text);
  if (!no) return [line.text.trim()];
  const match = line.text.match(/(?<![A-Za-z0-9])([A-Za-z]?\d{2,4}[A-Za-z]?)(?![A-Za-z0-9])/);
  const remainder = match ? `${line.text.slice(0, match.index)} ${line.text.slice(match.index! + match[0].length)}`.trim() : '';
  return [no, remainder].filter(Boolean);
};

const updateMatchedRoomText = (room: Hq3dSeedRoom, line: Hq3dOcrLine) => {
  const recognized = recognizedTextLines(line);
  const no = roomNumber(recognized[0] || '');
  const content = [no && compact(recognized[0]) === compact(no) ? '' : recognized[0], ...recognized.slice(1)]
    .map(text => text?.trim() || '').filter(Boolean);
  if (!content.length) return;
  const currentLines = room.lines?.length ? room.lines : [room.label];
  const currentContent = currentLines.filter((text, index) => index > 0 || compact(text) !== compact(room.no || ''));
  if (compact(recognized.join('')) === compact(currentLines.join('')) || compact(content.join('')) === compact(currentContent.join(''))) return;
  room.label = content[0];
  if (['office', 'meeting', 'open'].includes(room.cat)) room.dept = content[0];
  room.person = content.length > 1 && !/^[（(]/.test(content[1]) ? content.slice(1).join(' ') : '';
  room.lines = recognized;
};

export const buildHq3dLayoutFromOcr = (
  baseValue: unknown,
  lines: Hq3dOcrLine[],
  dimensions: { width: number; height: number }
): Hq3dImageRecognition => {
  const base = parseHq3dLayoutDocument(baseValue);
  if (base.scope.kind !== 'FLOOR') throw imageError('HQ3D_LAYOUT_IMAGE_SCOPE', '图片识别仅支持单层更新；整栋更新请使用JSON或Excel模板。');
  const floor = base.building.floors[0];
  const rooms = floor.rooms.map(room => ({ ...room, lines: [...(room.lines || [room.label])] }));
  const usedUids = new Set(rooms.map(room => room.uid));
  const matchedUids = new Set<string>();
  const created: Hq3dSeedRoom[] = [];
  const seenNewNumbers = new Set<string>();

  for (const line of mergeAdjacentRoomLabels(lines, dimensions)) {
    const normalizedText = compact(line.text);
    if (!normalizedText) continue;
    const lineTokens = tokens(line.text);
    const lineNumber = roomNumber(line.text);
    const matched = rooms.find(room => {
      const no = compact(room.no || '');
      if (no.length >= 2 && lineTokens.includes(no)) return true;
      const label = compact(room.label);
      const labelMatches = label.length >= 2 && (normalizedText === label || (label.length >= 4 && normalizedText.includes(label)));
      return labelMatches && (!lineNumber || !no);
    });
    if (matched) {
      matchedUids.add(matched.uid);
      if (matched.no && lineTokens.includes(compact(matched.no))) updateMatchedRoomText(matched, line);
      continue;
    }

    const no = roomNumber(line.text);
    if (!no) continue;
    const normalizedNumber = no.toLocaleLowerCase();
    if (seenNewNumbers.has(normalizedNumber)) continue;
    seenNewNumbers.add(normalizedNumber);
    const label = line.text.replace(/\s+/g, ' ').trim();
    const uidBase = `${base.building.id}#${floor.tag}#${no}#${label.replace(/\s/g, '')}`;
    let uid = uidBase;
    for (let suffix = 2; usedUids.has(uid); suffix += 1) uid = `${uidBase}#${suffix}`;
    usedUids.add(uid);
    created.push({
      uid,
      no,
      cat: 'meeting',
      label,
      dept: '',
      person: '',
      notes: '由本地图片OCR生成，需人工核对名称与估算坐标',
      lines: [label],
      ...geometryFromLine(line, dimensions.width, dimensions.height)
    });
  }

  const recognizedRooms = matchedUids.size + created.length;
  if (!recognizedRooms) throw imageError('HQ3D_LAYOUT_IMAGE_NO_ROOMS', '未识别到可用房间标注，请使用清晰、正向、文字完整的楼层图片，或改用Excel模板。');
  floor.rooms = [...rooms, ...created];
  const preservedRooms = rooms.length - matchedUids.size;
  const notices = [
    `本地OCR识别到${recognizedRooms}条房间标注：匹配现有${matchedUids.size}间，新增候选${created.length}间。`,
    `已保留${preservedRooms}间未被图片识别的现有房间，不会因漏识别而停用。`,
    '匹配房间的识别文字会进入预检，原UID、类别、维护备注和几何保持不变。',
    '新增房间坐标依据文字位置估算，不代表墙体边界；请在预检中逐项核对后再确认导入。'
  ];
  return {
    layout: parseHq3dLayoutDocument(base),
    notices,
    recognizedRooms,
    createdRooms: created.length,
    preservedRooms
  };
};

let ocrQueue: Promise<void> = Promise.resolve();
const scheduleOcr = <T>(task: () => Promise<T>): Promise<T> => {
  const result = ocrQueue.then(task, task);
  ocrQueue = result.then(() => undefined, () => undefined);
  return result;
};

export const recognizeHq3dLayoutImage = async (buffer: Buffer, scopeValue: unknown): Promise<Hq3dImageRecognition> => {
  const scope = scopeValue as Hq3dLayoutScope;
  if (scope?.kind !== 'FLOOR') throw imageError('HQ3D_LAYOUT_IMAGE_SCOPE', '图片识别仅支持单层更新；整栋更新请使用JSON或Excel模板。');
  const dimensions = readHq3dImageDimensions(buffer);
  const base = await exportHq3dLayout(scope);
  return scheduleOcr(async () => {
    let worker;
    try {
      worker = await createWorker('chi_sim', OEM.LSTM_ONLY, { langPath, gzip: true, cacheMethod: 'none' });
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, preserve_interword_spaces: '1', thresholding_method: '2' });
      const { data } = await worker.recognize(buffer, {}, { text: true, blocks: true });
      const lines = (data.blocks || []).flatMap(block => block.paragraphs.flatMap(paragraph => extractLines(paragraph.lines)));
      return buildHq3dLayoutFromOcr(base, lines, dimensions);
    } catch (error) {
      if (error instanceof DbError) throw error;
      throw imageError('HQ3D_LAYOUT_IMAGE_OCR_FAILED', '本地图片识别失败，请换用更清晰图片或改用Excel模板。');
    } finally {
      await worker?.terminate();
    }
  });
};
