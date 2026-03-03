import React, { useState, useEffect } from 'react';
import { Settings, ChevronLeft, Save, Clock, AlertCircle } from 'lucide-react';

interface SystemConfigViewProps {
  theme: string;
  onClose: () => void;
}

// 默认配置
const DEFAULT_MAX_BOOKING_DAYS = 20;

export const SystemConfigView: React.FC<SystemConfigViewProps> = ({
  theme,
  onClose
}) => {
  const [maxBookingDays, setMaxBookingDays] = useState(DEFAULT_MAX_BOOKING_DAYS);
  const [isLoading, setIsLoading] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isFinanceTheme = theme === 'finance';

  const themeColors = {
    bg: isFinanceTheme ? 'bg-[#0F172A]' : 'bg-gray-50',
    cardBg: isFinanceTheme ? 'bg-[#1E293B]' : 'bg-white',
    text: isFinanceTheme ? 'text-white' : 'text-gray-800',
    subtext: isFinanceTheme ? 'text-white/60' : 'text-gray-500',
    border: isFinanceTheme ? 'border-[#334155]' : 'border-gray-200',
    inputBg: isFinanceTheme ? 'bg-[#334155] text-white' : 'bg-gray-50 text-gray-800',
    primary: isFinanceTheme ? 'bg-[#F59E0B] text-[#0F172A]' : `bg-${theme}-600 text-white`,
    primaryText: isFinanceTheme ? 'text-[#F59E0B]' : `text-${theme}-600`,
    headerBg: isFinanceTheme ? 'bg-[#1E293B] border-[#334155]' : `bg-${theme}-600`,
  };

  // 加载配置
  useEffect(() => {
    const loadConfig = () => {
      try {
        const savedConfig = localStorage.getItem('systemConfig');
        if (savedConfig) {
          const config = JSON.parse(savedConfig);
          if (config.maxBookingDays) {
            setMaxBookingDays(config.maxBookingDays);
          }
        }
      } catch (err) {
        console.error('加载配置失败:', err);
      }
    };

    loadConfig();
  }, []);

  const handleSave = async () => {
    setIsLoading(true);
    setError(null);
    setSaveSuccess(false);

    try {
      // 验证输入
      if (maxBookingDays < 1 || maxBookingDays > 365) {
        setError('最长预订天数必须在 1-365 之间');
        setIsLoading(false);
        return;
      }

      // 保存到本地存储（实际项目中应该保存到后端）
      const config = {
        maxBookingDays,
        updatedAt: new Date().toISOString(),
      };

      localStorage.setItem('systemConfig', JSON.stringify(config));

      // 触发全局配置更新事件
      window.dispatchEvent(new CustomEvent('systemConfigUpdated', { detail: config }));

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setError('保存配置失败，请重试');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={`min-h-screen ${themeColors.bg} pb-24`}>
      {/* Header */}
      <div className={`${themeColors.headerBg} text-white p-4 border-b ${themeColors.border}`}>
        <div className="flex items-center">
          <button
            onClick={onClose}
            className="p-2 -ml-2 mr-3 hover:bg-white/10 rounded-lg transition-colors"
          >
            <ChevronLeft size={24} />
          </button>
          <div>
            <h1 className="text-lg font-bold">系统配置</h1>
            <p className="text-xs text-white/70">管理全局系统设置</p>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* 配置卡片 */}
        <div className={`${themeColors.cardBg} p-5 rounded-2xl border ${themeColors.border}`}>
          <div className="flex items-center space-x-3 mb-6">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${isFinanceTheme ? 'bg-[#F59E0B]/20' : 'bg-indigo-50'}`}>
              <Settings size={24} className={themeColors.primaryText} />
            </div>
            <div>
              <h2 className={`font-bold ${themeColors.text}`}>预订设置</h2>
              <p className={`text-xs ${themeColors.subtext}`}>配置会议室预订相关参数</p>
            </div>
          </div>

          {/* 最长预订天数设置 */}
          <div className="space-y-4">
            <div>
              <label className={`text-sm font-medium ${themeColors.text} block mb-2`}>
                最长预订时间（天）
              </label>
              <div className="flex items-center space-x-4">
                <div className="flex-1">
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={maxBookingDays}
                    onChange={(e) => setMaxBookingDays(parseInt(e.target.value) || 1)}
                    className={`w-full p-4 rounded-xl border-2 text-lg font-bold text-center transition-all duration-300 ${themeColors.inputBg} ${isFinanceTheme ? 'border-[#334155] focus:border-[#F59E0B]' : 'border-gray-200 focus:border-indigo-500'} outline-none`}
                  />
                </div>
                <span className={`text-sm ${themeColors.subtext}`}>天</span>
              </div>
              <p className={`text-xs mt-2 ${themeColors.subtext}`}>
                设置用户长期预订的最大天数限制，范围 1-365 天
              </p>
            </div>

            {/* 说明信息 */}
            <div className={`p-4 rounded-xl ${isFinanceTheme ? 'bg-[#334155]/50' : 'bg-gray-50'} flex items-start space-x-3`}>
              <Clock size={18} className={`mt-0.5 ${themeColors.subtext}`} />
              <div>
                <p className={`text-sm ${themeColors.text}`}>当前设置说明</p>
                <p className={`text-xs mt-1 ${themeColors.subtext}`}>
                  用户在进行长期预订时，最多可以连续预订 <span className={themeColors.primaryText}>{maxBookingDays}</span> 天。
                  系统将为用户每天创建相同时间段的预订记录。
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* 提示信息 */}
        {error && (
          <div className={`p-4 rounded-xl bg-red-500/10 border border-red-500/30 flex items-center space-x-3`}>
            <AlertCircle size={20} className="text-red-500" />
            <p className="text-sm text-red-500">{error}</p>
          </div>
        )}

        {saveSuccess && (
          <div className={`p-4 rounded-xl ${isFinanceTheme ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-emerald-50 border-emerald-200'} border flex items-center space-x-3`}>
            <div className={`w-5 h-5 rounded-full flex items-center justify-center ${isFinanceTheme ? 'bg-emerald-500' : 'bg-emerald-500'}`}>
              <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className={`text-sm ${isFinanceTheme ? 'text-emerald-400' : 'text-emerald-600'}`}>配置保存成功</p>
          </div>
        )}
      </div>

      {/* 底部保存按钮 */}
      <div className={`fixed bottom-0 left-0 right-0 p-4 border-t ${themeColors.border} ${themeColors.cardBg} safe-area-bottom`}>
        <button
          onClick={handleSave}
          disabled={isLoading}
          className={`w-full py-4 rounded-xl font-bold flex items-center justify-center space-x-2 transition-all duration-300 ${themeColors.primary} ${isLoading ? 'opacity-70 cursor-not-allowed' : 'active:scale-[0.98]'}`}
        >
          {isLoading ? (
            <>
              <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
              <span>保存中...</span>
            </>
          ) : (
            <>
              <Save size={20} />
              <span>保存配置</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};

// 获取系统配置的辅助函数
export const getSystemConfig = (): { maxBookingDays: number } => {
  try {
    const savedConfig = localStorage.getItem('systemConfig');
    if (savedConfig) {
      const config = JSON.parse(savedConfig);
      return {
        maxBookingDays: config.maxBookingDays || DEFAULT_MAX_BOOKING_DAYS,
      };
    }
  } catch (err) {
    console.error('读取配置失败:', err);
  }

  return {
    maxBookingDays: DEFAULT_MAX_BOOKING_DAYS,
  };
};

export default SystemConfigView;
