import test from 'node:test';
import assert from 'node:assert/strict';
import { COMMON_ERROR_MESSAGES, formatUserError } from '../utils/userErrors.ts';

test('REQUESTER_NOT_FOUND 显示中文且不被英文 detail 覆盖', () => {
  const message = formatUserError({ error: 'REQUESTER_NOT_FOUND', detail: 'REQUESTER_NOT_FOUND' });
  assert.equal(message, COMMON_ERROR_MESSAGES.REQUESTER_NOT_FOUND);
  assert.match(message, /申请人信息不存在或已失效/);
  assert.doesNotMatch(message, /REQUESTER_NOT_FOUND/);
});

test('未识别错误码、状态码和英文网络错误统一回退为中文', () => {
  for (const reason of [
    { error: 'UNLISTED_BUSINESS_CODE', detail: 'UNLISTED_BUSINESS_CODE' },
    new Error('UNLISTED_BUSINESS_CODE'),
    new Error('Failed to fetch'),
    '500'
  ]) {
    assert.equal(formatUserError(reason, '操作未完成，请稍后重试。'), '操作未完成，请稍后重试。');
  }
});

test('保留可用的中文 detail 和本地中文错误', () => {
  assert.equal(
    formatUserError({ error: 'UNLISTED_BUSINESS_CODE', detail: '部门档案已变化，请刷新后重试。' }),
    '部门档案已变化，请刷新后重试。'
  );
  assert.equal(formatUserError(new Error('请填写工单操作原因。')), '请填写工单操作原因。');
});

test('中文说明中夹带错误码时不直接展示', () => {
  assert.equal(
    formatUserError('保存失败：UNLISTED_BUSINESS_CODE', '保存失败，请刷新后重试。'),
    '保存失败，请刷新后重试。'
  );
});

test('内部 Error.code 继续驱动页面专用中文映射', () => {
  const error = Object.assign(new Error('操作失败，请刷新后重试。'), { code: 'DELEGATION_OVERLAP' });
  assert.equal(
    formatUserError(error, '保存失败，请稍后重试。', { DELEGATION_OVERLAP: '同一委托人的代理时间段不能重叠。' }),
    '同一委托人的代理时间段不能重叠。'
  );
});
