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
- 偏好位置（楼层、区域等）
- 特殊需求（安静、靠窗等）

请根据用户描述的需求，分析并推荐最合适的资源，给出详细的推荐理由。

资源信息：
{resources}

请用JSON格式返回推荐结果，格式如下：
{
  "analysis": "你对用户需求的分析",
  "recommendations": [
    {
      "resourceId": "资源ID",
      "reason": "推荐理由",
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
      
      const resourcesInfo = roomResources.map(r => 
        `ID: ${r.id}, 名称: ${r.name}, 类型: 会议室, 位置: ${r.location}, 容量: ${r.capacity || 1}人, 设施: ${r.features?.join(', ') || '无'}`
      ).join('\n');

      const prompt = SYSTEM_PROMPT.replace('{resources}', resourcesInfo) + `\n\n用户需求: ${userMessage.content}`;

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${import.meta.env.VITE_GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 2048,
          }
        })
      });

      const data = await response.json();
      const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

      let recommendations: ResourceRecommendation[] = [];
      let analysis = responseText;

      try {
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          analysis = parsed.analysis || responseText;
          
          if (parsed.recommendations) {
            recommendations = parsed.recommendations.map((rec: any) => {
              const resource = resources.find(r => r.id === rec.resourceId);
              if (resource) {
                return {
                  resource,
                  reason: rec.reason,
                  matchScore: rec.matchScore
                };
              }
              return null;
            }).filter(Boolean);
          }
        }
      } catch (e) {
        console.error('Failed to parse AI response:', e);
      }

      if (recommendations.length === 0) {
        const roomResources = resources.filter(r => r.type === 'ROOM' && r.status === 'AVAILABLE').slice(0, 3);
        const topResources = roomResources
          .map(r => ({
            resource: r,
            reason: `${r.name} 当前可用，适合会议使用`,
            matchScore: 70
          }));
        recommendations = topResources;
      }

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
