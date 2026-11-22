import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, Building2, CalendarDays, Edit2, Lock, LockOpen, MapPin, Trash2, Users } from 'lucide-react';
import type { Booking, Resource, ResourceStatus } from '../types';
import { isResourceAcceptingBookings } from '../utils/bookingRules';
import { BUILDING_FLOORS, getResourceBuilding, getResourceFloor, parseResourceBuilding, parseResourceFloor } from '../utils/resourceDomain';
import type { ResourceBuilding } from '../types';

export type BuildingId = ResourceBuilding;
type BuildingConfig = {
  id: BuildingId;
  code: string;
  name: string;
  kind: string;
  totalFloors: number;
  shape: 'RECTANGULAR' | 'L';
};

export const BUILDINGS: Record<BuildingId, BuildingConfig> = {
  MAIN: { id: 'MAIN', code: '01', name: '1号楼', kind: '主楼', totalFloors: BUILDING_FLOORS.MAIN, shape: 'RECTANGULAR' },
  ANNEX: { id: 'ANNEX', code: '02', name: '2号楼', kind: '配楼', totalFloors: BUILDING_FLOORS.ANNEX, shape: 'L' }
};

export const getFloorNumbers = (totalFloors: number) => Array.from({ length: totalFloors }, (_, index) => totalFloors - index);

type DisplayStatus = Extract<ResourceStatus, 'AVAILABLE' | 'OCCUPIED' | 'MAINTENANCE'>;

type BuildingExplorerProps = {
  resources: Resource[];
  bookings: Booking[];
  focusLocation?: { location: string; building?: BuildingId; floor?: number; token: number | string } | null;
  onDetails: (resource: Resource) => void;
  onCalendar: (resource: Resource) => void;
  onBook: (resource: Resource) => void;
  canManage?: boolean;
  isResourceLocked: (resourceId: string) => boolean;
  onToggleResourceLock: (resourceId: string) => void;
  onEdit: (resource: Resource) => void;
  onDelete: (resource: Resource) => void;
  resultContext?: { label: string; matchCount: number; totalRoomCount: number } | null;
};

const STATUS_LABELS: Record<DisplayStatus, string> = {
  AVAILABLE: '当前空闲',
  OCCUPIED: '会议中',
  MAINTENANCE: '暂停预约'
};

export const parseBuilding = parseResourceBuilding;
export const parseFloor = parseResourceFloor;

const BuildingExplorer = ({ resources, bookings, focusLocation, onDetails, onCalendar, onBook, canManage = false, isResourceLocked, onToggleResourceLock, onEdit, onDelete, resultContext }: BuildingExplorerProps) => {
  const explorerRef = useRef<HTMLElement>(null);
  const sceneRef = useRef<HTMLIFrameElement>(null);
  const [sceneReady, setSceneReady] = useState(false);
  const [selectedBuildingId, setSelectedBuildingId] = useState<BuildingId>('MAIN');
  const [selectedFloorState, setSelectedFloorState] = useState<Record<BuildingId, number | null>>({ MAIN: null, ANNEX: null });
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  useLayoutEffect(() => {
    if (!focusLocation) return;
    const buildingId = focusLocation.building || parseBuilding(focusLocation.location);
    const floor = focusLocation.floor || parseFloor(focusLocation.location, BUILDINGS[buildingId].totalFloors);
    if (!floor) return;
    setSelectedBuildingId(buildingId);
    setSelectedFloorState(current => ({ ...current, [buildingId]: floor }));
    const frame = window.requestAnimationFrame(() => explorerRef.current?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'start'
    }));
    return () => window.cancelAnimationFrame(frame);
  }, [focusLocation]);

  const rooms = useMemo(() => resources.filter(resource => resource.type === 'ROOM').map(resource => {
    const currentBooking = bookings.find(booking =>
      booking.resourceId === resource.id
      && booking.status === 'APPROVED'
      && !booking.endedEarlyAt
      && new Date(booking.startTime).getTime() <= now
      && new Date(booking.endTime).getTime() > now
    );
    const status: DisplayStatus = resource.status === 'MAINTENANCE' || resource.status === 'PENDING'
      ? 'MAINTENANCE'
      : resource.status === 'OCCUPIED' || currentBooking
        ? 'OCCUPIED'
        : 'AVAILABLE';
    return { resource, status, currentBooking };
  }), [resources, bookings, now]);

  const building = BUILDINGS[selectedBuildingId];
  const floorNumbers = getFloorNumbers(building.totalFloors);
  const buildingRooms = useMemo(() => rooms.filter(room => getResourceBuilding(room.resource) === selectedBuildingId), [rooms, selectedBuildingId]);
  const floors = useMemo(() => new Map(floorNumbers.map(floor => [
    floor,
    buildingRooms.filter(room => getResourceFloor(room.resource) === floor)
  ])), [buildingRooms, building.totalFloors]);

  const firstOccupiedFloor = floorNumbers.find(floor => (floors.get(floor)?.length || 0) > 0);
  const selectedFloor = selectedFloorState[selectedBuildingId] ?? firstOccupiedFloor ?? building.totalFloors;
  const selectedRooms = floors.get(selectedFloor) || [];
  const unmappedRooms = buildingRooms.filter(room => getResourceFloor(room.resource) === null);
  const availableCount = buildingRooms.filter(room => room.status === 'AVAILABLE').length;
  const selectedAvailable = selectedRooms.filter(room => room.status === 'AVAILABLE').length;

  const selectFloor = (floor: number) => setSelectedFloorState(current => ({ ...current, [selectedBuildingId]: floor }));
  const isAnnex = building.shape === 'L';

  const syncScene = useCallback(() => {
    if (!sceneReady || !sceneRef.current?.contentWindow) return;
    sceneRef.current.contentWindow.postMessage({
      type: 'smart-office:spatial-state',
      building: selectedBuildingId,
      floor: selectedFloor,
      resources: rooms.map(room => ({ id: room.resource.id, status: room.status }))
    }, window.location.origin);
  }, [sceneReady, selectedBuildingId, selectedFloor, rooms]);

  useEffect(() => { syncScene(); }, [syncScene]);

  useEffect(() => {
    const onSceneMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== sceneRef.current?.contentWindow) return;
      if (event.data?.type === 'smart-office:hq3d-ready') {
        setSceneReady(true);
        return;
      }
      if (event.data?.type !== 'smart-office:spatial-floor') return;
      const buildingId = event.data.building as BuildingId;
      const floor = Number(event.data.floor);
      if (!BUILDINGS[buildingId] || !Number.isInteger(floor) || floor < 1 || floor > BUILDINGS[buildingId].totalFloors) return;
      setSelectedBuildingId(buildingId);
      setSelectedFloorState(current => ({ ...current, [buildingId]: floor }));
    };
    window.addEventListener('message', onSceneMessage);
    return () => window.removeEventListener('message', onSceneMessage);
  }, []);

  return (
    <section ref={explorerRef} className="building-explorer" aria-labelledby="building-explorer-title">
      <header className="building-explorer-head">
        <div>
          <span className="studio-page-kicker">SPACE NAVIGATION / 空间导航</span>
          <h4 id="building-explorer-title">{building.name} · {building.totalFloors} 层{isAnnex ? ' L 型' : ''}空间导航</h4>
          <p>选择楼栋和楼层，查看会议室实时状态、排期并发起预约。</p>
        </div>
        <div className="building-switch" role="group" aria-label="切换楼栋">
          {Object.values(BUILDINGS).map(item => (
            <button
              key={item.id}
              type="button"
              aria-pressed={selectedBuildingId === item.id}
              aria-label={`切换到${item.name}${item.kind}`}
              onClick={() => setSelectedBuildingId(item.id)}
            >
              <strong>{item.name}</strong>
              <span>{item.kind} · {item.totalFloors} 层</span>
            </button>
          ))}
        </div>
        <div className="building-summary" aria-label={`${building.name}空间概况`}>
          <div><strong>{building.totalFloors}</strong><span>总楼层</span></div>
          <div><strong>{buildingRooms.length}</strong><span>{resultContext ? '符合条件' : '会议室'}</span></div>
          <div><strong>{availableCount}</strong><span>当前空闲</span></div>
        </div>
      </header>

      {resultContext && <div className="building-filter-context" role="status" aria-live="polite">
        <strong>条件查找已联动</strong>
        <span>{resultContext.label} · 全部楼栋匹配 {resultContext.matchCount} / {resultContext.totalRoomCount} 间；当前楼栋 {buildingRooms.length} 间，当前楼层 {selectedRooms.length} 间。占用标识仍表示当前实时状态。</span>
      </div>}

      <div className="building-workspace">
        <div className="building-scene" data-floor-count={String(building.totalFloors).padStart(2, '0')}>
          <div className="building-scene-top">
            <div><span>总部空间 / 3D 楼层剖切</span><strong>{building.name} · {isAnnex ? 'L 型配楼' : '主楼'}</strong></div>
            <label>
              <span>快速定位</span>
              <select aria-label={`快速选择${building.name}楼层`} value={selectedFloor} onChange={event => selectFloor(Number(event.target.value))}>
                {floorNumbers.map(floor => <option key={floor} value={floor}>{floor} 层{ floors.get(floor)?.length ? ` · ${floors.get(floor)?.length} 间` : ''}</option>)}
              </select>
            </label>
          </div>

          <iframe
            ref={sceneRef}
            className="building-cutaway"
            src="/hq3d.html?embed=spatial"
            title={`${building.name}${building.totalFloors}层总部3D楼层剖切图，当前${selectedFloor}层`}
            onLoad={() => setSceneReady(true)}
          />

          <div className="building-legend" aria-label="会议室状态图例">
            <span data-status="AVAILABLE"><i />当前空闲</span>
            <span data-status="OCCUPIED"><i />会议中</span>
            <span data-status="MAINTENANCE"><i />维护中</span>
            <span data-status="EMPTY"><i />{resultContext ? '无匹配' : '未录入'}</span>
          </div>
          <p className="building-scene-note">拖拽旋转、滚轮缩放，点击楼板或右侧刻度切换楼层。业务状态仅覆盖已确认同步的会议室，未映射资源以楼层名录为准。</p>
        </div>

        <div className="building-floor-panel">
          <header className="building-floor-head" aria-live="polite">
            <div className="building-floor-number">{String(selectedFloor).padStart(2, '0')}<small>F</small></div>
            <div>
              <span>楼层会议室</span>
              <h4>{selectedFloor} 层</h4>
              <p>{selectedRooms.length ? `${selectedRooms.length} 间会议室 · ${selectedAvailable} 间当前空闲` : resultContext ? '本层无匹配会议室' : '本层暂未录入会议室'}</p>
            </div>
          </header>

          {selectedRooms.length > 0 ? (
            <div className="building-plan">
              <div className="building-plan-meta"><span>会议室列表</span><span>{selectedFloor} 层 · {selectedRooms.length} 间</span></div>
              <div className="building-room-grid">
                {selectedRooms.map((room, index) => {
                  const locked = isResourceLocked(room.resource.id);
                  return (
                    <article key={room.resource.id} className="building-room" data-status={room.status}>
                      <button type="button" className="building-room-main" onClick={() => onDetails(room.resource)} aria-label={`查看${room.resource.name}详情`}>
                        <span className="building-room-topline">
                          <span className="building-room-index">ROOM {String(index + 1).padStart(2, '0')}</span>
                          <span className="building-room-status"><i />{STATUS_LABELS[room.status]}</span>
                        </span>
                        <strong>{room.resource.name}</strong>
                        <span className="building-room-capacity"><Users size={13} />{room.resource.capacity || 0} 人<span>·</span><MapPin size={13} />{room.resource.location}</span>
                        <span className="building-room-features">{room.resource.features.slice(0, 3).join(' · ') || '基础会议空间'}</span>
                        {room.currentBooking && <span className="building-room-current">当前会议 · {room.currentBooking.purpose}</span>}
                      </button>
                      {canManage && <div className="building-room-admin" role="group" aria-label={`${room.resource.name}管理操作`}>
                        <button type="button" className="building-room-lock" aria-pressed={!locked} aria-label={`${locked ? '解锁' : '加锁'}${room.resource.name}管理操作`} title={locked ? '解锁后才能编辑或删除' : '重新加锁以禁用编辑和删除'} onClick={() => onToggleResourceLock(room.resource.id)}>
                          {locked ? <Lock size={14} /> : <LockOpen size={14} />}{locked ? '解锁' : '加锁'}
                        </button>
                        <button type="button" disabled={locked} onClick={() => onEdit(room.resource)} aria-label={`编辑${room.resource.name}基本信息`} title={locked ? '请先解锁此资源' : '编辑基本信息'}><Edit2 size={14} />编辑信息</button>
                        <button type="button" className="building-room-delete" disabled={locked} onClick={() => onDelete(room.resource)} aria-label={`删除${room.resource.name}`} title={locked ? '请先解锁此资源' : '删除资源'}><Trash2 size={14} />删除</button>
                      </div>}
                      <footer>
                        <button type="button" onClick={() => onCalendar(room.resource)} aria-label={`查看${room.resource.name}排期`}><CalendarDays size={14} />排期</button>
                        <button type="button" onClick={() => onBook(room.resource)} disabled={!isResourceAcceptingBookings(room.resource)}>预约<ArrowUpRight size={14} /></button>
                      </footer>
                    </article>
                  );
                })}
              </div>
              <p className="building-plan-note">房间按资源名录顺序排列，状态来自资源信息与已通过的实时会议。{canManage ? '资源默认锁定，逐项解锁后才能编辑或删除；仅无预约及设备关联的资源可删除。' : ''}</p>
            </div>
          ) : (
            <div className="building-empty">
              <Building2 size={32} strokeWidth={1.3} />
              <h5>{resultContext ? '当前楼层没有符合条件的会议室' : '本层暂无会议室数据'}</h5>
              <p>{resultContext ? '空间导航仅保留符合当前时间、人数和设备条件的会议室，请调整条件或切换楼栋楼层。' : `新增资源时将位置填写为“${building.name} ${selectedFloor}层”，会议室会自动出现在这一层。`}</p>
              {buildingRooms.length > 0 && <button type="button" onClick={() => firstOccupiedFloor && selectFloor(firstOccupiedFloor)}>定位到 {firstOccupiedFloor} 层<ArrowUpRight size={14} /></button>}
            </div>
          )}
        </div>
      </div>

      {unmappedRooms.length > 0 && (
        <div className="building-unmapped">
          <MapPin size={16} />
          <span>{unmappedRooms.length} 间会议室未识别楼层，请将位置维护为“{building.name} {building.totalFloors > 4 ? 10 : 2}层”格式：</span>
          <div>{unmappedRooms.map(room => <button key={room.resource.id} type="button" onClick={() => onDetails(room.resource)}>{room.resource.name}</button>)}</div>
        </div>
      )}
    </section>
  );
};

export default BuildingExplorer;
