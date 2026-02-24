import React, { useState, useEffect } from 'react';
import { Cpu, Mail, Lock, User, ChevronLeft, Eye, EyeOff, ArrowRight, ShieldCheck } from 'lucide-react';
import { loginWithEmailAndPassword, createUserWithPassword } from '../../../services/supabaseService';

interface AuthViewProps {
  onLogin: (user: any) => void;
  theme: string;
  isLoading: boolean;
}

export const AuthView: React.FC<AuthViewProps> = ({ onLogin, theme, isLoading }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [department, setDepartment] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // 添加IBM Plex Sans字体
  useEffect(() => {
    const link = document.createElement('link');
    link.href = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@300;400;500;600;700&display=swap';
    link.rel = 'stylesheet';
    document.head.appendChild(link);
    return () => document.head.removeChild(link);
  }, []);

  // 应用金融主题的样式
  const isFinanceTheme = theme === 'finance';
  const themeColor = isFinanceTheme ? 'bg-[#0F172A]' : `bg-${theme}-600`;
  const textColor = isFinanceTheme ? 'text-[#0F172A]' : `text-${theme}-600`;
  const accentColor = isFinanceTheme ? 'bg-[#CA8A04]' : `bg-${theme}-600`;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isLogin) {
        // 登录
        if (!email || !password) {
          setError('请输入邮箱和密码');
          return;
        }

        const user = await loginWithEmailAndPassword(email, password);
        if (user) {
          onLogin(user);
        } else {
          setError('邮箱或密码错误');
        }
      } else {
        // 注册
        if (!name || !email || !password || !department) {
          setError('请填写所有必填字段');
          return;
        }

        const user = await createUserWithPassword({
          name,
          email,
          password,
          role: ['EMPLOYEE'], // 默认角色
          department,
        });

        if (user) {
          onLogin(user);
        } else {
          setError('邮箱已存在');
        }
      }
    } catch (err) {
      console.error('认证失败:', err);
      setError('认证失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`min-h-screen ${isFinanceTheme ? 'bg-[#0F172A]' : 'bg-gradient-to-br from-gray-50 to-gray-100'} flex flex-col font-['IBM_Plex_Sans']`}>
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-8">
        {/* Logo and Brand */}
        <div className="w-full max-w-sm flex flex-col items-center">
          <div className={`w-16 h-16 ${isFinanceTheme ? 'bg-[#F59E0B]' : themeColor} rounded-2xl flex items-center justify-center text-[#0F172A] shadow-lg mb-4`}>
            <div className="flex items-center justify-center">
              <ShieldCheck size={32} />
            </div>
          </div>
          <h1 className={`text-xl font-bold ${isFinanceTheme ? 'text-white' : 'text-gray-800'} tracking-tight mb-1`}>SmartOffice</h1>
          <p className={`${isFinanceTheme ? 'text-[#F59E0B]' : 'text-gray-400'} font-medium text-sm mb-3`}>智慧办公空间管理</p>
          <div className={`flex items-center space-x-2 ${isFinanceTheme ? 'text-[#F59E0B]' : 'text-gray-500'} mb-6`}>
            <ShieldCheck size={12} />
            <span className="text-xs font-semibold">安全认证 · 企业级保障</span>
          </div>

          {/* Auth Form */}
          <div className={`w-full ${isFinanceTheme ? 'bg-[#1E293B]' : 'bg-white'} rounded-xl p-5`}>
            <div className="flex items-center justify-between mb-4">
              <h2 className={`text-base font-bold ${isFinanceTheme ? 'text-white' : 'text-gray-800'}`}>
                {isLogin ? '账号登录' : '注册账号'}
              </h2>
              <button
                onClick={() => setIsLogin(!isLogin)}
                className={`${isFinanceTheme ? 'text-[#F59E0B]' : textColor} text-xs font-bold`}
              >
                {isLogin ? '去注册' : '去登录'}
              </button>
            </div>

            {error && (
              <div className={`${isFinanceTheme ? 'bg-[#334155] border border-[#475569]' : 'bg-rose-50 border border-rose-200'} rounded-lg p-2 mb-3`}>
                <p className={`${isFinanceTheme ? 'text-rose-400' : 'text-rose-600'} text-sm font-medium`}>{error}</p>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-3">
              {!isLogin && (
                <div>
                  <label className={`block text-xs font-bold ${isFinanceTheme ? 'text-white/70' : 'text-gray-500'} mb-1`}>姓名</label>
                  <div className="relative">
                    <User className={`absolute left-3 top-1/2 -translate-y-1/2 ${isFinanceTheme ? 'text-white/50' : 'text-gray-400'}`} size={16} />
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="请输入姓名"
                      className={`w-full pl-9 pr-4 py-2.5 ${isFinanceTheme ? 'bg-[#334155] border border-[#475569] text-white placeholder-white/40' : 'bg-gray-50 border border-gray-100'} rounded-lg focus:border-[#F59E0B] focus:ring-1 focus:ring-[#F59E0B] outline-none text-sm`}
                    />
                  </div>
                </div>
              )}

              {!isLogin && (
                <div>
                  <label className={`block text-xs font-bold ${isFinanceTheme ? 'text-white/70' : 'text-gray-500'} mb-1`}>部门</label>
                  <div className="relative">
                    <User className={`absolute left-3 top-1/2 -translate-y-1/2 ${isFinanceTheme ? 'text-white/50' : 'text-gray-400'}`} size={16} />
                    <input
                      type="text"
                      value={department}
                      onChange={(e) => setDepartment(e.target.value)}
                      placeholder="请输入部门"
                      className={`w-full pl-9 pr-4 py-2.5 ${isFinanceTheme ? 'bg-[#334155] border border-[#475569] text-white placeholder-white/40' : 'bg-gray-50 border border-gray-100'} rounded-lg focus:border-[#F59E0B] focus:ring-1 focus:ring-[#F59E0B] outline-none text-sm`}
                    />
                  </div>
                </div>
              )}

              <div>
                <label className={`block text-xs font-bold ${isFinanceTheme ? 'text-white/70' : 'text-gray-500'} mb-1`}>邮箱</label>
                <div className="relative">
                  <Mail className={`absolute left-3 top-1/2 -translate-y-1/2 ${isFinanceTheme ? 'text-white/50' : 'text-gray-400'}`} size={16} />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="请输入邮箱"
                    className={`w-full pl-9 pr-4 py-2.5 ${isFinanceTheme ? 'bg-[#334155] border border-[#475569] text-white placeholder-white/40' : 'bg-gray-50 border border-gray-100'} rounded-lg focus:border-[#F59E0B] focus:ring-1 focus:ring-[#F59E0B] outline-none text-sm`}
                  />
                </div>
              </div>

              <div>
                <label className={`block text-xs font-bold ${isFinanceTheme ? 'text-white/70' : 'text-gray-500'} mb-1`}>密码</label>
                <div className="relative">
                  <Lock className={`absolute left-3 top-1/2 -translate-y-1/2 ${isFinanceTheme ? 'text-white/50' : 'text-gray-400'}`} size={16} />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="请输入密码"
                    className={`w-full pl-9 pr-9 py-2.5 ${isFinanceTheme ? 'bg-[#334155] border border-[#475569] text-white placeholder-white/40' : 'bg-gray-50 border border-gray-100'} rounded-lg focus:border-[#F59E0B] focus:ring-1 focus:ring-[#F59E0B] outline-none text-sm`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className={`absolute right-3 top-1/2 -translate-y-1/2 ${isFinanceTheme ? 'text-white/50' : 'text-gray-400'}`}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading || isLoading}
                className={`w-full py-3 ${isFinanceTheme ? 'bg-[#F59E0B] text-[#0F172A]' : accentColor} rounded-lg font-bold shadow-md hover:shadow-lg active:scale-[0.98] transition-all flex items-center justify-center space-x-2 ${(loading || isLoading) ? 'opacity-70 cursor-not-allowed' : ''}`}
              >
                <span>{isLogin ? '登录' : '注册'}</span>
                <ArrowRight size={16} />
              </button>
            </form>

            {/* 测试账号提示 */}
            <div className={`mt-4 ${isFinanceTheme ? 'bg-[#334155] border border-[#475569]' : 'bg-gray-50 border border-gray-100'} rounded-lg p-3`}>
              <p className={`text-xs ${isFinanceTheme ? 'text-[#F59E0B]' : 'text-gray-500'} font-semibold mb-1`}>测试账号:</p>
              <div className="space-y-1 text-[9px]">
                <p className={`${isFinanceTheme ? 'text-white' : 'text-gray-600'}`}>管理员: admin@company.com / 123456</p>
                <p className={`${isFinanceTheme ? 'text-white' : 'text-gray-600'}`}>员工: user@company.com / 123456</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AuthView;
