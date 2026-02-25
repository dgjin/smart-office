import { createRealtimeService, ConnectionStatus } from './services/realtimeService';

// 测试实时服务
function testRealtimeService() {
  console.log('=== 测试实时服务 ===');
  
  const realtimeService = createRealtimeService({
    onBookingsChange: (bookings, delta) => {
      console.log('收到预订数据更新:', {
        total: bookings.length,
        added: delta.added.length,
        updated: delta.updated.length,
        deleted: delta.deleted.length
      });
      console.log('预订数据示例:', bookings.slice(0, 2));
    },
    onResourcesChange: (resources, delta) => {
      console.log('收到资源数据更新:', {
        total: resources.length,
        added: delta.added.length,
        updated: delta.updated.length,
        deleted: delta.deleted.length
      });
      console.log('资源数据示例:', resources.slice(0, 2));
    },
    onConnectionChange: (status: ConnectionStatus) => {
      console.log('连接状态变更:', status);
    },
    onError: (error: Error) => {
      console.error('实时服务错误:', error);
    }
  });
  
  // 建立连接
  realtimeService.connect().then(() => {
    console.log('连接成功');
  }).catch((error: Error) => {
    console.error('连接失败:', error);
  });
  
  // 10秒后断开连接
  setTimeout(() => {
    console.log('断开连接');
    realtimeService.disconnect();
  }, 10000);
}

// 运行测试
testRealtimeService();
