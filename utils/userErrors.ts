export const COMMON_ERROR_MESSAGES: Record<string, string> = {
  REQUESTER_NOT_FOUND: '申请人信息不存在或已失效，请联系管理员核对成员档案后重试。',
  FORBIDDEN: '当前账号无权执行此操作，请联系管理员。',
  UNAUTHENTICATED: '登录状态已失效，请重新登录。',
  UNAUTHORIZED: '登录状态已失效，请重新登录。',
  AUTH_REQUIRED: '请先登录后再执行此操作。',
  NOT_FOUND: '请求的数据不存在或已删除，请刷新后重试。',
  CONFLICT: '数据已被其他操作更新，请刷新后重试。',
  INTERNAL: '服务暂时不可用，请稍后重试。',
  ACTION_FAILED: '操作失败，请刷新后重试。',
  OPERATIONS_REFRESH_FAILED: '数据刷新失败，请检查网络后重试。',
  REPORT_SNAPSHOT_CHANGED: '报表数据已更新，请刷新到最新快照后重试。'
};

const hasChinese = (value: string) => /[\u3400-\u9fff]/.test(value);
const hasErrorCode = (value: string) => /\b[A-Z][A-Z0-9]*_[A-Za-z0-9_]+\b/.test(value);

export function formatUserError(
  reason: unknown,
  fallback = '操作失败，请刷新后重试。',
  messages: Record<string, string> = {}
): string {
  const payload = reason && typeof reason === 'object' ? reason as Record<string, unknown> : {};
  const rawMessage = reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : '';
  const code = [payload.error, payload.code, rawMessage].find((value): value is string => typeof value === 'string' && Boolean(value.trim()))?.trim() || '';
  const mapped = messages[code] || COMMON_ERROR_MESSAGES[code] || messages[rawMessage] || COMMON_ERROR_MESSAGES[rawMessage];
  if (mapped) return mapped;

  for (const candidate of [payload.detail, payload.message, rawMessage]) {
    if (typeof candidate !== 'string') continue;
    const text = candidate.trim();
    if (text && hasChinese(text) && !hasErrorCode(text)) return text;
  }
  return fallback;
}
