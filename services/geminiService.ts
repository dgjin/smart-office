
import { GoogleGenAI } from "@google/genai";
import { Resource, User } from "../types";
import { supabase } from "./supabaseService";

let cachedUserApiKey: string | null = null;
let cachedUserId: string | null = null;

export const getSmartRecommendation = async (
  purpose: string, 
  participants: number, 
  availableResources: Resource[],
  currentUser?: User
): Promise<string> => {
  try {
    let apiKey: string | undefined;
    
    // 优先使用用户自己的 API Key
    if (currentUser?.encryptedApiKey) {
      if (cachedUserId !== currentUser.id) {
        cachedUserApiKey = decodeURIComponent(atob(currentUser.encryptedApiKey));
        cachedUserId = currentUser.id;
      }
      apiKey = cachedUserApiKey;
    }
    
    // 如果没有用户 API Key，尝试从环境变量获取
    if (!apiKey) {
      apiKey = import.meta.env.VITE_GEMINI_API_KEY;
    }
    
    // 如果还是没有 API Key，返回提示
    if (!apiKey) {
      return "请在个人中心配置 Google API Key 以使用智能推荐功能。";
    }
    
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: `根据以下信息推荐最合适的会议室或工位：
      申请用途: ${purpose}
      参与人数: ${participants}
      可用资源列表: ${JSON.stringify(availableResources)}
      
      请用中文给出 1-2 句简洁的推荐理由，说明为什么这个资源最合适。`,
    });
    return response.text || "暂无推荐建议。";
  } catch (error) {
    console.error("Gemini Error:", error);
    return "AI 推荐服务目前不可用，请检查 API Key 配置或稍后重试。";
  }
};

export const clearCachedApiKey = () => {
  cachedUserApiKey = null;
  cachedUserId = null;
};
