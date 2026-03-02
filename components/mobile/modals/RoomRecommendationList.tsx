import React, { useState, useEffect } from 'react';
import { Sparkles, Check, X, Clock, Users, Zap } from 'lucide-react';
import { Resource, Booking, ResourceType } from '../../types';
import { 
  RoomRecommendation, 
  RecommendationResult,
  getRecommendations,
  getRecommendationConfig,
  createRecommendationRequest
} from '../../services/recommendationService';

interface RoomRecommendationListProps {
  userId: string;
  resourceType: ResourceType;
  startTime: string;
  endTime: string;
  participants: number;
  requiredFeatures: string[];
  resources: Resource[];
  userBookings: Booking[];
  theme: string;
  onSelect: (resource: Resource) => void;
  onClose: () => void;
}

export const RoomRecommendationList: React.FC<RoomRecommendationListProps> = ({
  userId,
  resourceType,
  startTime,
  endTime,
  participants,
  requiredFeatures,
  resources,
  userBookings,
  theme,
  onSelect,
  onClose
}) => {
  const [recommendations, setRecommendations] = useState<RecommendationResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const isFinanceTheme = theme === 'finance';
  const darkBg = isFinanceTheme ? 'bg-[#1E293B]' : 'bg-white';
  const darkText = isFinanceTheme ? 'text-white' : 'text-gray-800';
  const darkSubtext = isFinanceTheme ? 'text-white/60' : 'text-gray-500';
  const darkBorder = isFinanceTheme ? 'border-[#334155]' : 'border-gray-200';
  const darkCardBg = isFinanceTheme ? 'bg-[#1E293B]' : 'bg-white';

  useEffect(() => {
    const fetchRecommendations = async () => {
      setIsLoading(true);
      try {
        const config = getRecommendationConfig();
        const request = createRecommendationRequest(
          userId,
          resourceType,
          startTime,
          endTime,
          participants,
          requiredFeatures
        );
        const result = getRecommendations(request, resources, userBookings, config);
        setRecommendations(result);
      } catch (error) {
        console.error('Failed to get recommendations:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchRecommendations();
  }, [userId, resourceType, startTime, endTime, participants, requiredFeatures, resources, userBookings]);

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

  if (isLoading) {
    return (
      <div className={`fixed inset-0 z-[250] bg-black/50 flex items-center justify-center p-4`} onClick={onClose}>
        <div className={`${darkCardBg} rounded-2xl p-8 max-w-lg w-full`} onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-center">
            <Sparkles className="animate-spin text-blue-500" size={32} />
            <span className={`ml-3 ${darkText}`}>正在分析推荐...</span>
          </div>
        </div>
      </div>
    );
  }

  if (!recommendations || recommendations.recommendations.length === 0) {
    return (
      <div className={`fixed inset-0 z-[250] bg-black/50 flex items-center justify-center p-4`} onClick={onClose}>
        <div className={`${darkCardBg} rounded-2xl p-6 max-w-lg w-full`} onClick={e => e.stopPropagation()}>
          <div className="text-center">
            <Sparkles size={48} className={`mx-auto mb-4 ${darkSubtext}`} />
            <p className={`${darkText} font-bold`}>暂无可推荐会议室</p>
            <p className={`${darkSubtext} text-sm mt-2`}>请尝试调整搜索条件</p>
          </div>
          <button onClick={onClose} className={`w-full mt-4 py-3 rounded-xl font-bold bg-blue-600 text-white`}>
            关闭
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`fixed inset-0 z-[250] bg-black/50 flex items-center justify-center p-4`} onClick={onClose}>
      <div className={`${darkCardBg} rounded-2xl max-w-lg w-full max-h-[80vh] overflow-hidden flex flex-col`} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className={`p-4 border-b ${darkBorder} flex items-center justify-between`}>
          <div className="flex items-center">
            <Sparkles size={20} className="text-yellow-500 mr-2" />
            <h3 className={`font-bold ${darkText}`}>智能推荐</h3>
          </div>
          <button onClick={onClose} className={`p-1 ${darkSubtext} hover:${darkText}`}>
            <X size={20} />
          </button>
        </div>

        {/* List */}
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
                  <p className={`text-xs ${darkSubtext}`}>{rec.resource.location}</p>
                </div>
                <div className={`flex items-center justify-center w-10 h-10 rounded-lg ${getScoreBg(rec.score)} text-white font-bold`}>
                  {Math.round(rec.score)}
                </div>
              </div>
              
              {/* Match reasons */}
              <div className="space-y-1">
                {rec.matchReasons.slice(0, 2).map((reason, i) => (
                  <p key={i} className={`text-xs ${darkSubtext} flex items-start`}>
                    <Check size={12} className="text-green-500 mt-0.5 mr-1 shrink-0" />
                    {reason}
                  </p>
                ))}
              </div>

              {/* Score details */}
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
      </div>
    </div>
  );
};
