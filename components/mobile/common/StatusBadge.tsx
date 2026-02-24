import React from 'react';

interface StatusBadgeProps {
  status: string;
  theme: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, theme }) => {
  const styles: Record<string, string> = {
    AVAILABLE: 'bg-emerald-50 text-emerald-600 border-emerald-100',
    PENDING: 'bg-amber-50 text-amber-600 border-amber-100',
    OCCUPIED: 'bg-rose-50 text-rose-600 border-rose-100',
    APPROVED: `bg-${theme}-50 text-${theme}-600 border-${theme}-100`,
    REJECTED: 'bg-rose-50 text-rose-600 border-rose-100',
    CANCELLED: 'bg-gray-100 text-gray-400 border-gray-200 line-through',
    COMPLETED: 'bg-gray-100 text-gray-400 border-gray-200',
    MAINTENANCE: 'bg-gray-50 text-gray-500 border-gray-200'
  };

  const labels: Record<string, string> = {
    AVAILABLE: '空闲',
    PENDING: '审批中',
    APPROVED: '已通过',
    REJECTED: '驳回',
    OCCUPIED: '占用',
    CANCELLED: '已撤销',
    COMPLETED: '结束',
    MAINTENANCE: '维护中'
  };

  return (
    <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold border ${styles[status] || styles.PENDING}`}>
      {labels[status] || status}
    </span>
  );
};
