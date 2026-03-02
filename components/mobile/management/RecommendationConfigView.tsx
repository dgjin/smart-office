import React, { useState } from 'react';
import { Settings, Sliders, Save, RotateCcw, Sparkles } from 'lucide-react';
import { MobileAdminPage } from '../common/MobileAdminPage';
import { 
  getRecommendationConfig, 
  saveRecommendationConfig, 
  RecommendationConfig,
  DEFAULT_RECOMMENDATION_CONFIG
} from '../../../services/recommendationService';

interface RecommendationConfigProps {
  theme: string;
  onBack: () => void;
}

export const RecommendationConfigView: React.FC<RecommendationConfigProps> = ({
  theme,
  onBack
}) => {
  const [config, setConfig] = useState<RecommendationConfig>(getRecommendationConfig());
  const [saved, setSaved] = useState(false);

  const isFinanceTheme = theme === 'finance';
  const darkBg = isFinanceTheme ? 'bg-[#1E293B] border-[#334155]' : 'bg-white border-gray-100';
  const darkText = isFinanceTheme ? 'text-white' : 'text-gray-800';
  const darkSubtext = isFinanceTheme ? 'text-white/60' : 'text-gray-400';
  const darkBorder = isFinanceTheme ? 'border-[#334155]' : 'border-gray-100';
  const darkCardBg = isFinanceTheme ? 'bg-[#1E293B]' : 'bg-white';
  const darkInput = isFinanceTheme ? 'bg-[#334155] border-[#475569] text-white' : 'bg-gray-50 border-gray-200 text-gray-800';

  const handleSave = () => {
    saveRecommendationConfig(config);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleReset = () => {
    setConfig(DEFAULT_RECOMMENDATION_CONFIG);
  };

  const updateWeight = (key: keyof RecommendationConfig, value: number) => {
    setConfig(prev => ({ ...prev, [key]: value / 100 }));
  };

  const totalWeight = 
    config.capacityWeight + 
    config.featureWeight + 
    config.historyWeight + 
    config.availabilityWeight;

  const weightLabels: Record<keyof RecommendationConfig, { label: string; desc: string }> = {
    capacityWeight: { label: '容量匹配度', desc: '会议室容量与参会人数的匹配程度' },
    featureWeight: { label: '设施匹配度', desc: '会议室设施与需求的匹配程度' },
    historyWeight: { label: '历史偏好', desc: '用户历史预订偏好的权重' },
    availabilityWeight: { label: '可用性', desc: '会议室在请求时段的可用程度' },
  };

  return (
    <MobileAdminPage
      title="推荐算法配置"
      theme={theme}
      onBack={onBack}
    >
      <div className="space-y-4">
        {/* 提示信息 */}
        <div className={`${darkCardBg} rounded-xl border ${darkBorder} p-4`}>
          <div className="flex items-start space-x-3">
            <Sparkles size={20} className="text-yellow-500 mt-0.5" />
            <div>
              <h4 className={`font-bold ${darkText}`}>智能推荐配置</h4>
              <p className={`text-sm ${darkSubtext} mt-1`}>
                调整各项权重以优化推荐算法的行为。所有权重值范围为 0-1，建议总和为 1.0。
              </p>
            </div>
          </div>
        </div>

        {/* 权重配置 */}
        <div className={`${darkCardBg} rounded-xl border ${darkBorder} p-4`}>
          <h4 className={`font-bold ${darkText} mb-4 flex items-center`}>
            <Sliders size={16} className="mr-2" />
            权重设置
          </h4>
          
          <div className="space-y-5">
            {(Object.keys(weightLabels) as Array<keyof RecommendationConfig>).map(key => (
              <div key={key}>
                <div className="flex justify-between items-center mb-2">
                  <span className={`text-sm font-medium ${darkText}`}>{weightLabels[key].label}</span>
                  <span className={`text-sm ${darkSubtext}`}>{(config[key] * 100).toFixed(0)}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={config[key] * 100}
                  onChange={(e) => updateWeight(key, parseInt(e.target.value))}
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                />
                <p className={`text-xs ${darkSubtext} mt-1`}>{weightLabels[key].desc}</p>
              </div>
            ))}
          </div>

          {/* 总权重提示 */}
          <div className={`mt-4 pt-4 border-t ${darkBorder}`}>
            <div className="flex justify-between items-center">
              <span className={`text-sm ${darkText}`}>总权重</span>
              <span className={`text-sm font-bold ${
                Math.abs(totalWeight - 1) < 0.01 ? 'text-green-500' : 'text-red-500'
              }`}>
                {totalWeight.toFixed(2)}
              </span>
            </div>
            {Math.abs(totalWeight - 1) > 0.01 && (
              <p className={`text-xs text-red-500 mt-1`}>建议将总权重调整为 1.0 以获得最佳推荐效果</p>
            )}
          </div>
        </div>

        {/* 按钮操作 */}
        <div className="flex space-x-3">
          <button
            onClick={handleReset}
            className={`flex-1 py-3 rounded-xl font-bold border ${darkBorder} ${darkText} flex items-center justify-center`}
          >
            <RotateCcw size={16} className="mr-2" />
            重置默认
          </button>
          <button
            onClick={handleSave}
            className={`flex-1 py-3 rounded-xl font-bold text-white flex items-center justify-center ${
              saved ? 'bg-green-500' : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            <Save size={16} className="mr-2" />
            {saved ? '已保存' : '保存配置'}
          </button>
        </div>

        {/* 算法说明 */}
        <div className={`${darkCardBg} rounded-xl border ${darkBorder} p-4`}>
          <h4 className={`font-bold ${darkText} mb-3`}>算法说明</h4>
          <div className={`text-sm ${darkSubtext} space-y-2`}>
            <p>推荐算法综合考虑以下因素：</p>
            <ul className="list-disc list-inside space-y-1">
              <li><span className={darkText}>容量匹配度</span>：会议室容量是否适合参会人数</li>
              <li><span className={darkText}>设施匹配度</span>：会议室是否具备所需的设备设施</li>
              <li><span className={darkText}>历史偏好</span>：用户过去选择会议室的习惯</li>
              <li><span className={darkText}>可用性</span>：所选时段会议室是否空闲</li>
            </ul>
            <p className="mt-2">最终推荐分数 = 容量分数×容量权重 + 设施分数×设施权重 + 历史分数×历史权重 + 可用性分数×可用性权重</p>
          </div>
        </div>
      </div>
    </MobileAdminPage>
  );
};
