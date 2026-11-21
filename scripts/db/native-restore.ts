import { DATABASE_NAME } from '../../server/config.ts';
import { restoreNativeBackup, sanitizeNativeError } from './native-shared.ts';

function inputArgument(argv: string[]): string {
  if (argv.length !== 2 || argv[0] !== '--input' || !argv[1] || argv[1].startsWith('--')) {
    throw new Error('用法：native-restore.ts --input <path>');
  }
  return argv[1];
}

try {
  const inputPath = inputArgument(process.argv.slice(2));
  if (process.env.SMART_OFFICE_RESTORE_CONFIRM !== DATABASE_NAME) {
    throw new Error('拒绝覆盖性恢复：SMART_OFFICE_RESTORE_CONFIRM 必须与目标 DATABASE_NAME 完全一致');
  }
  console.error('警告：即将对目标库执行覆盖性恢复，现有对象可能被删除或替换。');
  const result = await restoreNativeBackup(inputPath);
  console.log(JSON.stringify({ ok: true, input: result.inputPath }, null, 2));
} catch (error) {
  console.error(`原生恢复失败：${sanitizeNativeError(error)}`);
  process.exitCode = 1;
}
