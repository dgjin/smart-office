import React from 'react';
import { Users, Shield, Building2, GitMerge, Database, LogOut, ChevronRight, MapPin, User, Edit3, Calendar } from 'lucide-react';
import { PERMISSIONS } from '../../../permissions';
import { usePermissions } from '../../../hooks/usePermissions';

interface ProfileViewProps {
  currentUser: any;
  users: any[];
  roles: any[];
  theme: string;
  onLogout: () => void;
  onViewChange: (view: string) => void;
  onThemeChange: (theme: string) => void;
}

const THEMES = [
  { id: 'indigo', name: '商务蓝', color: 'bg-indigo-500' },
  { id: 'emerald', name: '翡翠绿', color: 'bg-emerald-500' },
  { id: 'orange', name: '活力橙', color: 'bg-orange-500' },
  { id: 'rose', name: '胭脂红', color: 'bg-rose-500' },
  { id: 'purple', name: '极光紫', color: 'bg-purple-500' },
];

const ALL_MENU_ITEMS = [
  { id: 'BOOKINGS', icon: Calendar, label: '我的申请', permission: PERMISSIONS.VIEW_BOOKINGS },
  { id: 'USERS', icon: Users, label: '成员中心', permission: PERMISSIONS.MANAGE_USERS },
  { id: 'ROLES', icon: Shield, label: '角色管理', permission: PERMISSIONS.MANAGE_ROLES },
  { id: 'DEPARTMENTS', icon: Building2, label: '部门管理', permission: PERMISSIONS.MANAGE_DEPARTMENTS },
  { id: 'RESOURCES_MANAGE', icon: MapPin, label: '资源管理', permission: PERMISSIONS.MANAGE_RESOURCES },
  { id: 'WORKFLOW_CONFIG', icon: GitMerge, label: '流程配置', permission: PERMISSIONS.CONFIG_WORKFLOW },
  { id: 'DATA_CENTER', icon: Database, label: '数据中心', permission: PERMISSIONS.ACCESS_DATA_CENTER },
];

export const ProfileView: React.FC<ProfileViewProps> = ({
  currentUser,
  users,
  roles,
  theme,
  onLogout,
  onViewChange,
  onThemeChange
}) => {
  const { hasPermission } = usePermissions(currentUser?.role || []);
  
  const userMenuItems = ALL_MENU_ITEMS.filter(item => 
    item.id === 'BOOKINGS' && hasPermission(item.permission)
  );
  
  const adminMenuItems = ALL_MENU_ITEMS.filter(item => 
    item.id !== 'BOOKINGS' && hasPermission(item.permission)
  );

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      <div className={`bg-${theme}-600 text-white p-6 pb-8`}>
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-lg font-bold">个人中心</h1>
          <button onClick={onLogout} className="p-2 bg-white/20 rounded-full">
            <LogOut size={18} />
          </button>
        </div>

        <button 
          onClick={() => onViewChange('PROFILE_EDIT')}
          className="flex items-center space-x-4 w-full text-left active:opacity-80 transition-opacity"
        >
          {currentUser?.avatar ? (
            <img 
              src={currentUser.avatar} 
              alt="头像" 
              className="w-16 h-16 rounded-full object-cover border-2 border-white/30 relative"
            />
          ) : (
            <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center text-2xl font-bold relative">
              {currentUser?.name?.[0]}
            </div>
          )}
          <div className="absolute" style={{ marginTop: '48px', marginLeft: '48px' }}>
            <div className="w-6 h-6 bg-white rounded-full flex items-center justify-center shadow">
              <Edit3 size={12} className={`text-${theme}-600`} />
            </div>
          </div>
          <div className="flex-1">
            <h2 className="text-xl font-bold">{currentUser?.name}</h2>
            <p className="text-sm text-white/70">{currentUser?.email}</p>
            <div className="flex items-center space-x-2 mt-1">
              <span className="text-xs bg-white/20 px-2 py-0.5 rounded-full">
                {currentUser?.role?.map((r: string) => roles.find((role: any) => role.id === r)?.name || r).join(', ')}
              </span>
            </div>
          </div>
          <ChevronRight size={20} className="text-white/50" />
        </button>
      </div>

      <div className="px-4 -mt-4">
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 flex justify-around">
          <div className="text-center">
            <p className="text-xl font-black text-gray-800">{currentUser?.department}</p>
            <p className="text-[10px] text-gray-400">所属部门</p>
          </div>
          <div className="w-px bg-gray-100" />
          <div className="text-center">
            <p className="text-xl font-black text-gray-800">{currentUser?.mobile || '-'}</p>
            <p className="text-[10px] text-gray-400">联系电话</p>
          </div>
        </div>
      </div>

      {userMenuItems.length > 0 && (
        <div className="px-4 mt-6">
          <h3 className="text-xs font-bold text-gray-400 uppercase mb-3 ml-1">常用功能</h3>
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            {userMenuItems.map((item, index) => (
              <button
                key={item.id}
                onClick={() => onViewChange(item.id)}
                className={`w-full flex items-center justify-between p-4 ${index !== 0 ? 'border-t border-gray-50' : ''} active:bg-gray-50`}
              >
                <div className="flex items-center space-x-3">
                  <div className={`w-8 h-8 rounded-lg bg-${theme}-50 flex items-center justify-center text-${theme}-600`}>
                    <item.icon size={16} />
                  </div>
                  <span className="font-bold text-gray-700 text-sm">{item.label}</span>
                </div>
                <ChevronRight size={18} className="text-gray-300" />
              </button>
            ))}
          </div>
        </div>
      )}

      {adminMenuItems.length > 0 && (
        <div className="px-4 mt-6">
          <h3 className="text-xs font-bold text-gray-400 uppercase mb-3 ml-1">系统管理</h3>
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            {adminMenuItems.map((item, index) => (
              <button
                key={item.id}
                onClick={() => onViewChange(item.id)}
                className={`w-full flex items-center justify-between p-4 ${index !== 0 ? 'border-t border-gray-50' : ''} active:bg-gray-50`}
              >
                <div className="flex items-center space-x-3">
                  <div className={`w-8 h-8 rounded-lg bg-${theme}-50 flex items-center justify-center text-${theme}-600`}>
                    <item.icon size={16} />
                  </div>
                  <span className="font-bold text-gray-700 text-sm">{item.label}</span>
                </div>
                <ChevronRight size={18} className="text-gray-300" />
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="px-4 mt-6">
        <h3 className="text-xs font-bold text-gray-400 uppercase mb-3 ml-1">主题设置</h3>
        <div className="bg-white rounded-2xl p-4 border border-gray-100">
          <div className="flex justify-around">
            {THEMES.map((t) => (
              <button
                key={t.id}
                onClick={() => onThemeChange(t.id)}
                className={`flex flex-col items-center ${theme === t.id ? 'opacity-100' : 'opacity-40'}`}
              >
                <div className={`w-8 h-8 rounded-full ${t.color} ${theme === t.id ? 'ring-2 ring-offset-2 ring-gray-400' : ''}`} />
                <span className="text-[10px] mt-1 font-medium text-gray-500">{t.name}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
