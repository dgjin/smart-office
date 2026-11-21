import { DEFAULT_RULE_SETTINGS } from '../constants.ts';
import type { BookingRuleSettings, Resource, ResourceBuilding, RuleVersion, RoomCategory } from '../types.ts';

export const BUILDING_FLOORS: Record<ResourceBuilding, number> = { MAIN: 20, ANNEX: 4 };
export const BUILDING_NAMES: Record<ResourceBuilding, string> = { MAIN: '1号楼', ANNEX: '2号楼' };

export const parseResourceBuilding = (location: string): ResourceBuilding => /(?:2|二)\s*号楼|配楼/i.test(location) ? 'ANNEX' : 'MAIN';

export const parseResourceFloor = (location: string, totalFloors: number) => {
  const match = location.match(/(\d{1,2})\s*(?:层|F\b)/i);
  if (!match) return null;
  const floor = Number(match[1]);
  return floor >= 1 && floor <= totalFloors ? floor : null;
};

export const getResourceBuilding = (resource: Pick<Resource, 'building' | 'location'>) => resource.building || parseResourceBuilding(resource.location);

export const getResourceFloor = (resource: Pick<Resource, 'building' | 'floor' | 'location'>) => {
  if (resource.floor !== undefined) return resource.floor;
  const building = getResourceBuilding(resource);
  return parseResourceFloor(resource.location, BUILDING_FLOORS[building]);
};

export const getRoomCategory = (capacity: number, auditorium = false, settings: BookingRuleSettings = DEFAULT_RULE_SETTINGS): RoomCategory => {
  if (auditorium) return 'AUDITORIUM';
  if (capacity <= settings.smallRoomMaxCapacity) return 'SMALL';
  if (capacity <= settings.mediumRoomMaxCapacity) return 'MEDIUM';
  return 'LARGE';
};

export const getLatestRuleVersion = (versions: RuleVersion[] = []) => [...versions].sort((a, b) => b.version - a.version)[0];

export const getCurrentRuleSettings = (versions: RuleVersion[] = []): BookingRuleSettings => ({
  ...DEFAULT_RULE_SETTINGS,
  ...(getLatestRuleVersion(versions)?.settings || {})
});
