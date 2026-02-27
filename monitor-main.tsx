import React from 'react';
import ReactDOM from 'react-dom/client';
import { MeetingRoomMonitor } from './components/MeetingRoomMonitor';
import { createRealtimeService, ConnectionStatus, BookingDelta, ResourceDelta } from './services/realtimeService';
import { Booking, Resource } from './types';

// 错误边界组件
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('MonitorApp 错误:', error);
    console.error('错误详情:', errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-900 flex items-center justify-center text-white p-8">
          <div className="text-center">
            <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h1 className="text-xl font-bold mb-2">发生错误</h1>
            <p className="text-red-400 mb-4">{this.state.error?.message}</p>
            <pre className="text-left text-xs text-slate-400 bg-slate-800 p-4 rounded-lg overflow-auto max-w-lg">
              {this.state.error?.stack}
            </pre>
            <button 
              onClick={() => window.location.reload()}
              className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              重新加载
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

const MonitorApp: React.FC = () => {
  // 添加默认数据，以便在没有实时数据时也能显示一些内容
  const defaultResources: Resource[] = [
    {
      id: '1',
      name: '会议室1',
      type: 'ROOM',
      capacity: 10,
      location: '1楼',
      features: ['投影仪', '白板'],
      status: 'AVAILABLE'
    },
    {
      id: '2',
      name: '会议室2',
      type: 'ROOM',
      capacity: 20,
      location: '2楼',
      features: ['投影仪', '白板', '视频会议系统'],
      status: 'AVAILABLE'
    }
  ];

  const defaultBookings: Booking[] = [
    {
      id: '1',
      userId: '1',
      resourceId: '1',
      type: 'ROOM',
      startTime: new Date().toISOString(),
      endTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      status: 'APPROVED',
      purpose: '团队会议',
      participants: 5,
      createdAt: new Date().toISOString(),
      currentNodeIndex: 0,
      approvalHistory: []
    }
  ];

  const [bookings, setBookings] = React.useState<Booking[]>(defaultBookings);
  const [resources, setResources] = React.useState<Resource[]>(defaultResources);
  const [isInitialLoad, setIsInitialLoad] = React.useState(true);
  const [connectionStatus, setConnectionStatus] = React.useState<ConnectionStatus>('disconnected');
  const [lastUpdate, setLastUpdate] = React.useState<Date>(new Date());
  const [updateStats, setUpdateStats] = React.useState({ added: 0, updated: 0, deleted: 0 });
  const [hasBookingsData, setHasBookingsData] = React.useState(true);
  const [hasResourcesData, setHasResourcesData] = React.useState(true);
  const [initialDataLoaded, setInitialDataLoaded] = React.useState(false);
  const realtimeServiceRef = React.useRef<any>(null);

  // 调试：打印状态变化
  React.useEffect(() => {
    console.log('MonitorApp 状态变化:', {
      bookingsCount: bookings.length,
      resourcesCount: resources.length,
      connectionStatus,
      hasInitialData: hasBookingsData || hasResourcesData
    });
  }, [bookings, resources, connectionStatus, hasBookingsData, hasResourcesData]);

  // 只有同时收到预订和资源数据后才显示界面
  const hasInitialData = hasBookingsData || hasResourcesData;

  React.useEffect(() => {
    console.log('MonitorApp 初始化...');
    
    try {
      console.log('开始创建实时服务...');
      // 创建实时服务
      const realtimeService = createRealtimeService({
        onBookingsChange: (newBookings: Booking[], delta: BookingDelta) => {
        console.log('收到预订数据更新:', { 
          total: newBookings.length, 
          added: delta.added.length, 
          updated: delta.updated.length, 
          deleted: delta.deleted.length,
          initialDataLoaded: initialDataLoaded
        });
        // 只有当有真实数据时才更新
        if (newBookings.length > 0) {
          console.log('更新预订数据:', newBookings.length, '条');
          setBookings(newBookings);
          setUpdateStats({
            added: delta.added.length,
            updated: delta.updated.length,
            deleted: delta.deleted.length
          });
          setLastUpdate(new Date());
          setHasBookingsData(true);
          setIsInitialLoad(false);
          setInitialDataLoaded(true);
        } else {
          console.log('收到空预订数据，保持当前数据');
          // 如果已经加载了初始数据，不覆盖
          if (!initialDataLoaded) {
            console.log('初始数据未加载，保持默认数据');
          }
        }
      },
      onResourcesChange: (newResources: Resource[], delta: ResourceDelta) => {
        console.log('收到资源数据更新:', { 
          total: newResources.length, 
          added: delta.added.length, 
          updated: delta.updated.length, 
          deleted: delta.deleted.length,
          initialDataLoaded: initialDataLoaded
        });
        // 只有当有真实数据时才更新
        if (newResources.length > 0) {
          console.log('更新资源数据:', newResources.length, '条');
          setResources(newResources);
          setLastUpdate(new Date());
          setHasResourcesData(true);
          setIsInitialLoad(false);
          setInitialDataLoaded(true);
        } else {
          console.log('收到空资源数据，保持当前数据');
          // 如果已经加载了初始数据，不覆盖
          if (!initialDataLoaded) {
            console.log('初始数据未加载，保持默认数据');
          }
        }
      },
        onConnectionChange: (status: ConnectionStatus) => {
          console.log('连接状态变更:', status);
          setConnectionStatus(status);
        },
        onError: (error: Error) => {
          console.error('实时服务错误:', error);
        }
      });

      console.log('实时服务创建成功:', realtimeService);
      realtimeServiceRef.current = realtimeService;

      // 建立连接
      console.log('开始建立连接...');
      realtimeService.connect().then(() => {
        console.log('连接建立成功');
      }).catch((error: Error) => {
        console.error('连接建立失败:', error);
      });

      // 清理函数
      return () => {
        console.log('清理实时服务...');
        realtimeService.disconnect();
      };
    } catch (error) {
      console.error('初始化实时服务失败:', error);
    }
  }, []);

  console.log('MonitorApp 渲染:', { 
    bookingsCount: bookings.length, 
    resourcesCount: resources.length, 
    connectionStatus,
    hasInitialData
  });

  // 连接状态指示器
  const getStatusColor = () => {
    switch (connectionStatus) {
      case 'connected': return 'bg-emerald-500';
      case 'connecting': return 'bg-amber-500 animate-pulse';
      case 'reconnecting': return 'bg-amber-500 animate-pulse';
      case 'disconnected': return 'bg-red-500';
      default: return 'bg-gray-500';
    }
  };

  const getStatusText = () => {
    switch (connectionStatus) {
      case 'connected': return '实时连接';
      case 'connecting': return '连接中...';
      case 'reconnecting': return '重连中...';
      case 'disconnected': return '已断开';
      default: return '未知';
    }
  };

  // 等待初始数据加载
  if (!hasInitialData) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-slate-400">正在加载数据...</p>
          <p className="text-xs text-slate-500 mt-2">连接状态: {getStatusText()}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* 连接状态指示器 */}
      <div className="fixed top-4 right-4 z-50 flex items-center space-x-2 bg-slate-800/90 backdrop-blur px-3 py-2 rounded-full border border-slate-700">
        <div className={`w-2 h-2 rounded-full ${getStatusColor()}`} />
        <span className="text-xs text-slate-300">{getStatusText()}</span>
        {updateStats.added > 0 && (
          <span className="text-xs text-emerald-400">+{updateStats.added}</span>
        )}
        {updateStats.updated > 0 && (
          <span className="text-xs text-amber-400">~{updateStats.updated}</span>
        )}
        {updateStats.deleted > 0 && (
          <span className="text-xs text-red-400">-{updateStats.deleted}</span>
        )}
        <button
          onClick={() => realtimeServiceRef.current?.refresh()}
          className="ml-2 px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600 rounded text-slate-300 transition-colors"
          title="手动刷新数据"
        >
          刷新
        </button>
      </div>

      <MeetingRoomMonitor bookings={bookings} resources={resources} />
      
      {/* 最后更新时间 */}
      <div className="fixed bottom-4 right-4 text-xs text-slate-600">
        最后更新: {lastUpdate.toLocaleTimeString()}
      </div>
    </div>
  );
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <MonitorApp />
    </ErrorBoundary>
  </React.StrictMode>
);
