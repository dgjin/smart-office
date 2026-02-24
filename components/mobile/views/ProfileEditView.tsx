import React, { useState, useRef } from 'react';
import { ChevronLeft, User, Mail, Phone, Building2, Save, Camera } from 'lucide-react';
import { updateUser } from '../../../services/supabaseService';
import { User as UserType } from '../../../types';

interface ProfileEditViewProps {
  currentUser: UserType;
  departments: string[];
  theme: string;
  onBack: () => void;
  onUpdate: (user: UserType) => void;
}

export const ProfileEditView: React.FC<ProfileEditViewProps> = ({
  currentUser,
  departments,
  theme,
  onBack,
  onUpdate
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [formData, setFormData] = useState({
    name: currentUser.name || '',
    email: currentUser.email || '',
    mobile: currentUser.mobile || '',
    landline: currentUser.landline || '',
    department: currentUser.department || '',
    avatar: currentUser.avatar || ''
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Theme variables
  const isFinanceTheme = theme === 'finance';
  const themeColors = {
    bg: isFinanceTheme ? 'bg-[#1E293B]' : 'bg-white',
    border: isFinanceTheme ? 'border-[#334155]' : 'border-gray-100',
    text: isFinanceTheme ? 'text-white' : 'text-gray-800',
    lightText: isFinanceTheme ? 'text-gray-400' : 'text-gray-400',
    accent: isFinanceTheme ? 'bg-[#F59E0B] text-[#0F172A]' : `bg-${theme}-600 text-white`,
    accentColor: isFinanceTheme ? '#F59E0B' : '',
    inputBg: isFinanceTheme ? 'bg-[#334155] text-white' : 'bg-transparent text-gray-800',
    cardBg: isFinanceTheme ? 'bg-[#1E293B]' : 'bg-white',
    error: isFinanceTheme ? 'bg-red-900/40 text-red-400 border-red-800' : 'bg-rose-50 text-rose-600 border-rose-100',
    success: isFinanceTheme ? 'bg-green-900/40 text-green-400 border-green-800' : 'bg-emerald-50 text-emerald-600 border-emerald-100',
    info: isFinanceTheme ? 'bg-gray-800/50 text-gray-300 border-gray-700' : 'bg-gray-50 text-gray-500 border-gray-100'
  };

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('请选择图片文件');
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setError('图片大小不能超过 2MB');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      setFormData({ ...formData, avatar: base64 });
      setError(null);
    };
    reader.onerror = () => {
      setError('图片读取失败，请重试');
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async () => {
    if (!formData.name.trim()) {
      setError('姓名不能为空');
      return;
    }
    
    if (!formData.email.trim()) {
      setError('邮箱不能为空');
      return;
    }

    setSaving(true);
    setError(null);
    
    try {
      const updatedUser = await updateUser(currentUser.id, formData);
      onUpdate(updatedUser);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
    } catch (err) {
      console.error('更新个人信息失败:', err);
      setError('保存失败，请检查网络连接');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`min-h-screen pb-28 transition-colors duration-300 ${isFinanceTheme ? 'bg-[#0F172A]' : 'bg-gray-50'}`}>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        className="hidden"
      />

      <div className={`p-4 transition-all duration-300 ${isFinanceTheme ? 'bg-[#1E293B] border-[#334155]' : `bg-${theme}-600`} text-white border-b`}>
        <div className="flex items-center space-x-3">
          <button onClick={onBack} className={`p-2 -ml-2 transition-colors duration-300 ${isFinanceTheme ? 'hover:bg-white/10 rounded-full' : ''}`}>
            <ChevronLeft size={24} />
          </button>
          <h1 className="text-lg font-bold">个人信息</h1>
        </div>
      </div>

      <div className={`flex flex-col items-center py-6 border-b transition-all duration-300 ${themeColors.cardBg} ${themeColors.border}`}>
        <button onClick={handleAvatarClick} className="relative group transition-all duration-300 hover:scale-105">
          {formData.avatar ? (
            <img 
              src={formData.avatar} 
              alt="头像" 
              className={`w-20 h-20 rounded-full object-cover border-2 transition-all duration-300 ${isFinanceTheme ? 'border-[#334155]' : 'border-gray-200'}`}
            />
          ) : (
            <div className={`w-20 h-20 rounded-full flex items-center justify-center text-3xl font-bold transition-all duration-300 ${isFinanceTheme ? 'bg-[#334155] text-[#F59E0B]' : `bg-${theme}-100 text-${theme}-600`}`}>
              {formData.name[0] || '?'}
            </div>
          )}
          <div className={`absolute bottom-0 right-0 w-8 h-8 rounded-full flex items-center justify-center shadow-lg group-hover:scale-110 transition-all duration-300 ${isFinanceTheme ? 'bg-[#F59E0B] text-[#0F172A]' : `bg-${theme}-600 text-white`}`}>
            <Camera size={16} />
          </div>
        </button>
        <p className={`text-xs mt-2 transition-colors duration-300 ${themeColors.lightText}`}>点击更换头像</p>
      </div>

      <div className="p-4 space-y-4">
        {error && (
          <div className={`rounded-xl p-3 text-sm transition-all duration-300 ${themeColors.error} border`}>
            {error}
          </div>
        )}
        
        {success && (
          <div className={`rounded-xl p-3 text-sm flex items-center space-x-2 transition-all duration-300 ${themeColors.success} border`}>
            <Save size={16} />
            <span>保存成功！</span>
          </div>
        )}

        <div className={`rounded-2xl border overflow-hidden transition-all duration-300 ${themeColors.cardBg} ${themeColors.border}`}>
          <div className={`p-4 border-b transition-all duration-300 ${isFinanceTheme ? 'border-[#334155]' : 'border-gray-50'}`}>
            <label className={`text-[10px] font-bold uppercase block mb-2 transition-colors duration-300 ${themeColors.lightText}`}>
              <User size={12} className="inline mr-1" /> 姓名 *
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={e => setFormData({...formData, name: e.target.value})}
              className={`w-full font-medium outline-none transition-all duration-300 ${themeColors.inputBg} focus:ring-2 focus:ring-offset-2 ${isFinanceTheme ? 'focus:ring-[#F59E0B]/30' : 'focus:ring-indigo-200'}`}
              placeholder={isFinanceTheme ? "请输入姓名" : "请输入姓名"}
            />
          </div>

          <div className={`p-4 border-b transition-all duration-300 ${isFinanceTheme ? 'border-[#334155]' : 'border-gray-50'}`}>
            <label className={`text-[10px] font-bold uppercase block mb-2 transition-colors duration-300 ${themeColors.lightText}`}>
              <Mail size={12} className="inline mr-1" /> 邮箱 *
            </label>
            <input
              type="email"
              value={formData.email}
              onChange={e => setFormData({...formData, email: e.target.value})}
              className={`w-full font-medium outline-none transition-all duration-300 ${themeColors.inputBg} focus:ring-2 focus:ring-offset-2 ${isFinanceTheme ? 'focus:ring-[#F59E0B]/30' : 'focus:ring-indigo-200'}`}
              placeholder={isFinanceTheme ? "请输入邮箱" : "请输入邮箱"}
            />
          </div>

          <div className={`p-4 border-b transition-all duration-300 ${isFinanceTheme ? 'border-[#334155]' : 'border-gray-50'}`}>
            <label className={`text-[10px] font-bold uppercase block mb-2 transition-colors duration-300 ${themeColors.lightText}`}>
              <Phone size={12} className="inline mr-1" /> 手机号
            </label>
            <input
              type="tel"
              value={formData.mobile}
              onChange={e => setFormData({...formData, mobile: e.target.value})}
              className={`w-full font-medium outline-none transition-all duration-300 ${themeColors.inputBg} focus:ring-2 focus:ring-offset-2 ${isFinanceTheme ? 'focus:ring-[#F59E0B]/30' : 'focus:ring-indigo-200'}`}
              placeholder={isFinanceTheme ? "请输入手机号" : "请输入手机号"}
            />
          </div>

          <div className={`p-4 border-b transition-all duration-300 ${isFinanceTheme ? 'border-[#334155]' : 'border-gray-50'}`}>
            <label className={`text-[10px] font-bold uppercase block mb-2 transition-colors duration-300 ${themeColors.lightText}`}>
              <Phone size={12} className="inline mr-1" /> 座机
            </label>
            <input
              type="tel"
              value={formData.landline}
              onChange={e => setFormData({...formData, landline: e.target.value})}
              className={`w-full font-medium outline-none transition-all duration-300 ${themeColors.inputBg} focus:ring-2 focus:ring-offset-2 ${isFinanceTheme ? 'focus:ring-[#F59E0B]/30' : 'focus:ring-indigo-200'}`}
              placeholder={isFinanceTheme ? "请输入座机号" : "请输入座机号"}
            />
          </div>

          <div className="p-4">
            <label className={`text-[10px] font-bold uppercase block mb-2 transition-colors duration-300 ${themeColors.lightText}`}>
              <Building2 size={12} className="inline mr-1" /> 部门
            </label>
            <select
              value={formData.department}
              onChange={e => setFormData({...formData, department: e.target.value})}
              className={`w-full font-medium outline-none transition-all duration-300 ${themeColors.inputBg} focus:ring-2 focus:ring-offset-2 ${isFinanceTheme ? 'focus:ring-[#F59E0B]/30' : 'focus:ring-indigo-200'}`}
            >
              <option value="">请选择部门</option>
              {departments.map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
        </div>

        <div className={`rounded-xl p-4 text-xs transition-all duration-300 ${themeColors.info} border`}>
          <p className={`font-medium mb-1 transition-colors duration-300 ${themeColors.text}`}>提示：</p>
          <ul className="list-disc list-inside space-y-1">
            <li>带 * 的为必填项</li>
            <li>头像支持 jpg/png 格式，最大 2MB</li>
            <li>修改信息后请点击保存按钮</li>
          </ul>
        </div>

        <button
          onClick={handleSubmit}
          disabled={saving}
          className={`w-full py-3.5 rounded-xl font-bold shadow-lg disabled:opacity-50 flex items-center justify-center space-x-2 transition-all duration-300 ${isFinanceTheme ? 'bg-[#F59E0B] text-[#0F172A] shadow-[#F59E0B]/20 hover:shadow-[#F59E0B]/40' : `bg-${theme}-600 text-white shadow-${theme}-100 hover:shadow-${theme}-200`}`}
        >
          {saving ? (
            <>
              <div className={`w-5 h-5 border-2 border-t-transparent rounded-full animate-spin ${isFinanceTheme ? 'border-[#0F172A]' : 'border-white'}`} />
              <span>保存中...</span>
            </>
          ) : (
            <>
              <Save size={18} />
              <span>保存修改</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default ProfileEditView;
