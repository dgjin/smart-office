import path from 'node:path';
import { createNativeBackup, sanitizeNativeError } from './native-shared.ts';

function outputArgument(argv: string[]): string {
  let outputPath = '';
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== '--output') throw new Error('用法：native-backup.ts [--output <path>]');
    if (outputPath || index + 1 >= argv.length || argv[index + 1].startsWith('--')) {
      throw new Error('用法：native-backup.ts [--output <path>]');
    }
    outputPath = argv[index + 1];
    index += 1;
  }
  if (outputPath) return outputPath;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.resolve('backups', `mysql-${timestamp}.sql`);
}

try {
  const result = await createNativeBackup(outputArgument(process.argv.slice(2)));
  console.log(JSON.stringify({
    ok: true,
    output: result.outputPath,
    sha256: result.sha256,
    checksumFile: result.checksumPath
  }, null, 2));
} catch (error) {
  console.error(`原生备份失败：${sanitizeNativeError(error)}`);
  process.exitCode = 1;
}
