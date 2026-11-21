INSERT IGNORE INTO office_state (state_key, payload) VALUES
  ('ruleVersions', JSON_ARRAY(JSON_OBJECT(
    'version', 1,
    'settings', JSON_OBJECT(
      'smallRoomMaxCapacity', 10,
      'mediumRoomMaxCapacity', 30,
      'departmentDailyNetMinutes', 240,
      'exclusiveRequestOpenHours', 24,
      'standardCancellationCutoffMinutes', 30,
      'servicedCancellationCutoffMinutes', 120,
      'approvalReminderAfterMinutes', 60,
      'approvalEscalationAfterMinutes', 120,
      'unapprovedCloseBeforeStartMinutes', 30,
      'checkInReminderAfterStartMinutes', 10,
      'noShowReleaseAfterStartMinutes', 20,
      'longTermMaxCalendarMonths', 1
    ),
    'createdAt', UTC_TIMESTAMP(3),
    'createdBy', 'system'
  ))),
  ('resourceImportBatches', JSON_ARRAY());
