import React, { useState, useRef, useEffect } from 'react';
import { Sparkles, Send, X, Bot, User, Check, Calendar, Clock, MapPin, Users, Loader2, ChevronRight } from 'lucide-react';
import { Resource } from '../../types';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  recommendations?: ResourceRecommendation[];
}

interface ResourceRecommendation {
  resource: Resource;
  reason: string;
  matchScore: number;
}

interface SmartRecommendationDialogProps {
  resources: Resource[];
  userBookings: any[];
  theme: string;
  onSelect: (resource: Resource) => void;
  onClose: () => void;
}

const SYSTEM_PROMPT = `你是一个智能会议室推荐助手。请根据用户的需求推荐最合适的会议室。

用户可能需要的信息包括：
- 会议类型（日常会议、面试、培训、客户洽谈等）
- 参与人数
- 会议时长
- 需要的设备（投影、视频会议、白板等）
- 偏好位置/楼层（非常重要！如用户提到"16层"、"3楼"、"东区"、"西区"等，必须优先推荐对应位置的会议室）
- 特殊需求（安静、靠窗等）

重要规则：
1. 如果用户明确提到楼层或区域（如"16层"、"3楼"、"东区"、"西区"、"南边"等），必须优先推荐该位置的会议室
2. 如果用户提到参会人数，必须推荐容量满足或略超需求的会议室
3. 如果用户提到需要的设备，必须推荐具备该设备的会议室
4. 推荐理由必须清晰说明为什么推荐该会议室

资源信息：
{resources}

请用JSON格式返回推荐结果，格式如下：
{
  "analysis": "你对用户需求的分析，特别注意用户提到的位置偏好",
  "recommendations": [
    {
      "resourceId": "资源ID",
      "reason": "推荐理由，必须说明该会议室如何满足用户需求",
      "matchScore": 匹配度(0-100)
    }
  ]
}`;

export const SmartRecommendationDialog: React.FC<SmartRecommendationDialogProps> = ({
  resources,
  userBookings,
  theme,
  onSelect,
  onClose
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: '1',
      role: 'assistant',
      content: `您好！我是智能会议室推荐助手 🤖

我可以帮您推荐最合适的会议室。请告诉我您的需求，例如：

• "我需要预约一个能容纳10人的会议室，明天上午9点到11点"
• "我们需要一间有视频会议设备的会议室，用于客户洽谈"
• "预约一个小型会议室，周三下午2-4点"

请描述您的需求，我会为您分析并推荐最合适的会议室！`
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const isFinanceTheme = theme === 'finance';
  const themeColors = {
    bg: isFinanceTheme ? 'bg-slate-800' : 'bg-white',
    border: isFinanceTheme ? 'border-slate-600' : 'border-gray-100',
    text: isFinanceTheme ? 'text-slate-100' : 'text-gray-800',
    subtext: isFinanceTheme ? 'text-slate-400' : 'text-gray-500',
    inputBg: isFinanceTheme ? 'bg-slate-700' : 'bg-gray-50',
    accent: isFinanceTheme ? 'bg-violet-500' : 'bg-violet-600',
    userBubble: isFinanceTheme ? 'bg-violet-600' : 'bg-violet-600',
    assistantBubble: isFinanceTheme ? 'bg-slate-700' : 'bg-gray-100',
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const roomResources = resources.filter(r => r.type === 'ROOM');
      const userPrompt = userMessage.content;
      
      const prompt = `分析用户的会议室预订需求，从以下信息中提取关键需求：
1. 位置/楼层偏好（如"16层"、"3楼"、"东区"等）
2. 参会人数
3. 需要的设备（如"投影"、"视频会议"、"白板"等）
4. 时间（日期和时间段）
5. 特殊需求（如"安静"、"面试"、"培训"等）

会议室资源：
${roomResources.map(r => `ID:${r.id}, 名称:${r.name}, 位置:${r.location}, 容量:${r.capacity}人, 设施:${r.features?.join(',') || '无'}, 状态:${r.status}`).join(' | ')}

用户需求: ${userPrompt}

请直接返回JSON格式的需求分析，不要推荐会议室：
{
  "analysis": "用户需求分析结果",
  "location": "提取到的位置偏好，没有则null",
  "capacity": "提取到的人数需求，没有则null",  
  "features": ["提取到的设备需求数组"],
  "time": "提取到的时间需求，没有则null"
}`;

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${import.meta.env.VITE_GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 1024,
          }
        })
      });

      const data = await response.json();
      const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

      let userNeeds = {
        location: null as string | null,
        capacity: null as number | null,
        features: [] as string[],
        time: null as string | null
      };

      try {
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          userNeeds = {
            location: parsed.location || null,
            capacity: parsed.capacity ? parseInt(parsed.capacity) : null,
            features: parsed.features || [],
            time: parsed.time || null
          };
        }
      } catch (e) {
        console.error('解析用户需求失败:', e);
      }

      const scoredRooms = roomResources.map(room => {
        let score = 0;
        const reasons: string[] = [];

        if (userNeeds.location && room.location) {
          const locLower = userNeeds.location.toLowerCase();
          const roomLocLower = room.location.toLowerCase();
          if (roomLocLower.includes(locLower) || locLower.includes(roomLocLower.split('层')[0] || '')) {
            score += 40;
            reasons.push(`位置匹配：位于${room.location}`);
          } else {
            score += 10;
            reasons.push(`位置：${room.location}`);
          }
        } else {
          score += 20;
          reasons.push(`位置：${room.location}`);
        }

        if (userNeeds.capacity) {
          if (room.capacity && room.capacity >= userNeeds.capacity) {
            score += 30;
            reasons.push(`容量满足：可容纳${room.capacity}人`);
          } else {
            score += 5;
            reasons.push(`容量：${room.capacity}人`);
          }
        } else {
          score += 15;
          reasons.push(`容量：${room.capacity}人`);
        }

        if (userNeeds.features.length > 0 && room.features) {
          const matchedFeatures = userNeeds.features.filter(f => 
            room.features?.some(rf => rf.toLowerCase().includes(f.toLowerCase()) || f.toLowerCase().includes(rf.toLowerCase()))
          );
          if (matchedFeatures.length === userNeeds.features.length) {
            score += 20;
            reasons.push(`设备齐全：${room.features.join('、')}`);
          } else if (matchedFeatures.length > 0) {
            score += 10;
            reasons.push(`部分设备：${matchedFeatures.join('、')}`);
          } else {
            score += 5;
            reasons.push(`设施：${room.features.join('、') || '无'}`);
          }
        } else {
          score += 10;
          if (room.features?.length) {
            reasons.push(`设施：${room.features.join('、')}`);
          }
        }

        if (room.status === 'AVAILABLE') {
          score += 10;
        }

        return {
          resource: room,
          reason: reasons.join('，') + `，综合评分${score}分`,
          matchScore: Math.min(score, 100)
        };
      });

      scoredRooms.sort((a, b) => b.matchScore - a.matchScore);
      const recommendations = scoredRooms.slice(0, 3);

      const analysis = userNeeds.location || userNeeds.capacity || userNeeds.features.length > 0
        ? `根据您的需求分析：${userNeeds.location ? `位置偏好：${userNeeds.location}，` : ''}${userNeeds.capacity ? `参会人数：${userNeeds.capacity}人，` : ''}${userNeeds.features.length > 0 ? `需要设备：${userNeeds.features.join('、')}` : ''}`
        : '已为您推荐以下会议室：';

      console.log('本地智能推荐结果:', { recommendations, userNeeds });

      const assistantMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: analysis,
        recommendations: recommendations
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Failed to get recommendation:', error);
      
      const fallbackMessage: ChatMessage = {
        id: Date.now().toString(),
        role: 'assistant',
        content: '抱歉，我暂时无法处理您的请求。请稍后重试或尝试简化您的需求描述。',
        recommendations: []
      };
      setMessages(prev => {
        const lastMessage = prev[prev.length - 1];
        if (lastMessage?.role === 'assistant' && lastMessage.content === fallbackMessage.content) {
          return prev;
        }
        return [...prev, fallbackMessage];
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickPrompt = (prompt: string) => {
    setInput(prompt);
  };

  return (
    <div className="fixed inset-0 z-[300] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div 
        className={`${themeColors.bg} rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col`} 
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`p-4 border-b ${themeColors.border} flex items-center justify-between shrink-0`}>
          <div className="flex items-center">
            <div className={`w-10 h-10 rounded-xl ${themeColors.accent} flex items-center justify-center mr-3`}>
              <Sparkles size={20} className="text-white" />
            </div>
            <div>
              <h3 className={`font-bold ${themeColors.text}`}>智能推荐助手</h3>
              <p className={`text-xs ${themeColors.subtext}`}>基于AI的个性化推荐</p>
            </div>
          </div>
          <button onClick={onClose} className={`p-2 ${themeColors.subtext} hover:${themeColors.text}`}>
            <X size={20} />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map(message => (
            <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`flex max-w-[85%] ${message.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                  message.role === 'user' ? themeColors.userBubble : themeColors.assistantBubble
                }`}>
                  {message.role === 'user' ? <User size={16} className="text-white" /> : <Bot size={16} className={themeColors.text} />}
                </div>
                <div className={`mx-2 p-3 rounded-2xl ${
                  message.role === 'user' 
                    ? `${themeColors.userBubble} text-white` 
                    : `${themeColors.assistantBubble} ${themeColors.text}`
                }`}>
                  <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                  
                  {message.recommendations && message.recommendations.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {message.recommendations.map((rec, idx) => (
                        <button
                          key={idx}
                          onClick={() => {
                            onSelect(rec.resource);
                            onClose();
                          }}
                          className={`w-full p-3 rounded-xl border ${themeColors.border} ${themeColors.inputBg} hover:border-violet-500 transition-all text-left`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center">
                              <MapPin size={14} className={themeColors.subtext} />
                              <span className={`font-bold ml-2 ${themeColors.text}`}>{rec.resource.name}</span>
                              <span className={`ml-2 px-2 py-0.5 rounded-full text-[10px] ${
                                rec.resource.type === 'ROOM' 
                                  ? 'bg-amber-500/20 text-amber-400' 
                                  : 'bg-emerald-500/20 text-emerald-400'
                              }`}>
                                {rec.resource.type === 'ROOM' ? '会议室' : '工位'}
                              </span>
                            </div>
                            <div className="flex items-center">
                              <span className={`text-xs font-bold ${
                                rec.matchScore >= 80 ? 'text-green-500' : 
                                rec.matchScore >= 60 ? 'text-yellow-500' : 'text-gray-400'
                              }`}>
                                {rec.matchScore}%
                              </span>
                              <ChevronRight size={16} className={themeColors.subtext} />
                            </div>
                          </div>
                          <p className={`text-xs mt-1 ${themeColors.subtext}`}>{rec.reason}</p>
                          <div className={`flex items-center mt-2 text-xs ${themeColors.subtext}`}>
                            <MapPin size={12} className="mr-1" />
                            {rec.resource.location}
                            <span className="mx-2">·</span>
                            <Users size={12} className="mr-1" />
                            容量 {rec.resource.capacity || 1}人
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
          
          {isLoading && (
            <div className="flex justify-start">
              <div className="flex">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${themeColors.assistantBubble}`}>
                  <Bot size={16} className={themeColors.text} />
                </div>
                <div className={`mx-2 p-3 rounded-2xl ${themeColors.assistantBubble}`}>
                  <Loader2 size={20} className={`animate-spin ${themeColors.text}`} />
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Quick prompts */}
        {messages.length <= 1 && !isLoading && (
          <div className={`px-4 pb-2 ${themeColors.subtext}`}>
            <p className="text-xs mb-2">试试这样说：</p>
            <div className="flex flex-wrap gap-2">
              {[
                '预约明天上午9点的会议室',
                '需要能容纳15人的会议室',
                '需要视频会议设备'
              ].map((prompt, idx) => (
                <button
                  key={idx}
                  onClick={() => handleQuickPrompt(prompt)}
                  className={`px-3 py-1.5 rounded-lg text-xs border ${themeColors.border} ${themeColors.subtext} hover:${themeColors.text}`}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Input */}
        <div className={`p-4 border-t ${themeColors.border} shrink-0`}>
          <div className={`flex items-center ${themeColors.inputBg} rounded-xl px-3 py-2`}>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder="描述您的需求..."
              disabled={isLoading}
              className={`flex-1 bg-transparent outline-none text-sm ${themeColors.text} placeholder:${themeColors.subtext}`}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || isLoading}
              className={`ml-2 p-2 rounded-lg ${input.trim() && !isLoading ? themeColors.accent : themeColors.subtext} text-white`}
            >
              <Send size={18} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
