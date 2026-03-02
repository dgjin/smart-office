import React, { useState, useEffect } from 'react';
import { Sparkles, Check, X, Clock, Users, Zap, Video, Coffee, Monitor, ArrowRight } from 'lucide-react';
import { Resource, Booking, ResourceType } from '../../types';
import { 
  RecommendationResult,
  getRecommendations,
  getRecommendationConfig,
  createRecommendationRequest
} from '../../../services/recommendationService';

interface RoomRecommendationListProps {
  userId: string;
  resources: Resource[];
  userBookings: Booking[];
  theme: string;
  onSelect: (resource: Resource) => void;
  onClose: () => void;
}

const FEATURE_OPTIONS = [
  { id: 'video', label: '视频会议', icon: Video },
  { id: 'display', label: '投屏显示器', icon: Monitor },
  { id: 'whiteboard', label: '白板', icon: Coffee },
];

export const RoomRecommendationList: React.FC<RoomRecommendationListProps> = ({
  userId,
  resources,
  userBookings,
  theme,
  onSelect,
  onClose
}) => {
  const [step, setStep] = useState<'input' | 'result'>('input');
  const [recommendations, setRecommendations] = useState<RecommendationResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  
  const [formData, setFormData] = useState({
    resourceType: 'ROOM' as ResourceType,
    participants: 2,
    date: new Date().toISOString().split('T')[0],
    startTime: '09:00',
    endTime: '10:00',
    requiredFeatures: [] as string[],
    purpose: '',
  });

  const isFinanceTheme = theme === 'finance';
  const darkBg = isFinanceTheme ? 'bg-[#1E293B]' : 'bg-white';
  const darkText = isFinanceTheme ? 'text-white' : 'text-gray-800';
  const darkSubtext = isFinanceTheme ? 'text-white/60' : 'text-gray-500';
  const darkBorder = isFinanceTheme ? 'border-[#334155]' : 'border-gray-200';
  const darkCardBg = isFinanceTheme ? 'bg-[#1E293B]' : 'bg-white';
  const darkInputBg = isFinanceTheme ? 'bg-[#334155]' : 'bg-gray-50';

  const handleFeatureToggle = (featureId: string) => {
    setFormData(prev => ({
      ...prev,
      requiredFeatures: prev.requiredFeatures.includes(featureId)
        ? prev.requiredFeatures.filter(f => f !== featureId)
        : [...prev.requiredFeatures, featureId]
    }));
  };

  const handleSearch = async () => {
    setIsLoading(true);
    try {
      const config = getRecommendationConfig();
      const startTime = `${formData.date}T${formData.startTime}:00`;
      const endTime = `${formData.date}T${formData.endTime}:00`;
      
      const request = createRecommendationRequest(
        userId,
        formData.resourceType,
        startTime,
        endTime,
        formData.participants,
        formData.requiredFeatures,
        formData.purpose
      );
      
      const result = getRecommendations(request, resources, userBookings, config);
      setRecommendations(result);
      setStep('result');
    } catch (error) {
      console.error('Failed to get recommendations:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-500';
    if (score >= 60) return 'text-yellow-500';
    return 'text-red-500';
  };

  const getScoreBg = (score: number) => {
    if (score >= 80) return 'bg-green-500';
    if (score >= 60) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  const timeOptions = Array.from({ length: 28 }, (_, i) => {
    const hour = Math.floor(i / 2) + 8;
    const minute = (i % 2) * 30;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  });

  if (step === 'input') {
    return (
      <div className={`fixed inset-0 z-[250] bg-black/50 flex items-center justify-center p-4`} onClick={onClose}>
        <div className={`${darkCardBg} rounded-2xl max-w-lg w-full max-h-[85vh] overflow-hidden flex flex-col`} onClick={e => e.stopPropagation()}>
          <div className={`p-4 border-b ${darkBorder} flex items-center justify-between`}>
            <div className="flex items-center">
              <Sparkles size={20} className="text-yellow-500 mr-2" />
              <h3 className={`font-bold ${darkText}`}>智能推荐</h3>
            </div>
            <button onClick={onClose} className={`p-1 ${darkSubtext} hover:${darkText}`}>
              <X size={20} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <p className={`text-sm ${darkSubtext}`}>
              请先填写您的会议需求，我们将为您推荐最合适的会议室
            </p>

            <div>
              <label className={`text-xs font-bold ${darkSubtext} mb-2 block`}>会议类型</label>
              <div className="flex space-x-2">
                {(['ROOM', 'DESK'] as const).map(type => (
                  <button
                    key={type}
                    onClick={() => setFormData(prev => ({ ...prev, resourceType: type }))}
                    className={`flex-1 py-2 rounded-lg text-sm font-bold border ${
                      formData.resourceType === type 
                        ? 'bg-blue-600 border-blue-600 text-white' 
                        : `${darkBorder} ${darkText}`
                    }`}
                  >
                    {type === 'ROOM' ? '会议室' : '工位'}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className={`text-xs font-bold ${darkSubtext} mb-2 block`}>参会人数</label>
              <div className="flex items-center space-x-3">
                <button
                  onClick={() => setFormData(prev => ({ ...prev, participants: Math.max(1, prev.participants - 1) }))}
                  className={`w-10 h-10 rounded-lg ${darkInputBg} ${darkText} font-bold`}
                >
                  -
                </button>
                <span className={`flex-1 text-center font-bold text-lg ${darkText}`}>{formData.participants} 人</span>
                <button
                  onClick={() => setFormData(prev => ({ ...prev, participants: Math.min(20, prev.participants + 1) }))}
                  className={`w-10 h-10 rounded-lg ${darkInputBg} ${darkText} font-bold`}
                >
                  +
                </button>
              </div>
            </div>

            <div>
              <label className={`text-xs font-bold ${darkSubtext} mb-2 block`}>日期</label>
              <input
                type="date"
                value={formData.date}
                onChange={(e) => setFormData(prev => ({ ...prev, date: e.target.value }))}
                className={`w-full p-3 rounded-lg ${darkInputBg} ${darkText} border ${darkBorder}`}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={`text-xs font-bold ${darkSubtext} mb-2 block`}>开始时间</label>
                <select
                  value={formData.startTime}
                  onChange={(e) => setFormData(prev => ({ ...prev, startTime: e.target.value }))}
                  className={`w-full p-3 rounded-lg ${darkInputBg} ${darkText} border ${darkBorder}`}
                >
                  {timeOptions.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className={`text-xs font-bold ${darkSubtext} mb-2 block`}>结束时间</label>
                <select
                  value={formData.endTime}
                  onChange={(e) => setFormData(prev => ({ ...prev, endTime: e.target.value }))}
                  className={`w-full p-3 rounded-lg ${darkInputBg} ${darkText} border ${darkBorder}`}
                >
                  {timeOptions.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className={`text-xs font-bold ${darkSubtext} mb-2 block`}>需要设施</label>
              <div className="flex flex-wrap gap-2">
                {FEATURE_OPTIONS.map(feature => (
                  <button
                    key={feature.id}
                    onClick={() => handleFeatureToggle(feature.id)}
                    className={`flex items-center px-3 py-2 rounded-lg text-sm border ${
                      formData.requiredFeatures.includes(feature.id)
                        ? 'bg-blue-600 border-blue-600 text-white'
                        : `${darkBorder} ${darkText}`
                    }`}
                  >
                    <feature.icon size={14} className="mr-1.5" />
                    {feature.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className={`text-xs font-bold ${darkSubtext} mb-2 block`}>会议主题（可选）</label>
              <input
                type="text"
                value={formData.purpose}
                onChange={(e) => setFormData(prev => ({ ...prev, purpose: e.target.value }))}
                placeholder="请输入会议主题..."
                className={`w-full p-3 rounded-lg ${darkInputBg} ${darkText} border ${darkBorder}`}
              />
            </div>
          </div>

          <div className={`p-4 border-t ${darkBorder}`}>
            <button
              onClick={handleSearch}
              disabled={isLoading}
              className={`w-full py-3 rounded-xl font-bold flex items-center justify-center ${
                isLoading ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700'
              } text-white`}
            >
              {isLoading ? (
                <>
                  <Sparkles className="animate-spin mr-2" size={18} />
                  分析中...
                </>
              ) : (
                <>
                  <Sparkles className="mr-2" size={18} />
                  开始智能推荐
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`fixed inset-0 z-[250] bg-black/50 flex items-center justify-center p-4`} onClick={onClose}>
      <div className={`${darkCardBg} rounded-2xl max-w-lg w-full max-h-[85vh] overflow-hidden flex flex-col`} onClick={e => e.stopPropagation()}>
        <div className={`p-4 border-b ${darkBorder} flex items-center justify-between`}>
          <div className="flex items-center">
            <Sparkles size={20} className="text-yellow-500 mr-2" />
            <h3 className={`font-bold ${darkText}`}>推荐结果</h3>
          </div>
          <button onClick={() => setStep('input')} className={`text-sm ${darkSubtext} hover:${darkText}`}>
            修改需求
          </button>
        </div>

        {isLoading ? (
          <div className="flex-1 flex items-center justify-center p-8">
            <div className="text-center">
              <Sparkles className="animate-spin text-blue-500 mx-auto mb-4" size={32} />
              <p className={`${darkText}`}>正在分析推荐...</p>
            </div>
          </div>
        ) : !recommendations || recommendations.recommendations.length === 0 ? (
          <div className="flex-1 flex items-center justify-center p-8">
            <div className="text-center">
              <Sparkles size={48} className={`mx-auto mb-4 ${darkSubtext}`} />
              <p className={`${darkText} font-bold`}>暂无可推荐会议室</p>
              <p className={`${darkSubtext} text-sm mt-2`}>请尝试调整搜索条件</p>
              <button 
                onClick={() => setStep('input')}
                className="mt-4 px-6 py-2 bg-blue-600 text-white rounded-lg font-bold"
              >
                重新搜索
              </button>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {recommendations.recommendations.slice(0, 5).map((rec, index) => (
              <button
                key={rec.resource.id}
                onClick={() => {
                  onSelect(rec.resource);
                  onClose();
                }}
                className={`w-full p-4 rounded-xl border ${darkBorder} ${darkBg} hover:border-blue-500 transition-all text-left`}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1">
                    <div className="flex items-center">
                      <span className={`font-bold ${darkText}`}>{rec.resource.name}</span>
                      {index === 0 && (
                        <span className="ml-2 px-2 py-0.5 bg-yellow-500 text-white text-[10px] rounded-full font-bold">
                          最推荐
                        </span>
                      )}
                    </div>
                    <p className={`text-xs ${darkSubtext}`}>{rec.resource.location} · 容量 {rec.resource.capacity || '?'}人</p>
                  </div>
                  <div className={`flex items-center justify-center w-10 h-10 rounded-lg ${getScoreBg(rec.score)} text-white font-bold`}>
                    {Math.round(rec.score)}
                  </div>
                </div>
                
                <div className="space-y-1">
                  {rec.matchReasons.slice(0, 2).map((reason, i) => (
                    <p key={i} className={`text-xs ${darkSubtext} flex items-start`}>
                      <Check size={12} className="text-green-500 mt-0.5 mr-1 shrink-0" />
                      {reason}
                    </p>
                  ))}
                </div>

                <div className="flex items-center space-x-3 mt-3 pt-3 border-t border-dashed border-gray-600">
                  <div className="flex items-center">
                    <Users size={12} className={darkSubtext} />
                    <span className={`text-[10px] ml-1 ${getScoreColor(rec.capacityScore)}`}>
                      容量 {rec.capacityScore}%
                    </span>
                  </div>
                  <div className="flex items-center">
                    <Zap size={12} className={darkSubtext} />
                    <span className={`text-[10px] ml-1 ${getScoreColor(rec.featureScore)}`}>
                      设施 {rec.featureScore}%
                    </span>
                  </div>
                  <div className="flex items-center">
                    <Sparkles size={12} className={darkSubtext} />
                    <span className={`text-[10px] ml-1 ${getScoreColor(rec.historyScore)}`}>
                      偏好 {rec.historyScore}%
                    </span>
                  </div>
                  <div className="flex items-center">
                    <Clock size={12} className={darkSubtext} />
                    <span className={`text-[10px] ml-1 ${getScoreColor(rec.availabilityScore)}`}>
                      可用 {rec.availabilityScore}%
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        <div className={`p-4 border-t ${darkBorder}`}>
          <button
            onClick={() => setStep('input')}
            className={`w-full py-3 rounded-xl font-bold flex items-center justify-center ${darkInputBg} ${darkText}`}
          >
            <ArrowRight size={18} className="mr-2 rotate-180" />
            重新搜索
          </button>
        </div>
      </div>
    </div>
  );
};
