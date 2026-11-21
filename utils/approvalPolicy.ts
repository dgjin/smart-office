import type { ApprovalNode, ApprovalRule, ApprovalRuleSetVersion, Booking, Resource, WorkflowVersion } from '../types.ts';

export type ApprovalPolicyDb = {
  workflow?: ApprovalNode[];
  workflowVersions?: WorkflowVersion[];
  approvalRuleSetVersions?: ApprovalRuleSetVersion[];
};

const importantWorkflow: ApprovalNode[] = [
  { id: 'important-review', name: '重要会议业务审核', approverRole: 'APPROVAL_ADMIN' },
  { id: 'important-final', name: '重要会议最终核准', approverRole: 'SYSTEM_ADMIN' }
];

const confidentialWorkflow: ApprovalNode[] = [
  { id: 'confidential-review', name: '涉密申请业务审核', approverRole: 'APPROVAL_ADMIN' },
  { id: 'confidential-security', name: '保密合规审批', approverRole: 'SECURITY_ADMIN' },
  { id: 'confidential-final', name: '涉密会议最终核准', approverRole: 'SYSTEM_ADMIN' }
];

const latestVersion = <T extends { version: number }>(versions: T[] = []) => [...versions].sort((a, b) => b.version - a.version)[0];

export const ensureApprovalPolicy = (db: ApprovalPolicyDb) => {
  const versions = db.workflowVersions || [];
  const currentVersion = latestVersion(versions) || {
    version: 1,
    nodes: structuredClone(db.workflow || []),
    createdAt: new Date().toISOString(),
    createdBy: 'system'
  };
  if (!versions.length) db.workflowVersions = [currentVersion];
  if (db.approvalRuleSetVersions?.length) return;

  let nextVersion = Math.max(0, ...(db.workflowVersions || []).map(item => item.version)) + 1;
  const importantVersion: WorkflowVersion = {
    version: nextVersion++, nodes: structuredClone(importantWorkflow), createdAt: new Date().toISOString(), createdBy: 'system'
  };
  const confidentialVersion: WorkflowVersion = {
    version: nextVersion++, nodes: structuredClone(confidentialWorkflow), createdAt: new Date().toISOString(), createdBy: 'system'
  };
  db.workflowVersions = [...(db.workflowVersions || []), importantVersion, confidentialVersion];
  const rules: ApprovalRule[] = [
    { id: 'confidential', name: '涉密会议保密审批', priority: 400, conditions: { meetingTypes: ['CONFIDENTIAL'] }, workflowVersion: confidentialVersion.version },
    { id: 'important', name: '重要会议强化审批', priority: 300, conditions: { meetingTypes: ['IMPORTANT'] }, workflowVersion: importantVersion.version },
    { id: 'exclusive', name: '专属资源临时使用审批', priority: 200, conditions: { exclusive: true }, workflowVersion: importantVersion.version },
    { id: 'heavy-service', name: '重服务资源协调审批', priority: 100, conditions: { heavyService: true }, workflowVersion: importantVersion.version }
  ];
  db.approvalRuleSetVersions = [{
    version: 1,
    defaultWorkflowVersion: currentVersion.version,
    rules,
    createdAt: new Date().toISOString(),
    createdBy: 'system'
  }];
};

export const isHeavyServiceBooking = (booking: Booking) => (booking.serviceRequirements || []).some(item =>
  ['VIDEO', 'SIGNAGE', 'SECURITY', 'OTHER'].includes(item.type)
) || Boolean(booking.auditoriumSetup?.stageRequired || (booking.auditoriumSetup?.rehearsalMinutes || 0) > 0);

const ruleMatches = (rule: ApprovalRule, booking: Booking, resource?: Resource) => {
  const { conditions } = rule;
  if (conditions.meetingTypes && (!booking.meetingType || !conditions.meetingTypes.includes(booking.meetingType))) return false;
  if (conditions.exclusive !== undefined && conditions.exclusive !== Boolean(resource?.isExclusive || booking.exclusiveAccessType)) return false;
  if (conditions.heavyService !== undefined && conditions.heavyService !== isHeavyServiceBooking(booking)) return false;
  return true;
};

const conditionText = (rule: ApprovalRule) => {
  const text: string[] = [];
  if (rule.conditions.meetingTypes?.length) text.push(`会议类型=${rule.conditions.meetingTypes.join('/')}`);
  if (rule.conditions.exclusive !== undefined) text.push(`专属资源=${rule.conditions.exclusive ? '是' : '否'}`);
  if (rule.conditions.heavyService !== undefined) text.push(`重服务=${rule.conditions.heavyService ? '是' : '否'}`);
  return text.join('，') || '全部申请';
};

export const resolveApprovalPolicy = (db: ApprovalPolicyDb, booking: Booking, resource?: Resource) => {
  ensureApprovalPolicy(db);
  const ruleSet = latestVersion(db.approvalRuleSetVersions)!;
  const rule = [...ruleSet.rules].sort((a, b) => b.priority - a.priority).find(item => ruleMatches(item, booking, resource));
  const workflowVersion = rule?.workflowVersion || ruleSet.defaultWorkflowVersion;
  const definition = (db.workflowVersions || []).find(item => item.version === workflowVersion);
  if (!definition) throw new Error('APPROVAL_WORKFLOW_VERSION_NOT_FOUND');
  return {
    ruleSetVersion: ruleSet.version,
    ruleId: rule?.id,
    workflowVersion: definition.version,
    nodes: structuredClone(definition.nodes),
    explanation: [rule ? `${rule.name}：${conditionText(rule)}` : '未命中特殊规则，使用默认审批流程']
  };
};
