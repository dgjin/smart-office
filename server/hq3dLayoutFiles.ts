import { DbError } from './errors.ts';
import { parseHq3dLayoutDocument, type Hq3dLayoutDocument } from './hq3dLayoutImport.ts';
import { parseHq3dLayoutExcelUpload } from './hq3dLayoutExcel.ts';
import { recognizeHq3dLayoutImage } from './hq3dLayoutOcr.ts';

export type Hq3dLayoutUploadResult = {
  layout: Hq3dLayoutDocument;
  sourceKind: 'JSON' | 'EXCEL' | 'IMAGE';
  notices: string[];
  recognizedRooms?: number;
  createdRooms?: number;
  preservedRooms?: number;
};

const uploadError = (code: string, message: string) => new DbError(code, 400, { detail: message });

const decodeBase64 = (value: unknown) => {
  if (typeof value !== 'string' || !value || value.length % 4 !== 0 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw uploadError('INVALID_HQ3D_UPLOAD', '上传文件内容编码无效，请重新选择文件。');
  }
  const buffer = Buffer.from(value, 'base64');
  if (!buffer.length) throw uploadError('INVALID_HQ3D_UPLOAD', '上传文件为空，请选择有效文件。');
  return buffer;
};

export const parseHq3dLayoutUpload = async (input: {
  fileName: unknown;
  contentBase64: unknown;
  scope?: unknown;
}): Promise<Hq3dLayoutUploadResult> => {
  const fileName = typeof input.fileName === 'string' ? input.fileName.trim().toLocaleLowerCase() : '';
  if (!fileName || fileName.length > 255) throw uploadError('INVALID_HQ3D_UPLOAD', '请提供有效文件名。');
  const buffer = decodeBase64(input.contentBase64);

  if (fileName.endsWith('.json')) {
    if (buffer.length > 2 * 1024 * 1024) throw uploadError('HQ3D_LAYOUT_JSON_SIZE', 'JSON文件不能超过2 MiB。');
    try {
      return { layout: parseHq3dLayoutDocument(JSON.parse(buffer.toString('utf8'))), sourceKind: 'JSON', notices: [] };
    } catch (error) {
      if (error instanceof DbError) throw error;
      throw uploadError('INVALID_HQ3D_LAYOUT', '文件不是有效的JSON，请使用系统导出的模板并检查内容。');
    }
  }
  if (fileName.endsWith('.xlsx')) {
    if (buffer.length > 4 * 1024 * 1024) throw uploadError('HQ3D_LAYOUT_EXCEL_SIZE', 'Excel文件不能超过4 MiB。');
    const result = await parseHq3dLayoutExcelUpload(buffer, input.scope);
    return { ...result, sourceKind: 'EXCEL' };
  }
  if (/\.(?:png|jpe?g)$/.test(fileName)) {
    const result = await recognizeHq3dLayoutImage(buffer, input.scope);
    return { ...result, sourceKind: 'IMAGE' };
  }
  throw uploadError('HQ3D_LAYOUT_UPLOAD_FORMAT', '仅支持.json、.xlsx、.png、.jpg或.jpeg文件。');
};
