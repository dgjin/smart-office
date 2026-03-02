import { Booking, Resource, ResourceType } from '../types';

export interface RecommendationConfig {
  capacityWeight: number;
  featureWeight: number;
  historyWeight: number;
  availabilityWeight: number;
}

export const DEFAULT_RECOMMENDATION_CONFIG: RecommendationConfig = {
  capacityWeight: 0.3,
  featureWeight: 0.25,
  historyWeight: 0.25,
  availabilityWeight: 0.2,
};

export interface RecommendationRequest {
  userId: string;
  resourceType: ResourceType;
  startTime: string;
  endTime: string;
  participants: number;
  requiredFeatures: string[];
  purpose?: string;
}

export interface RoomRecommendation {
  resource: Resource;
  score: number;
  matchReasons: string[];
  capacityScore: number;
  featureScore: number;
  historyScore: number;
  availabilityScore: number;
}

export interface RecommendationResult {
  recommendations: RoomRecommendation[];
  generatedAt: number;
}

const STORAGE_KEY = 'smartoffice_recommendation_config';

export function getRecommendationConfig(): RecommendationConfig {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.warn('Failed to load recommendation config:', e);
  }
  return DEFAULT_RECOMMENDATION_CONFIG;
}

export function saveRecommendationConfig(config: RecommendationConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch (e) {
    console.warn('Failed to save recommendation config:', e);
  }
}

export function calculateCapacityScore(roomCapacity: number | undefined, requiredParticipants: number): number {
  if (!roomCapacity) return 0;
  
  if (roomCapacity >= requiredParticipants && roomCapacity <= requiredParticipants * 1.5) {
    return 100;
  } else if (roomCapacity >= requiredParticipants) {
    return 80;
  } else if (roomCapacity >= requiredParticipants * 0.7) {
    return 50;
  }
  return 20;
}

export function calculateFeatureScore(roomFeatures: string[], requiredFeatures: string[]): number {
  if (!requiredFeatures || requiredFeatures.length === 0) return 100;
  if (!roomFeatures || roomFeatures.length === 0) return 50;
  
  const matchedFeatures = requiredFeatures.filter(f => 
    roomFeatures.some(rf => rf.toLowerCase().includes(f.toLowerCase()) || f.toLowerCase().includes(rf.toLowerCase()))
  );
  
  return Math.round((matchedFeatures.length / requiredFeatures.length) * 100);
}

export function calculateHistoryScore(userBookings: Booking[], resourceId: string, resourceType: ResourceType): number {
  if (!userBookings || userBookings.length === 0) return 50;
  
  const userResourceBookings = userBookings.filter(b => 
    b.resourceId === resourceId && b.type === resourceType
  );
  
  const totalBookings = userBookings.filter(b => b.type === resourceType).length;
  if (totalBookings === 0) return 50;
  
  const percentage = (userResourceBookings.length / totalBookings) * 100;
  return Math.min(Math.round(percentage), 100);
}

export function calculateAvailabilityScore(
  resourceId: string,
  startTime: string,
  endTime: string,
  existingBookings: Booking[]
): number {
  if (!existingBookings || existingBookings.length === 0) return 100;
  
  const requestStart = new Date(startTime).getTime();
  const requestEnd = new Date(endTime).getTime();
  
  const conflictingBookings = existingBookings.filter(b => {
    if (b.resourceId !== resourceId) return false;
    if (b.status === 'CANCELLED' || b.status === 'REJECTED') return false;
    
    const bookingStart = new Date(b.startTime).getTime();
    const bookingEnd = new Date(b.endTime).getTime();
    
    return requestStart < bookingEnd && requestEnd > bookingStart;
  });
  
  if (conflictingBookings.length === 0) return 100;
  
  const overlapMinutes = conflictingBookings.reduce((total, b) => {
    const bookingStart = new Date(b.startTime).getTime();
    const bookingEnd = new Date(b.endTime).getTime();
    const overlapStart = Math.max(requestStart, bookingStart);
    const overlapEnd = Math.min(requestEnd, bookingEnd);
    return total + Math.max(0, overlapEnd - overlapStart);
  }, 0);
  
  const requestDuration = requestEnd - requestStart;
  const overlapPercentage = (overlapMinutes / requestDuration) * 100;
  
  return Math.max(0, 100 - overlapPercentage);
}

export function generateMatchReasons(
  room: Resource,
  capacityScore: number,
  featureScore: number,
  historyScore: number,
  availabilityScore: number,
  requiredParticipants: number,
  requiredFeatures: string[]
): string[] {
  const reasons: string[] = [];
  
  if (capacityScore >= 80) {
    if (room.capacity && room.capacity >= requiredParticipants && room.capacity <= requiredParticipants * 1.5) {
      reasons.push(`此会议室大小最适合您的参会人数（${room.capacity}人）`);
    } else if (room.capacity && room.capacity > requiredParticipants * 1.5) {
      reasons.push(`会议室容量充足（${room.capacity}人）`);
    }
  } else if (capacityScore >= 50) {
    reasons.push(`会议室可容纳（${room.capacity || '未知'}人）`);
  }
  
  if (featureScore >= 80) {
    reasons.push('会议室设施完全匹配您的需求');
  } else if (featureScore >= 50 && requiredFeatures.length > 0) {
    reasons.push('会议室部分满足您的设施需求');
  }
  
  if (historyScore >= 60) {
    const percentage = Math.round(historyScore);
    reasons.push(`您过去${percentage}%的类似会议选择了此会议室`);
  }
  
  if (availabilityScore >= 90) {
    reasons.push('该时段会议室完全空闲');
  } else if (availabilityScore >= 70) {
    reasons.push('该时段会议室基本可用');
  }
  
  if (room.location) {
    reasons.push(`位置：${room.location}`);
  }
  
  return reasons;
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

export function getRecommendations(
  request: RecommendationRequest,
  resources: Resource[],
  userBookings: Booking[],
  config: RecommendationConfig = DEFAULT_RECOMMENDATION_CONFIG
): RecommendationResult {
  const { userId, resourceType, startTime, endTime, participants, requiredFeatures } = request;
  
  const filteredResources = resources.filter(r => 
    r.type === resourceType && 
    r.status === 'AVAILABLE'
  );
  
  const existingBookings = userBookings.filter(b => 
    b.status !== 'CANCELLED' && b.status !== 'REJECTED'
  );
  
  const recommendations: RoomRecommendation[] = filteredResources.map(resource => {
    const capacityScore = calculateCapacityScore(resource.capacity, participants);
    const featureScore = calculateFeatureScore(resource.features, requiredFeatures);
    const historyScore = calculateHistoryScore(userBookings, resource.id, resourceType);
    const availabilityScore = calculateAvailabilityScore(resource.id, startTime, endTime, existingBookings);
    
    const weightedScore = 
      (capacityScore * config.capacityWeight) +
      (featureScore * config.featureWeight) +
      (historyScore * config.historyWeight) +
      (availabilityScore * config.availabilityWeight);
    
    const matchReasons = generateMatchReasons(
      resource,
      capacityScore,
      featureScore,
      historyScore,
      availabilityScore,
      participants,
      requiredFeatures
    );
    
    return {
      resource,
      score: Math.round(weightedScore * 100) / 100,
      matchReasons,
      capacityScore,
      featureScore,
      historyScore,
      availabilityScore,
    };
  });
  
  recommendations.sort((a, b) => b.score - a.score);
  
  return {
    recommendations,
    generatedAt: Date.now(),
  };
}
