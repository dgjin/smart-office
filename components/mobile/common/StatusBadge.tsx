import React from 'react';

interface StatusBadgeProps {
  status: string;
  theme: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, theme }) => {
  const isFinance = theme === 'finance';
  
  const getStyles = () => {
    const financeStyles: Record<string, string> = {
      AVAILABLE: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
      PENDING: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
      OCCUPIED: 'bg-rose-500/20 text-rose-400 border-rose-500/30',
      APPROVED: 'bg-violet-500/20 text-violet-400 border-violet-500/30',
      REJECTED: 'bg-rose-500/20 text-rose-400 border-rose-500/30',
      CANCELLED: 'bg-slate-500/20 text-slate-400 border-slate-500/30 line-through',
      COMPLETED: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
      MAINTENANCE: 'bg-slate-500/20 text-slate-400 border-slate-500/30'
    };
    
    const lightStyles: Record<string, string> = {
      AVAILABLE: 'bg-emerald-50 text-emerald-600 border-emerald-100',
      PENDING: 'bg-amber-50 text-amber-600 border-amber-100',
      OCCUPIED: 'bg-rose-50 text-rose-600 border-rose-100',
      APPROVED: `bg-${theme}-50 text-${theme}-600 border-${theme}-100`,
      REJECTED: 'bg-rose-50 text-rose-600 border-rose-100',
      CANCELLED: 'bg-gray-100 text-gray-400 border-gray-200 line-through',
      COMPLETED: 'bg-gray-100 text-gray-400 border-gray-200',
      MAINTENANCE: 'bg-gray-50 text-gray-500 border-gray-200'
    };
    
    return isFinance ? financeStyles : lightStyles;
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
    <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold border ${getStyles()[status] || getStyles().PENDING}`}>
      {labels[status] || status}
    </span>
  );
};
