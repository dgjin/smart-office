import React from 'react';
import ReactDOM from 'react-dom/client';
import RoomDisplay from './components/RoomDisplay';

// 从 URL 参数获取 roomId
function getRoomIdFromUrl(): string | null {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('roomId');
}

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
    console.error('[RoomDisplay] 错误边界捕获:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gray-900 flex items-center justify-center text-white p-8">
          <div className="text-center">
            <div className="text-6xl mb-4">⚠️</div>
            <h1 className="text-4xl font-bold mb-4">显示组件出错</h1>
            <p className="text-xl text-gray-400 mb-4">
              {this.state.error?.message || '未知错误'}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg text-lg transition-colors"
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

// 无效 roomId 错误页面
function InvalidRoomIdError() {
  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center text-white p-8">
      <div className="text-center max-w-2xl">
        <div className="text-6xl mb-4">🏢</div>
        <h1 className="text-4xl font-bold mb-4">会议室ID无效</h1>
        <p className="text-xl text-gray-400 mb-6">
          请在URL中提供有效的会议室ID
        </p>
        <div className="bg-gray-800 rounded-xl p-6 text-left">
          <p className="text-lg text-gray-300 mb-2">正确的URL格式:</p>
          <code className="block bg-gray-900 rounded-lg p-4 text-blue-400 font-mono text-lg">
            {window.location.origin}/room-display.html?roomId=your-room-id
          </code>
        </div>
        <p className="text-gray-500 mt-6">
          示例: ?roomId=00000000-0000-0000-0000-000000000001
        </p>
      </div>
    </div>
  );
}

// 初始化应用
function initApp() {
  const roomId = getRoomIdFromUrl();
  const rootElement = document.getElementById('root');

  if (!rootElement) {
    console.error('[RoomDisplay] 找不到 root 元素');
    return;
  }

  const root = ReactDOM.createRoot(rootElement);

  // 验证 roomId
  if (!roomId) {
    root.render(<InvalidRoomIdError />);
    return;
  }

  // 验证 UUID 格式
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(roomId)) {
    console.warn('[RoomDisplay] RoomID 格式可能不正确:', roomId);
    // 仍然尝试渲染，让组件处理错误
  }

  console.log('[RoomDisplay] 初始化，会议室ID:', roomId);

  root.render(
    <React.StrictMode>
      <ErrorBoundary>
        <RoomDisplay roomId={roomId} />
      </ErrorBoundary>
    </React.StrictMode>
  );
}

// 启动应用
initApp();

// 监听全屏快捷键 (F11)
document.addEventListener('keydown', (e) => {
  if (e.key === 'F11') {
    e.preventDefault();
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err => {
        console.error('[RoomDisplay] 全屏失败:', err);
      });
    } else {
      document.exitFullscreen();
    }
  }
});

// 自动全屏 (可选)
// window.addEventListener('load', () => {
//   setTimeout(() => {
//     if (!document.fullscreenElement) {
//       document.documentElement.requestFullscreen().catch(() => {});
//     }
//   }, 1000);
// });

// 防止屏幕休眠 (通过定期发送请求)
setInterval(() => {
  // 发送一个 noop 请求保持连接活跃
  fetch(window.location.href, { method: 'HEAD', cache: 'no-cache' })
    .catch(() => {});
}, 60000);

console.log('[RoomDisplay] 应用已启动');
