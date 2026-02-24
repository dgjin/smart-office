import React from 'react';
import { Home, MapPin, ClipboardList, User, Coffee, ShieldCheck } from 'lucide-react';
import { PERMISSIONS } from '../../../permissions';
import { usePermissions } from '../../../hooks/usePermissions';

interface BottomNavProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  theme: string;
  pendingCount: number;
  userRoles?: string[];
}

const ALL_NAV_ITEMS = [
  { id: 'DASHBOARD', icon: Home, label: '首页', permission: PERMISSIONS.VIEW_DASHBOARD },
  { id: 'RESOURCES', icon: MapPin, label: '资源', permission: PERMISSIONS.VIEW_RESOURCES },
  { id: 'MEETING_SERVICE', icon: Coffee, label: '会议服务', permission: PERMISSIONS.VIEW_MEETING_SERVICE },
  { id: 'APPROVAL_CENTER', icon: ClipboardList, label: '审批', permission: PERMISSIONS.VIEW_APPROVAL_CENTER },
  { id: 'PROFILE', icon: User, label: '我的', permission: PERMISSIONS.VIEW_PROFILE },
];

export const BottomNav: React.FC<BottomNavProps> = ({ activeTab, onTabChange, theme, pendingCount, userRoles = [] }) => {
  const { hasPermission } = usePermissions(userRoles);
  
  const visibleTabs = ALL_NAV_ITEMS.filter(item => hasPermission(item.permission));

  const isFinanceTheme = theme === 'finance';
  const themeColor = isFinanceTheme ? 'text-[#F59E0B]' : `text-${theme}-600`;
  const accentColor = isFinanceTheme ? 'bg-[#F59E0B]' : `bg-${theme}-600`;
  const bgColor = isFinanceTheme ? 'bg-[#1E293B] border-[#334155]' : 'bg-white border-gray-100';
  const inactiveColor = isFinanceTheme ? 'text-white/60' : 'text-gray-400';

  return (
    <div className={`fixed bottom-0 left-0 right-0 ${bgColor} border-t pb-safe z-50 font-['IBM_Plex_Sans']`} style={{ maxWidth: '416px', margin: '0 auto', left: '0', right: '0' }}>
      <div className="flex items-center justify-around h-16">
        {visibleTabs.map((tab) => {
          const isActive = activeTab === tab.id;
          const Icon = tab.icon;
          const isApprovalTab = tab.id === 'APPROVAL_CENTER';
          
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`flex flex-col items-center justify-center flex-1 h-full relative ${isActive ? themeColor : inactiveColor}`}
            >
              <div className="relative">
                <Icon size={22} strokeWidth={isActive ? 2.5 : 2} />
                {isApprovalTab && pendingCount > 0 && (
                  <span className={`absolute -top-1 -right-2 w-4 h-4 ${accentColor} text-white text-[10px] font-bold rounded-full flex items-center justify-center`}>
                    {pendingCount}
                  </span>
                )}
              </div>
              <span className={`text-[10px] mt-1 font-medium ${isActive ? 'font-bold' : ''}`}>{tab.label}</span>
              {isActive && (
                <div className={`absolute -bottom-0 w-8 h-1 ${accentColor} rounded-full`} />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};
