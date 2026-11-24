import { EventEmitter } from 'node:events';

const events = new EventEmitter();
events.setMaxListeners(0);

export type MonitoringScope = 'workspace' | 'hq3d';

export const publishMonitoringChange = (scope: MonitoringScope) => {
  events.emit('change', scope);
};

export const subscribeMonitoringChanges = (listener: (scope: MonitoringScope) => void) => {
  events.on('change', listener);
  return () => { events.off('change', listener); };
};

export const monitoringSubscriberCount = () => events.listenerCount('change');
