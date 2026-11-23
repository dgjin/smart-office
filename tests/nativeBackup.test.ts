import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { restoreNativeBackup, verifyNativeBackup } from '../scripts/db/native-shared.ts';

const createInput = async (t: any) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'smart-office-restore-gate-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const inputPath = path.join(directory, 'restore.sql');
  await fs.writeFile(inputPath, 'SELECT 1;\n', { mode: 0o600 });
  return inputPath;
};

const writeChecksum = async (inputPath: string, filename = path.basename(inputPath), content?: Buffer) => {
  const sha256 = crypto.createHash('sha256').update(content ?? await fs.readFile(inputPath)).digest('hex');
  await fs.writeFile(`${inputPath}.sha256`, `${sha256}  ${filename}\n`, { mode: 0o600 });
  return sha256;
};

test('有效 SHA-256 与匹配文件名通过恢复前校验', async t => {
  const inputPath = await createInput(t);
  const sha256 = await writeChecksum(inputPath);
  const verified = await verifyNativeBackup(inputPath);
  assert.equal(verified.inputPath, inputPath);
  assert.equal(verified.checksumPath, `${inputPath}.sha256`);
  assert.equal(verified.sha256, sha256);
});

test('缺少侧车校验文件时在启动 mysql 前拒绝恢复', async t => {
  const inputPath = await createInput(t);
  await assert.rejects(
    () => restoreNativeBackup(inputPath, 'smart_office_test_restore_gate'),
    /恢复校验文件不存在或不可读/
  );
});

test('侧车记录的文件名不匹配时在启动 mysql 前拒绝恢复', async t => {
  const inputPath = await createInput(t);
  await writeChecksum(inputPath, 'another-backup.sql');
  await assert.rejects(
    () => restoreNativeBackup(inputPath, 'smart_office_test_restore_gate'),
    /恢复校验文件名与输入文件不一致/
  );
});

test('SQL 内容被篡改时在启动 mysql 前拒绝恢复', async t => {
  const inputPath = await createInput(t);
  await writeChecksum(inputPath);
  await fs.appendFile(inputPath, 'SELECT 2;\n');
  await assert.rejects(
    () => restoreNativeBackup(inputPath, 'smart_office_test_restore_gate'),
    /恢复输入 SHA-256 校验失败/
  );
});
