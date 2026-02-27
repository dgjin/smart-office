import { supabase, transformBookingFromDB, transformResourceFromDB } from './supabaseService';
import { Booking, Resource } from '../types';

// ==================== 实时数据推送服务 ====================

interface RealtimeConfig {
  onBookingsChange?: (bookings: Booking[], delta: BookingDelta) => void;
  onResourcesChange?: (resources: Resource[], delta: ResourceDelta) => void;
  onConnectionChange?: (status: ConnectionStatus) => void;
  onError?: (error: Error) => void;
}

interface BookingDelta {
  added: Booking[];
  updated: Booking[];
  deleted: string[];
}

interface ResourceDelta {
  added: Resource[];
  updated: Resource[];
  deleted: string[];
}

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

class RealtimeService {
  private config: RealtimeConfig;
  private bookingsChannel: any = null;
  private resourcesChannel: any = null;
  private connectionStatus: ConnectionStatus = 'disconnected';
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private heartbeatInterval: any = null;
  private pollingInterval: any = null;
  private lastBookings: Map<string, Booking> = new Map();
  private lastResources: Map<string, Resource> = new Map();
  private pendingUpdates: any[] = [];
  private isProcessing = false;
  private pollingEnabled = true; // 启用轮询作为实时推送的备选

  constructor(config: RealtimeConfig) {
    this.config = config;
    console.log('RealtimeService 创建，配置:', Object.keys(config));
  }

  // 建立连接
  public async connect(): Promise<void> {
    console.log('RealtimeService.connect() 被调用');
    
    if (this.connectionStatus === 'connected' || this.connectionStatus === 'connecting') {
      console.log('已经在连接中或已连接，跳过');
      return;
    }

    this.setConnectionStatus('connecting');

    try {
      // 先加载初始数据
      console.log('开始获取初始数据...');
      console.log('调用 fetchAndNotifyBookings...');
      await this.fetchAndNotifyBookings();
      console.log('fetchAndNotifyBookings 完成');
      console.log('调用 fetchAndNotifyResources...');
      await this.fetchAndNotifyResources();
      console.log('fetchAndNotifyResources 完成');
      
      // 然后建立实时订阅
      console.log('开始建立实时订阅...');
      console.log('调用 subscribeToBookings...');
      await this.subscribeToBookings();
      console.log('subscribeToBookings 完成');
      console.log('调用 subscribeToResources...');
      await this.subscribeToResources();
      console.log('subscribeToResources 完成');
      
      this.setConnectionStatus('connected');
      this.reconnectAttempts = 0;
      
      // 处理断线期间累积的更新
      this.processPendingUpdates();
      
      console.log('连接建立完成');
      
      // 启动轮询作为实时推送的备选方案（每30秒刷新一次）
      this.startPolling();
    } catch (error) {
      console.error('实时连接失败:', error);
      this.handleError(error as Error);
      this.scheduleReconnect();
      // 即使实时连接失败，也启动轮询
      this.startPolling();
    }
  }

  // 启动轮询
  private startPolling(): void {
    if (this.pollingInterval) {
      console.log('轮询已在运行中');
      return;
    }
    
    console.log('启动轮询，每30秒刷新一次数据...');
    this.pollingInterval = setInterval(async () => {
      console.log('🔄 轮询：刷新数据...');
      try {
        await this.fetchAndNotifyBookings();
        await this.fetchAndNotifyResources();
        console.log('🔄 轮询：数据刷新完成');
      } catch (error) {
        console.error('🔄 轮询：数据刷新失败:', error);
      }
    }, 30000); // 30秒
  }

  // 停止轮询
  private stopPolling(): void {
    if (this.pollingInterval) {
      console.log('停止轮询');
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }


  // 断开连接
  public disconnect(): void {
    this.stopPolling();
    this.stopHeartbeat();
    this.unsubscribeAll();
    this.setConnectionStatus('disconnected');
    this.reconnectAttempts = 0;
    this.pendingUpdates = [];
  }

  // 订阅预订数据变更
  private async subscribeToBookings(): Promise<void> {
    const channelName = `bookings_realtime_${Date.now()}`;
    console.log('正在订阅预订数据:', channelName);
    
    this.bookingsChannel = supabase
      .channel(channelName)
      .on('postgres_changes', 
        { 
          event: '*', 
          schema: 'public', 
          table: 'smartoffice_bookings' 
        }, 
        (payload: any) => {
          console.log('🔔 收到预订数据变更事件:', payload);
          this.handleBookingChange(payload);
        }
      )
      .subscribe((status: string, err?: any) => {
        console.log('📡 预订订阅状态:', status, err);
        if (status === 'SUBSCRIBED') {
          console.log('✅ 预订数据订阅成功');
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
          console.error('❌ 预订数据订阅断开:', status, err);
          this.scheduleReconnect();
        }
      });
  }

  // 订阅资源数据变更
  private async subscribeToResources(): Promise<void> {
    const channelName = `resources_realtime_${Date.now()}`;
    console.log('正在订阅资源数据:', channelName);
    
    this.resourcesChannel = supabase
      .channel(channelName)
      .on('postgres_changes', 
        { 
          event: '*', 
          schema: 'public', 
          table: 'smartoffice_resources' 
        }, 
        (payload: any) => {
          console.log('🔔 收到资源数据变更事件:', payload);
          this.handleResourceChange(payload);
        }
      )
      .subscribe((status: string, err?: any) => {
        console.log('📡 资源订阅状态:', status, err);
        if (status === 'SUBSCRIBED') {
          console.log('✅ 资源数据订阅成功');
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
          console.error('❌ 资源数据订阅断开:', status, err);
          this.scheduleReconnect();
        }
      });
  }

  // 处理预订数据变更
  private async handleBookingChange(payload: any): Promise<void> {
    const { eventType, new: newRecord, old: oldRecord } = payload;
    
    console.log('处理预订数据变更:', { eventType, newRecord, oldRecord });

    // 如果正在处理更新，先缓存
    if (this.isProcessing) {
      this.pendingUpdates.push({ type: 'booking', payload });
      return;
    }

    this.isProcessing = true;

    try {
      // 获取最新完整数据
      const { data: bookings, error } = await supabase
        .from('smartoffice_bookings')
        .select('*')
        .order('start_time', { ascending: true });

      if (error) throw error;

      // 计算增量
      const currentBookingsRaw = bookings || [];
      // 转换数据格式（从数据库格式转换为应用格式）
      const currentBookings = currentBookingsRaw.map(transformBookingFromDB);
      // 确保数据格式正确
      const validBookings = currentBookings.filter(b => b && typeof b === 'object' && b.id && b.startTime);
      console.log('有效预订数据:', validBookings.length);
      
      // 只有当有有效数据时才更新
      if (validBookings.length > 0) {
        const delta = this.calculateBookingDelta(validBookings);
        console.log('预订数据增量:', delta);

        // 更新缓存
        this.lastBookings.clear();
        validBookings.forEach(b => this.lastBookings.set(b.id, b));

        // 通知回调
        if (this.config.onBookingsChange) {
          this.config.onBookingsChange(validBookings, delta);
        }
      } else {
        console.log('没有有效预订数据，不更新');
      }
    } catch (error) {
      console.error('处理预订变更失败:', error);
      this.handleError(error as Error);
    } finally {
      this.isProcessing = false;
    }
  }

  // 处理资源数据变更
  private async handleResourceChange(payload: any): Promise<void> {
    const { eventType, new: newRecord, old: oldRecord } = payload;
    
    console.log('处理资源数据变更:', { eventType, newRecord, oldRecord });

    if (this.isProcessing) {
      this.pendingUpdates.push({ type: 'resource', payload });
      return;
    }

    this.isProcessing = true;

    try {
      const { data: resources, error } = await supabase
        .from('smartoffice_resources')
        .select('*')
        .order('name', { ascending: true });

      if (error) throw error;

      const currentResourcesRaw = resources || [];
      // 转换数据格式
      const currentResources = currentResourcesRaw.map(transformResourceFromDB);
      // 确保数据格式正确
      const validResources = currentResources.filter(r => r && typeof r === 'object' && r.id && r.name);
      console.log('有效资源数据:', validResources.length);
      
      // 只有当有有效数据时才更新
      if (validResources.length > 0) {
        const delta = this.calculateResourceDelta(validResources);
        console.log('资源数据增量:', delta);

        this.lastResources.clear();
        validResources.forEach(r => this.lastResources.set(r.id, r));

        if (this.config.onResourcesChange) {
          this.config.onResourcesChange(validResources, delta);
        }
      } else {
        console.log('没有有效资源数据，不更新');
      }
    } catch (error) {
      console.error('处理资源变更失败:', error);
      this.handleError(error as Error);
    } finally {
      this.isProcessing = false;
    }
  }

  // 计算预订数据增量
  private calculateBookingDelta(current: any[]): BookingDelta {
    const added: Booking[] = [];
    const updated: Booking[] = [];
    const deleted: string[] = [];

    // 找出新增和更新的
    current.forEach(booking => {
      const last = this.lastBookings.get(booking.id);
      if (!last) {
        added.push(booking);
      } else if (JSON.stringify(last) !== JSON.stringify(booking)) {
        updated.push(booking);
      }
    });

    // 找出删除的
    this.lastBookings.forEach((_, id) => {
      if (!current.find(b => b.id === id)) {
        deleted.push(id);
      }
    });

    return { added, updated, deleted };
  }

  // 计算资源数据增量
  private calculateResourceDelta(current: any[]): ResourceDelta {
    const added: Resource[] = [];
    const updated: Resource[] = [];
    const deleted: string[] = [];

    current.forEach(resource => {
      const last = this.lastResources.get(resource.id);
      if (!last) {
        added.push(resource);
      } else if (JSON.stringify(last) !== JSON.stringify(resource)) {
        updated.push(resource);
      }
    });

    this.lastResources.forEach((_, id) => {
      if (!current.find(r => r.id === id)) {
        deleted.push(id);
      }
    });

    return { added, updated, deleted };
  }

  // 处理断线期间累积的更新
  private async processPendingUpdates(): Promise<void> {
    if (this.pendingUpdates.length === 0) return;

    console.log(`处理 ${this.pendingUpdates.length} 个断线期间的更新`);

    // 批量处理，只保留最新的数据查询
    const hasBookingUpdate = this.pendingUpdates.some(u => u.type === 'booking');
    const hasResourceUpdate = this.pendingUpdates.some(u => u.type === 'resource');

    this.pendingUpdates = [];

    if (hasBookingUpdate) {
      await this.fetchAndNotifyBookings();
    }

    if (hasResourceUpdate) {
      await this.fetchAndNotifyResources();
    }
  }

  // 获取并通知预订数据
  private async fetchAndNotifyBookings(): Promise<void> {
    try {
      console.log('获取预订数据...');
      console.log('Supabase 客户端:', !!supabase);
      const { data: bookings, error } = await supabase
        .from('smartoffice_bookings')
        .select('*')
        .order('start_time', { ascending: true });

      if (error) {
        console.error('Supabase 查询预订数据错误:', error);
        throw error;
      }

      const currentBookingsRaw = bookings || [];
      console.log('获取到预订数据:', currentBookingsRaw.length);
      
      // 转换数据格式
      const currentBookings = currentBookingsRaw.map(transformBookingFromDB);
      // 确保数据格式正确
      const validBookings = currentBookings.filter(b => b && typeof b === 'object' && b.id && b.startTime);
      console.log('有效预订数据:', validBookings.length);
      
      const delta = this.calculateBookingDelta(validBookings);

      this.lastBookings.clear();
      validBookings.forEach(b => this.lastBookings.set(b.id, b));

      console.log('准备调用 onBookingsChange 回调...');
      if (this.config.onBookingsChange) {
        this.config.onBookingsChange(validBookings, delta);
        console.log('onBookingsChange 回调已调用');
      } else {
        console.warn('onBookingsChange 回调未设置');
      }
    } catch (error) {
      console.error('获取预订数据失败:', error);
      throw error;
    }
  }

  // 获取并通知资源数据
  private async fetchAndNotifyResources(): Promise<void> {
    try {
      console.log('获取资源数据...');
      console.log('Supabase 客户端:', !!supabase);
      const { data: resources, error } = await supabase
        .from('smartoffice_resources')
        .select('*')
        .order('name', { ascending: true });

      if (error) {
        console.error('Supabase 查询资源数据错误:', error);
        throw error;
      }

      const currentResourcesRaw = resources || [];
      console.log('获取到资源数据:', currentResourcesRaw.length);
      
      // 转换数据格式
      const currentResources = currentResourcesRaw.map(transformResourceFromDB);
      // 确保数据格式正确
      const validResources = currentResources.filter(r => r && typeof r === 'object' && r.id && r.name);
      console.log('有效资源数据:', validResources.length);
      
      const delta = this.calculateResourceDelta(validResources);

      this.lastResources.clear();
      validResources.forEach(r => this.lastResources.set(r.id, r));

      console.log('准备调用 onResourcesChange 回调...');
      if (this.config.onResourcesChange) {
        this.config.onResourcesChange(validResources, delta);
        console.log('onResourcesChange 回调已调用');
      } else {
        console.warn('onResourcesChange 回调未设置');
      }
    } catch (error) {
      console.error('获取资源数据失败:', error);
      throw error;
    }
  }



  // 断线重连
  private scheduleReconnect(): void {
    if (this.connectionStatus === 'reconnecting') return;

    this.setConnectionStatus('reconnecting');

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('达到最大重连次数，停止重连');
      this.setConnectionStatus('disconnected');
      this.handleError(new Error('连接失败，请检查网络'));
      return;
    }

    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts),
      this.maxReconnectDelay
    );

    console.log(`将在 ${delay}ms 后尝试第 ${this.reconnectAttempts + 1} 次重连`);

    setTimeout(() => {
      this.reconnectAttempts++;
      this.connect();
    }, delay);
  }

  // 取消所有订阅
  private unsubscribeAll(): void {
    console.log('取消所有订阅...');
    if (this.bookingsChannel) {
      console.log('取消 bookings 订阅');
      this.bookingsChannel.unsubscribe();
      this.bookingsChannel = null;
    }
    if (this.resourcesChannel) {
      console.log('取消 resources 订阅');
      this.resourcesChannel.unsubscribe();
      this.resourcesChannel = null;
    }
  }

  // 手动刷新数据（当实时推送失败时的备选方案）
  public async refresh(): Promise<void> {
    console.log('手动刷新数据...');
    await this.fetchAndNotifyBookings();
    await this.fetchAndNotifyResources();
  }

  // 检查连接状态
  public getConnectionStatus(): ConnectionStatus {
    return this.connectionStatus;
  }

  // 设置连接状态
  private setConnectionStatus(status: ConnectionStatus): void {
    this.connectionStatus = status;
    if (this.config.onConnectionChange) {
      this.config.onConnectionChange(status);
    }
  }

  // 处理错误
  private handleError(error: Error): void {
    if (this.config.onError) {
      this.config.onError(error);
    }
  }
}

// 创建单例实例
let realtimeServiceInstance: RealtimeService | null = null;

export function createRealtimeService(config: RealtimeConfig): RealtimeService {
  console.log('createRealtimeService 被调用');
  if (realtimeServiceInstance) {
    realtimeServiceInstance.disconnect();
  }
  realtimeServiceInstance = new RealtimeService(config);
  return realtimeServiceInstance;
}

export function getRealtimeService(): RealtimeService | null {
  return realtimeServiceInstance;
}

export type { RealtimeConfig, ConnectionStatus, BookingDelta, ResourceDelta };
