
import { GoogleGenAI } from "@google/genai";
import { Resource } from "../types";

export const getSmartRecommendation = async (
  purpose: string, 
  participants: number, 
  availableResources: Resource[]
): Promise<string> => {
  try {
    // Correct: Initialize GoogleGenAI inside the function to use the current process.env.API_KEY
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `根据以下信息推荐最合适的会议室或工位：
      申请用途: ${purpose}
      参与人数: ${participants}
      可用资源列表: ${JSON.stringify(availableResources)}
      
      请用中文给出 1-2 句简洁的推荐理由，说明为什么这个资源最合适。`,
    });
    return response.text || "暂无推荐建议。";
  } catch (error) {
    console.error("Gemini Error:", error);
    return "AI 推荐服务目前不可用，请根据实际需要选择。";
  }
};
