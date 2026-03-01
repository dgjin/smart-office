import React, { useState, useEffect } from 'react';
import { Key, Eye, EyeOff, Save, AlertCircle, CheckCircle } from 'lucide-react';
import { encryptApiKey, decryptApiKey, isValidApiKey } from '../../utils/crypto';

interface ApiKeySettingsProps {
  currentUser: any;
  onSave: (encryptedKey: string) => Promise<void>;
  theme?: string;
}

export const ApiKeySettings: React.FC<ApiKeySettingsProps> = ({ 
  currentUser, 
  onSave,
  theme = 'blue'
}) => {
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const isFinanceTheme = theme === 'finance';
  const darkBg = isFinanceTheme ? 'bg-[#1E293B] border-[#334155]' : 'bg-white border-gray-100';
  const darkText = isFinanceTheme ? 'text-white' : 'text-gray-800';
  const darkSubtext = isFinanceTheme ? 'text-white/60' : 'text-gray-400';
  const darkInput = isFinanceTheme ? 'bg-[#334155] border-[#475569] text-white' : 'bg-gray-50 border-gray-200 text-gray-800';
  const darkSecondary = isFinanceTheme ? 'bg-[#334155] text-white/80' : 'bg-gray-100 text-gray-600';

  useEffect(() => {
    if (currentUser?.encryptedApiKey) {
      const decrypted = decryptApiKey(currentUser.encryptedApiKey);
      setApiKey(decrypted);
    }
  }, [currentUser?.encryptedApiKey]);

  const handleSave = async () => {
    if (apiKey && !isValidApiKey(apiKey)) {
      setMessage({ type: 'error', text: '请输入有效的 Google API Key (以 AIza 开头)' });
      return;
    }

    setSaving(true);
    setMessage(null);

    try {
      const encrypted = encryptApiKey(apiKey);
      await onSave(encrypted);
      setMessage({ type: 'success', text: 'API Key 保存成功' });
    } catch (error) {
      setMessage({ type: 'error', text: '保存失败，请重试' });
    } finally {
      setSaving(false);
    }
  };

  const handleClear = () => {
    setApiKey('');
    setMessage(null);
  };

  return (
    <div className="p-4">
      <div className="flex items-center mb-4">
        <Key size={20} className={`mr-2 ${isFinanceTheme ? 'text-yellow-400' : 'text-blue-600'}`} />
        <h2 className={`text-lg font-bold ${darkText}`}>API Key 设置</h2>
      </div>

      <div className={`${darkBg} rounded-xl border p-4 mb-4`}>
        <p className={`text-sm ${darkSubtext} mb-4`}>
          配置您的 Google Gemini API Key，用于智能会议室推荐功能。
          Key 将加密保存在服务器端。
        </p>

        <div className="mb-4">
          <label className={`block text-sm font-medium ${darkText} mb-2`}>
            Google API Key
          </label>
          <div className="relative">
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="输入您的 API Key"
              className={`w-full px-3 py-2 pr-10 rounded-lg border ${darkInput} focus:outline-none focus:ring-2 focus:ring-blue-500`}
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className={`absolute right-2 top-1/2 -translate-y-1/2 ${darkSubtext}`}
            >
              {showKey ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          <p className={`text-xs ${darkSubtext} mt-1`}>
            API Key 以 AIza 开头，可在 Google AI Studio 获取
          </p>
        </div>

        {message && (
          <div className={`flex items-center p-3 rounded-lg mb-4 ${
            message.type === 'success' 
              ? (isFinanceTheme ? 'bg-green-900/50 text-green-400' : 'bg-green-50 text-green-600')
              : (isFinanceTheme ? 'bg-red-900/50 text-red-400' : 'bg-red-50 text-red-600')
          }`}>
            {message.type === 'success' ? <CheckCircle size={16} className="mr-2" /> : <AlertCircle size={16} className="mr-2" />}
            <span className="text-sm">{message.text}</span>
          </div>
        )}

        <div className="flex space-x-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className={`flex-1 flex items-center justify-center py-2.5 rounded-lg font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition-colors`}
          >
            <Save size={16} className="mr-2" />
            {saving ? '保存中...' : '保存'}
          </button>
          <button
            onClick={handleClear}
            disabled={!apiKey || saving}
            className={`px-4 py-2.5 rounded-lg font-medium border ${darkBorder} ${darkText} hover:bg-opacity-50 disabled:opacity-50 transition-colors`}
          >
            清除
          </button>
        </div>
      </div>

      <div className={`${darkSecondary} rounded-lg p-4 text-sm`}>
        <h4 className={`font-bold ${darkText} mb-2`}>如何获取 API Key？</h4>
        <ol className={`${darkSubtext} list-decimal list-inside space-y-1`}>
          <li>访问 <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-blue-500 underline">Google AI Studio</a></li>
          <li>使用 Google 账号登录</li>
          <li>点击 "Create API Key"</li>
          <li>复制生成的 Key 并粘贴到上方输入框</li>
        </ol>
      </div>
    </div>
  );
};

export default ApiKeySettings;
