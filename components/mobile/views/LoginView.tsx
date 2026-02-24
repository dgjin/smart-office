import React from 'react';
import { Cpu, Users, ChevronRight } from 'lucide-react';

interface LoginViewProps {
  users: any[];
  roles: any[];
  onLogin: (user: any) => void;
  theme: string;
  isLoading: boolean;
}

export const LoginView: React.FC<LoginViewProps> = ({ users, roles, onLogin, theme, isLoading }) => {
  const getRoleNames = (roleIds: string[]) => {
    if (!roleIds || roleIds.length === 0) return '员工';
    return roleIds.map(id => roles.find(r => r.id === id)?.name || id).join(' · ');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex flex-col">
      {/* Header */}
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <div className={`w-20 h-20 bg-${theme}-600 rounded-3xl flex items-center justify-center text-white shadow-xl mb-6`}>
          <Cpu size={40} />
        </div>
        <h1 className="text-2xl font-black text-gray-800 tracking-tight">SmartOffice</h1>
        <p className="text-gray-400 font-medium mt-2 text-sm">智慧办公空间管理</p>
      </div>

      {/* User Selection */}
      <div className="bg-white rounded-t-[2.5rem] shadow-[0_-10px_40px_rgba(0,0,0,0.1)] p-6 pb-8">
        <h2 className="text-lg font-bold text-gray-800 mb-4">选择账号登录</h2>
        
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-12">
            <div className={`w-10 h-10 border-3 border-${theme}-600 border-t-transparent rounded-full animate-spin mb-4`} style={{ borderWidth: '3px' }}></div>
            <p className="text-sm text-gray-500 font-medium">正在加载用户数据...</p>
          </div>
        ) : users.length === 0 ? (
          <div className="text-center py-10">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Users size={28} className="text-gray-400" />
            </div>
            <p className="text-gray-600 font-semibold mb-1">暂无用户数据</p>
            <p className="text-xs text-gray-400 mb-5">请先在 Supabase 中添加用户数据</p>
            <div className="bg-gray-50 rounded-xl p-4 text-left text-xs text-gray-600 border border-gray-100">
              <p className="font-semibold mb-2 text-gray-700">SQL 示例：</p>
              <code className="block bg-white p-3 rounded-lg text-[10px] overflow-x-auto border border-gray-200 font-mono">
                INSERT INTO smartoffice_users (name, email, role, department) <br/>
                VALUES ('管理员', 'admin@company.com', ARRAY['SYSTEM_ADMIN'], 'IT部');
              </code>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {users.map((u: any) => (
              <button 
                key={u.id} 
                onClick={() => onLogin(u)} 
                className="w-full p-4 flex items-center rounded-2xl bg-white border border-gray-100 shadow-sm hover:shadow-md hover:border-indigo-200 hover:bg-indigo-50/50 transition-all group text-left active:scale-[0.98]"
              >
                <div className={`w-12 h-12 rounded-full bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center font-bold text-gray-600 group-hover:from-indigo-100 group-hover:to-indigo-200 group-hover:text-indigo-700 transition-all text-lg shrink-0`}>
                  {u.name[0]}
                </div>
                <div className="flex-1 min-w-0 ml-4">
                  <h4 className="font-bold text-gray-800 text-base truncate">{u.name}</h4>
                  <p className="text-xs text-gray-400 mt-0.5 truncate">{getRoleNames(u.role)}{u.department ? ` · ${u.department}` : ''}</p>
                </div>
                <ChevronRight size={20} className="text-gray-300 shrink-0 ml-2" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
