import { useState, useEffect, useCallback, useRef } from 'react';
import { Resource, Booking, ResourceType } from '../types';
import { 
  getRecommendations, 
  RecommendationResult, 
  RecommendationRequest,
  getRecommendationConfig 
} from '../services/recommendationService';

interface UseRoomRecommendationOptions {
  resources: Resource[];
  userBookings: Booking[];
  debounceMs?: number;
}

interface UseRoomRecommendationReturn {
  recommendations: RecommendationResult | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
  updateRequest: (request: Partial<RecommendationRequest>) => void;
}

export function useRoomRecommendation({
  resources,
  userBookings,
  debounceMs = 300,
}: UseRoomRecommendationOptions): UseRoomRecommendationReturn {
  const [request, setRequest] = useState<RecommendationRequest | null>(null);
  const [recommendations, setRecommendations] = useState<RecommendationResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const generateRecommendations = useCallback(() => {
    if (!request) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      const config = getRecommendationConfig();
      const result = getRecommendations(request, resources, userBookings, config);
      setRecommendations(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成推荐失败');
    } finally {
      setIsLoading(false);
    }
  }, [request, resources, userBookings]);

  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    
    if (request) {
      debounceTimerRef.current = setTimeout(() => {
        generateRecommendations();
      }, debounceMs);
    }
    
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [request, debounceMs, generateRecommendations]);

  const refresh = useCallback(() => {
    generateRecommendations();
  }, [generateRecommendations]);

  const updateRequest = useCallback((partialRequest: Partial<RecommendationRequest>) => {
    setRequest(prev => {
      if (!prev) return prev;
      return { ...prev, ...partialRequest };
    });
  }, []);

  return {
    recommendations,
    isLoading,
    error,
    refresh,
    updateRequest,
  };
}

export function createRecommendationRequest(
  userId: string,
  resourceType: ResourceType,
  startTime: string,
  endTime: string,
  participants: number = 1,
  requiredFeatures: string[] = [],
  purpose?: string
): RecommendationRequest {
  return {
    userId,
    resourceType,
    startTime,
    endTime,
    participants,
    requiredFeatures,
    purpose,
  };
}
