import React from 'react';
import { Users, Shield, Building2, GitMerge, Database, LogOut, ChevronRight, MapPin, User, Edit3, Calendar, HelpCircle, Key } from 'lucide-react';
import { PERMISSIONS } from '../../../permissions';
import { usePermissions } from '../../../hooks/usePermissions';
import ApiKeySettings from './ApiKeySettings';

interface ProfileViewProps {
  currentUser: any;
  users: any[];
  roles: any[];
  theme: string;
  onLogout: () => void;
  onViewChange: (view: string) => void;
  onThemeChange: (theme: string) => void;
  onUpdateUser?: (userId: string, updates: any) => Promise<void>;
}

const THEMES = [
  { id: 'finance', name: '金融黑', color: 'bg-[#F59E0B]' },
  { id: 'indigo', name: '商务蓝', color: 'bg-indigo-500' },
  { id: 'emerald', name: '翡翠绿', color: 'bg-emerald-500' },
  { id: 'orange', name: '活力橙', color: 'bg-orange-500' },
  { id: 'rose', name: '胭脂红', color: 'bg-rose-500' },
  { id: 'purple', name: '极光紫', color: 'bg-purple-500' },
];

const ALL_MENU_ITEMS = [
  { id: 'BOOKINGS', icon: Calendar, label: '我的申请', permission: PERMISSIONS.VIEW_BOOKINGS },
  { id: 'HELP', icon: HelpCircle, label: '使用帮助', permission: null },
  { id: 'API_KEY', icon: Key, label: 'API Key 设置', permission: null },
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
  const [showHelp, setShowHelp] = React.useState(false);
  const [showApiKeySettings, setShowApiKeySettings] = React.useState(false);
  
  const userMenuItems = ALL_MENU_ITEMS.filter(item => 
    (item.id === 'BOOKINGS' || item.id === 'HELP' || item.id === 'API_KEY')
  );
  
  // 对 BOOKINGS 检查权限，HELP 和 API_KEY 不需要权限
  const filteredUserMenuItems = userMenuItems.filter(item => 
    item.id === 'HELP' || item.id === 'API_KEY' || hasPermission(item.permission)
  );
  
  const adminMenuItems = ALL_MENU_ITEMS.filter(item => 
    (item.id !== 'BOOKINGS' && item.id !== 'HELP' && item.id !== 'API_KEY') && hasPermission(item.permission)
  );
  
  const helpMenuItem = ALL_MENU_ITEMS.find(item => item.id === 'HELP');

  const isFinanceTheme = theme === 'finance';
  const darkBg = isFinanceTheme ? 'bg-[#1E293B] border-[#334155]' : 'bg-white border-gray-100';
  const darkText = isFinanceTheme ? 'text-white' : 'text-gray-800';
  const darkSubtext = isFinanceTheme ? 'text-white/60' : 'text-gray-400';
  const darkSecondary = isFinanceTheme ? 'bg-[#334155] text-white/80' : 'bg-gray-100 text-gray-600';
  const darkBorder = isFinanceTheme ? 'border-[#334155]' : 'border-gray-100';
  const darkCardBg = isFinanceTheme ? 'bg-[#1E293B]' : 'bg-white';
  const darkPrimary = isFinanceTheme ? 'bg-[#1E293B] border-[#334155]' : `bg-${theme}-600`;
  const darkPrimaryText = isFinanceTheme ? 'text-white' : 'text-white';
  const darkIconBg = isFinanceTheme ? 'bg-[#334155] text-[#F59E0B]' : `bg-${theme}-50 text-${theme}-600`;
  const darkAvatarEdit = isFinanceTheme ? 'bg-[#F59E0B] text-[#0F172A]' : `bg-white text-${theme}-600`;
  const darkRoleTag = isFinanceTheme ? 'bg-[#334155] text-[#F59E0B]' : 'bg-white/20 text-white';
  const darkLogoutBtn = isFinanceTheme ? 'bg-[#334155] text-white/60' : 'bg-white/20 text-white';

  return (
    <div className={`min-h-screen ${isFinanceTheme ? 'bg-[#0F172A]' : 'bg-gray-50'} pb-24 font-['IBM_Plex_Sans']`}>
      <div className={`${darkPrimary} ${darkPrimaryText} p-6 pb-8 border-b ${darkBorder}`}>
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
            <div className={`w-6 h-6 ${darkAvatarEdit} rounded-full flex items-center justify-center shadow-md`}>
              <Edit3 size={12} />
            </div>
          </div>
          <div className="flex-1">
            <h2 className="text-xl font-bold">{currentUser?.name}</h2>
            <p className="text-sm text-white/70">{currentUser?.email}</p>
            <div className="flex items-center space-x-2 mt-1">
              <span className={`text-xs ${darkRoleTag} px-2 py-0.5 rounded-full`}>
                {currentUser?.role?.map((r: string) => roles.find((role: any) => role.id === r)?.name || r).join(', ')}
              </span>
            </div>
          </div>
          <ChevronRight size={20} className="text-white/50" />
        </button>
      </div>

      <div className="px-4 -mt-4">
        <div className={`${darkCardBg} rounded-2xl p-4 shadow-sm border ${darkBorder} flex justify-around`}>
          <div className="text-center">
            <p className={`text-xl font-black ${darkText}`}>{currentUser?.department}</p>
            <p className={`text-[10px] ${darkSubtext}`}>所属部门</p>
          </div>
          <div className={`w-px ${isFinanceTheme ? 'bg-[#334155]' : 'bg-gray-100'}`} />
          <div className="text-center">
            <p className={`text-xl font-black ${darkText}`}>{currentUser?.mobile || '-'}</p>
            <p className={`text-[10px] ${darkSubtext}`}>联系电话</p>
          </div>
        </div>
      </div>

      {userMenuItems.length > 0 && (
        <div className="px-4 mt-6">
          <h3 className={`text-xs font-bold ${darkSubtext} uppercase mb-3 ml-1`}>常用功能</h3>
          <div className={`${darkCardBg} rounded-2xl border ${darkBorder} overflow-hidden`}>
            {filteredUserMenuItems.map((item, index) => (
              <button
                key={item.id}
                onClick={() => {
                  if (item.id === 'HELP') setShowHelp(true);
                  else if (item.id === 'API_KEY') setShowApiKeySettings(true);
                  else onViewChange(item.id);
                }}
                className={`w-full flex items-center justify-between p-4 ${index !== 0 ? `border-t ${darkBorder}` : ''} active:bg-opacity-90 transition-colors`}
              >
                <div className="flex items-center space-x-3">
                  <div className={`w-8 h-8 rounded-lg ${darkIconBg} flex items-center justify-center`}>
                    <item.icon size={16} />
                  </div>
                  <span className={`font-bold ${darkText} text-sm`}>{item.label}</span>
                </div>
                <ChevronRight size={18} className={`${darkSubtext}`} />
              </button>
            ))}
          </div>
        </div>
      )}

      {adminMenuItems.length > 0 && (
        <div className="px-4 mt-6">
          <h3 className={`text-xs font-bold ${darkSubtext} uppercase mb-3 ml-1`}>系统管理</h3>
          <div className={`${darkCardBg} rounded-2xl border ${darkBorder} overflow-hidden`}>
            {adminMenuItems.map((item, index) => (
              <button
                key={item.id}
                onClick={() => onViewChange(item.id)}
                className={`w-full flex items-center justify-between p-4 ${index !== 0 ? `border-t ${darkBorder}` : ''} active:bg-opacity-90 transition-colors`}
              >
                <div className="flex items-center space-x-3">
                  <div className={`w-8 h-8 rounded-lg ${darkIconBg} flex items-center justify-center`}>
                    <item.icon size={16} />
                  </div>
                  <span className={`font-bold ${darkText} text-sm`}>{item.label}</span>
                </div>
                <ChevronRight size={18} className={`${darkSubtext}`} />
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="px-4 mt-6">
        <h3 className={`text-xs font-bold ${darkSubtext} uppercase mb-3 ml-1`}>主题设置</h3>
        <div className={`${darkCardBg} rounded-2xl p-4 border ${darkBorder}`}>
          <div className="flex justify-around">
            {THEMES.map((t) => (
              <button
                key={t.id}
                onClick={() => onThemeChange(t.id)}
                className={`flex flex-col items-center ${theme === t.id ? 'opacity-100' : 'opacity-40'}`}
              >
                <div className={`w-8 h-8 rounded-full ${t.color} ${theme === t.id ? (isFinanceTheme ? 'ring-2 ring-offset-2 ring-[#F59E0B]' : 'ring-2 ring-offset-2 ring-gray-400') : ''}`} />
                <span className={`text-[10px] mt-1 font-medium ${darkSubtext}`}>{t.name}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 帮助弹窗 */}
      {showHelp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setShowHelp(false)}>
          <div className={`${darkCardBg} rounded-2xl w-full max-w-md max-h-[80vh] overflow-y-auto p-5`} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className={`text-lg font-bold ${darkText}`}>使用帮助</h3>
              <button onClick={() => setShowHelp(false)} className="p-1">✕</button>
            </div>
            
            <div className="space-y-4">
              <div>
                <h4 className={`font-bold ${darkText} mb-2`}>角色说明</h4>
                <div className={`${darkSecondary} rounded-lg p-3 text-sm`}>
                  <p className="mb-2"><span className="font-bold">系统管理员</span>：拥有全部管理权限</p>
                  <p className="mb-2"><span className="font-bold">审批负责人</span>：负责审批管理</p>
                  <p className="mb-2"><span className="font-bold">会议服务</span>：负责会议室管理</p>
                  <p><span className="font-bold">普通员工</span>：基本使用权限</p>
                </div>
              </div>

              <div>
                <h4 className={`font-bold ${darkText} mb-2`}>预订状态</h4>
                <div className={`${darkSecondary} rounded-lg p-3 text-sm`}>
                  <p className="mb-2"><span className="inline-block w-3 h-3 bg-green-500 rounded mr-2"></span>已确认：预订已通过审批</p>
                  <p className="mb-2"><span className="inline-block w-3 h-3 bg-yellow-500 rounded mr-2"></span>待审批：等待审批中</p>
                  <p className="mb-2"><span className="inline-block w-3 h-3 bg-red-500 rounded mr-2"></span>已拒绝：预订被拒绝</p>
                  <p><span className="inline-block w-3 h-3 bg-gray-400 rounded mr-2"></span>已取消：预订已取消</p>
                </div>
              </div>

              <div>
                <h4 className={`font-bold ${darkText} mb-2`}>监控大屏颜色</h4>
                <div className={`${darkSecondary} rounded-lg p-3 text-sm`}>
                  <p className="mb-2"><span className="inline-block w-3 h-3 bg-green-600 rounded mr-2"></span>进行中：会议正在进行</p>
                  <p className="mb-2"><span className="inline-block w-3 h-3 bg-green-400 rounded mr-2"></span>即将开始：会议即将开始</p>
                  <p className="mb-2"><span className="inline-block w-3 h-3 bg-slate-500 rounded mr-2"></span>已结束：会议已结束</p>
                  <p className="mb-2"><span className="inline-block w-3 h-3 bg-yellow-500 rounded mr-2"></span>待审批：等待审批</p>
                  <p><span className="inline-block w-3 h-3 bg-slate-700 rounded mr-2"></span>空闲：无预订</p>
                </div>
              </div>

              <div>
                <h4 className={`font-bold ${darkText} mb-2`}>快捷操作</h4>
                <div className={`${darkSecondary} rounded-lg p-3 text-sm`}>
                  <p className="mb-1">• 点击底部导航切换功能</p>
                  <p className="mb-1">• 长按可编辑我的预订</p>
                  <p>• 右上角刷新按钮更新数据</p>
                </div>
              </div>
            </div>

            <button 
              onClick={() => setShowHelp(false)}
              className={`w-full mt-4 py-2 rounded-lg font-bold bg-blue-600 text-white`}
            >
              知道了
            </button>
          </div>
        </div>
      )}

      {/* API Key 设置弹窗 */}
      {showApiKeySettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setShowApiKeySettings(false)}>
          <div className={`${darkCardBg} rounded-2xl w-full max-w-md max-h-[80vh] overflow-y-auto`} onClick={e => e.stopPropagation()}>
            <ApiKeySettings 
              currentUser={currentUser}
              onSave={async (encryptedKey) => {
                if (onUpdateUser) {
                  await onUpdateUser(currentUser.id, { encryptedApiKey: encryptedKey });
                  setShowApiKeySettings(false);
                }
              }}
              theme={theme}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default ProfileView;
