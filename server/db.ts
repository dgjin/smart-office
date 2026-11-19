import fs from 'node:fs';
import path from 'node:path';
import type { OfficeDb } from './tools.ts';

const resolveDataDir = () => {
  const candidates = [path.resolve(process.cwd(), '.wb/data')];
  if (typeof __dirname !== 'undefined') candidates.push(path.resolve(__dirname, '../.wb/data'));
  return candidates.find(dir => fs.existsSync(dir)) || candidates[0];
};

const DATA_DIR = resolveDataDir();
const DB_FILE = path.join(DATA_DIR, 'db.json');

export const readDb = (): OfficeDb => {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) || {};
  } catch {
    return {};
  }
};

export const writeDb = (data: OfficeDb) => {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DB_FILE);
};
