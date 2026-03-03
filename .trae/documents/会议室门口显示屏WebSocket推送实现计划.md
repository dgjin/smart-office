# 会议室门口显示屏 WebSocket 信息推送实现计划

## 概述

实现每个会议室门口的显示屏信息推送功能，通过 WebSocket 实时推送会议室使用情况。屏幕启动时携带 RoomID 连接后端，后端维护 RoomID -> Connection 映射，当预约数据库发生 Insert/Update 时触发推送。

## 现有基础分析

### 已有组件
1. **MeetingRoomMonitor.tsx** - 监控大屏组件，显示所有会议室状态
2. **realtimeService.ts** - 基于 Supabase Realtime 的实时数据服务
3. **monitor-main.tsx** - 监控大屏入口

### 技术栈
- 前端: React + TypeScript + Vite
- 后端: Supabase (PostgreSQL + Realtime)
- 实时通信: Supabase Realtime (基于 WebSocket)

## 实现方案

### 方案选择: 基于 Supabase Realtime 的定向推送

**理由**:
- 系统已使用 Supabase Realtime，无需额外搭建 WebSocket 服务器
- 支持 PostgreSQL 数据库变更监听
- 支持按 RoomID 过滤订阅
- 自动处理重连和状态管理

---

## 详细实现步骤

### 第一阶段: 创建单会议室显示组件

#### 1.1 创建 RoomDisplay 组件
**文件**: `components/RoomDisplay.tsx`

功能:
- 接收 roomId 参数 (URL query 或 props)
- 显示单个会议室的实时状态
- 当前会议/下一会议信息
- 会议室基本信息 (名称、容量、设备等)

界面元素:
```
┌─────────────────────────────┐
│  会议室名称                    │
│  [状态指示灯] 当前状态          │
├─────────────────────────────┤
│  当前会议                      │
│  - 会议主题: xxx              │
│  - 时间: 09:00 - 10:00        │
│  - 预订人: 张三               │
│  - 部门: 研发部               │
├─────────────────────────────┤
│  下一会议                      │
│  - 会议主题: xxx              │
│  - 时间: 10:30 - 11:30        │
├─────────────────────────────┤
│  会议室设备: 投影仪、白板...    │
│  容量: 10人                   │
└─────────────────────────────┘
```

#### 1.2 创建单会议室入口页面
**文件**: `room-display.html` + `room-display-main.tsx`

功能:
- 独立的 HTML 入口
- 从 URL 参数读取 roomId
- 全屏显示模式

URL 格式: `room-display.html?roomId=xxx`

---

### 第二阶段: 扩展 RealtimeService 支持单会议室订阅

#### 2.1 添加单会议室订阅方法
**文件**: `services/realtimeService.ts`

新增方法:
```typescript
// 订阅单个会议室的预订变更
subscribeToRoomBookings(roomId: string, callback: (bookings: Booking[]) => void)

// 取消单个会议室订阅
unsubscribeFromRoomBookings(roomId: string)
```

实现逻辑:
- 使用 Supabase channel 的 filter 功能
- 只监听特定 resource_id 的 bookings 变更
- 避免接收无关会议室的数据

#### 2.2 优化数据推送
- 当 bookings 表发生 INSERT/UPDATE/DELETE 时
- 检查变更记录的 resource_id
- 只向对应 roomId 的连接推送数据

---

### 第三阶段: 数据库触发器 (可选增强)

#### 3.1 创建数据库触发器函数
**文件**: `scripts/migrate-room-display.sql`

功能:
- 当 bookings 表发生变更时
- 自动触发 Realtime 通知
- 确保数据变更立即推送

```sql
-- 确保 bookings 表已启用 REPLICA IDENTITY FULL
ALTER TABLE smartoffice_bookings REPLICA IDENTITY FULL;

-- 触发器已在 Supabase Realtime 中自动处理
-- 无需额外配置
```

---

### 第四阶段: 创建独立显示页面

#### 4.1 配置 Vite 多入口
**文件**: `vite.config.ts`

修改配置支持多入口:
```typescript
build: {
  rollupOptions: {
    input: {
      main: 'index.html',
      monitor: 'monitor.html',
      'room-display': 'room-display.html'
    }
  }
}
```

#### 4.2 创建 room-display.html
**文件**: `room-display.html`

模板:
```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>会议室状态</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/room-display-main.tsx"></script>
</body>
</html>
```

#### 4.3 创建 room-display-main.tsx
**文件**: `room-display-main.tsx`

功能:
- 解析 URL 参数获取 roomId
- 验证 roomId 有效性
- 渲染 RoomDisplay 组件
- 错误处理 (无效 roomId、网络错误等)

---

### 第五阶段: 样式和交互优化

#### 5.1 设计显示屏专用样式
- 大字体，远距离可读
- 高对比度颜色
- 状态指示灯动画
- 自动刷新机制 (备用)

#### 5.2 添加交互功能
- 点击刷新按钮
- 网络断开提示
- 无会议时的空闲显示
- 会议即将结束提醒

---

### 第六阶段: 测试和部署

#### 6.1 测试场景
1. 正常显示当前会议
2. 会议变更实时更新
3. 网络断开重连
4. 无效 roomId 处理
5. 多屏幕同时连接

#### 6.2 部署步骤
1. 构建项目
2. 部署到静态服务器
3. 配置每个显示屏的 URL
4. 验证实时推送

---

## 文件变更清单

### 新增文件
1. `components/RoomDisplay.tsx` - 单会议室显示组件
2. `room-display.html` - 显示屏入口 HTML
3. `room-display-main.tsx` - 显示屏入口脚本
4. `styles/room-display.css` - 显示屏专用样式 (可选)

### 修改文件
1. `services/realtimeService.ts` - 添加单会议室订阅方法
2. `vite.config.ts` - 配置多入口构建
3. `package.json` - 添加构建脚本 (如需要)

---

## 技术细节

### WebSocket 连接流程
```
┌──────────────┐         ┌──────────────┐         ┌──────────────┐
│   显示屏      │         │  Supabase    │         │  PostgreSQL  │
│  (Browser)   │         │  Realtime    │         │   Database   │
└──────┬───────┘         └──────┬───────┘         └──────┬───────┘
       │                        │                        │
       │  1. 连接携带 roomId     │                        │
       │───────────────────────>│                        │
       │                        │                        │
       │  2. 订阅 bookings       │                        │
       │  (filter: resource_id)  │                        │
       │───────────────────────>│                        │
       │                        │                        │
       │                        │  3. 监听 WAL 变更       │
       │                        │<───────────────────────│
       │                        │                        │
       │  4. 推送变更数据        │                        │
       │<───────────────────────│                        │
       │                        │                        │
```

### 数据格式
推送的 JSON 数据格式:
```json
{
  "type": "booking_change",
  "roomId": "uuid",
  "event": "INSERT|UPDATE|DELETE",
  "data": {
    "currentBooking": { ... },
    "nextBooking": { ... },
    "roomInfo": { ... }
  },
  "timestamp": "2024-03-03T10:00:00Z"
}
```

---

## 风险和对策

| 风险 | 对策 |
|------|------|
| Supabase Realtime 连接数限制 | 使用连接池，合理管理订阅 |
| 网络不稳定导致断连 | 实现自动重连机制 |
| 大量数据变更导致频繁推送 | 使用防抖/节流处理 |
| 显示屏分辨率差异 | 响应式设计，适配多种屏幕 |

---

## 测试方案

### 测试环境准备

#### 1. 测试数据准备
```sql
-- 创建测试会议室
INSERT INTO smartoffice_resources (id, name, type, capacity, location, features, status) VALUES
    ('test-room-001', '测试会议室A', 'ROOM', 10, '1楼东侧', ARRAY['投影仪', '白板'], 'AVAILABLE'),
    ('test-room-002', '测试会议室B', 'ROOM', 20, '2楼西侧', ARRAY['投影仪', '视频会议'], 'AVAILABLE');

-- 创建测试预订
INSERT INTO smartoffice_bookings (id, user_id, resource_id, type, start_time, end_time, status, purpose, participants) VALUES
    ('test-booking-001', '00000000-0000-0000-0000-000000000011', 'test-room-001', 'ROOM', 
     NOW() + INTERVAL '1 hour', NOW() + INTERVAL '2 hour', 'APPROVED', '测试会议1', 5),
    ('test-booking-002', '00000000-0000-0000-0000-000000000012', 'test-room-001', 'ROOM', 
     NOW() + INTERVAL '3 hour', NOW() + INTERVAL '4 hour', 'PENDING', '测试会议2', 8);
```

#### 2. 测试页面访问
```
开发环境: http://localhost:5173/room-display.html?roomId=test-room-001
生产环境: https://your-domain.com/room-display.html?roomId=test-room-001
```

---

### 功能测试用例

#### TC-001: 正常显示当前会议
| 项目 | 内容 |
|------|------|
| **测试目的** | 验证显示屏能正确显示当前会议室状态 |
| **前置条件** | 1. 会议室 test-room-001 存在<br>2. 该会议室有已批准的当前会议 |
| **测试步骤** | 1. 打开 room-display.html?roomId=test-room-001<br>2. 观察页面显示 |
| **预期结果** | 1. 显示会议室名称"测试会议室A"<br>2. 状态指示灯为绿色(进行中)或蓝色(空闲)<br>3. 显示当前会议信息(主题、时间、预订人、部门) |
| **通过标准** | 所有信息正确显示，无错误提示 |

#### TC-002: 实时更新会议状态
| 项目 | 内容 |
|------|------|
| **测试目的** | 验证数据库变更能实时推送到显示屏 |
| **前置条件** | 1. 显示屏已打开并连接<br>2. 会议室当前无会议 |
| **测试步骤** | 1. 在系统中为 test-room-001 创建新预订(当前时间)<br>2. 观察显示屏变化 |
| **预期结果** | 1. 3秒内显示屏自动更新<br>2. 显示新创建的会议信息<br>3. 状态指示灯变为绿色 |
| **通过标准** | 数据变更在5秒内同步到显示屏 |

#### TC-003: 会议结束自动切换
| 项目 | 内容 |
|------|------|
| **测试目的** | 验证当前会议结束后自动显示下一会议 |
| **前置条件** | 1. 会议室有当前会议和下一会议<br>2. 当前会议即将结束 |
| **测试步骤** | 1. 等待当前会议结束时间到达<br>2. 观察显示屏变化 |
| **预期结果** | 1. 当前会议区域显示"无会议"或下一会议信息<br>2. 状态指示灯变为蓝色(空闲)或黄色(即将有会议) |
| **通过标准** | 会议结束后5秒内界面更新 |

#### TC-004: 网络断开重连
| 项目 | 内容 |
|------|------|
| **测试目的** | 验证网络异常时的自动重连机制 |
| **前置条件** | 1. 显示屏正常显示<br>2. 网络连接正常 |
| **测试步骤** | 1. 断开网络连接(关闭WiFi/拔掉网线)<br>2. 等待10秒<br>3. 恢复网络连接<br>4. 观察显示屏状态 |
| **预期结果** | 1. 断开网络后显示"连接中断"提示<br>2. 自动尝试重连(显示重连倒计时)<br>3. 恢复网络后自动重连成功<br>4. 数据同步更新 |
| **通过标准** | 网络恢复后10秒内自动重连并更新数据 |

#### TC-005: 无效 RoomID 处理
| 项目 | 内容 |
|------|------|
| **测试目的** | 验证无效 RoomID 的错误处理 |
| **测试步骤** | 1. 打开 room-display.html?roomId=invalid-id<br>2. 观察页面显示 |
| **预期结果** | 1. 显示"会议室不存在"错误页面<br>2. 提供返回首页或重新输入的选项<br>3. 无控制台错误 |
| **通过标准** | 友好提示错误信息，不崩溃 |

#### TC-006: 多屏幕同时连接
| 项目 | 内容 |
|------|------|
| **测试目的** | 验证多个显示屏同时连接同一会议室 |
| **前置条件** | 准备3个浏览器窗口/标签页 |
| **测试步骤** | 1. 在3个窗口同时打开同一 roomId<br>2. 创建新预订<br>3. 观察所有窗口 |
| **预期结果** | 1. 所有窗口同时显示相同数据<br>2. 数据变更时所有窗口同步更新<br>3. 各窗口独立运行，互不干扰 |
| **通过标准** | 所有窗口数据一致，同步延迟<3秒 |

#### TC-007: 长时间运行稳定性
| 项目 | 内容 |
|------|------|
| **测试目的** | 验证显示屏长时间运行的稳定性 |
| **测试步骤** | 1. 打开显示屏<br>2. 保持运行24小时<br>3. 期间进行多次预订操作 |
| **预期结果** | 1. 无内存泄漏(内存占用稳定)<br>2. 无卡顿或崩溃<br>3. 数据同步正常 |
| **通过标准** | 24小时内无异常，内存增长<50MB |

---

### 性能测试

#### PT-001: 首次加载性能
| 指标 | 目标值 | 测试方法 |
|------|--------|----------|
| 首屏加载时间 | < 3秒 | Chrome DevTools Network |
| 白屏时间 | < 1秒 | Lighthouse |
| 可交互时间 | < 5秒 | Lighthouse |

#### PT-002: 实时推送延迟
| 场景 | 目标延迟 | 测试方法 |
|------|----------|----------|
| INSERT 操作 | < 3秒 | 数据库插入到界面更新 |
| UPDATE 操作 | < 3秒 | 数据库更新到界面更新 |
| DELETE 操作 | < 3秒 | 数据库删除到界面更新 |

#### PT-003: 并发连接测试
| 场景 | 目标 | 测试方法 |
|------|------|----------|
| 50个显示屏同时连接 | 全部正常显示 | 使用浏览器多标签页模拟 |
| 100个显示屏同时连接 | 无连接失败 | 使用自动化脚本测试 |

---

### 兼容性测试

| 设备类型 | 浏览器/系统 | 分辨率 | 测试内容 |
|----------|-------------|--------|----------|
| 平板电脑 | iPad Safari | 1024x768 | 显示正常、触摸操作 |
| 平板电脑 | Android Chrome | 1280x800 | 显示正常、触摸操作 |
| 智能电视 | Tizen Browser | 1920x1080 | 显示正常、字体清晰 |
| 迷你主机 | Windows Edge | 1920x1080 | 显示正常、自动全屏 |
| 树莓派 | Chromium | 1280x720 | 显示正常、性能流畅 |

---

### 测试工具脚本

#### 自动化测试脚本
```typescript
// tests/room-display.e2e.test.ts
import { test, expect } from '@playwright/test';

test.describe('会议室显示屏', () => {
  test('TC-001: 正常显示当前会议', async ({ page }) => {
    await page.goto('/room-display.html?roomId=test-room-001');
    await expect(page.locator('[data-testid="room-name"]')).toHaveText('测试会议室A');
    await expect(page.locator('[data-testid="status-indicator"]')).toBeVisible();
  });

  test('TC-002: 实时更新会议状态', async ({ page }) => {
    await page.goto('/room-display.html?roomId=test-room-001');
    
    // 模拟创建预订
    await createTestBooking('test-room-001');
    
    // 等待更新
    await page.waitForSelector('[data-testid="current-booking"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="booking-title"]')).toBeVisible();
  });

  test('TC-004: 网络断开重连', async ({ page }) => {
    await page.goto('/room-display.html?roomId=test-room-001');
    
    // 模拟断网
    await page.context().setOffline(true);
    await expect(page.locator('[data-testid="offline-warning"]')).toBeVisible();
    
    // 恢复网络
    await page.context().setOffline(false);
    await expect(page.locator('[data-testid="offline-warning"]')).not.toBeVisible();
  });
});
```

#### 性能监控脚本
```typescript
// tests/performance-monitor.ts
export class PerformanceMonitor {
  private metrics = {
    connectionTime: 0,
    firstDataTime: 0,
    updateLatency: [] as number[],
  };

  startMonitoring() {
    const startTime = performance.now();
    
    // 监控连接时间
    window.addEventListener('room-display-connected', () => {
      this.metrics.connectionTime = performance.now() - startTime;
    });

    // 监控首次数据
    window.addEventListener('room-display-first-data', () => {
      this.metrics.firstDataTime = performance.now() - startTime;
    });

    // 监控更新延迟
    window.addEventListener('room-display-update', (e: CustomEvent) => {
      const { dbChangeTime, receiveTime } = e.detail;
      this.metrics.updateLatency.push(receiveTime - dbChangeTime);
    });
  }

  getReport() {
    return {
      ...this.metrics,
      avgUpdateLatency: this.metrics.updateLatency.reduce((a, b) => a + b, 0) / this.metrics.updateLatency.length,
      maxUpdateLatency: Math.max(...this.metrics.updateLatency),
    };
  }
}
```

---

### 测试通过标准

#### 功能测试
- [ ] 所有测试用例通过率 > 95%
- [ ] 无 P0/P1 级别 Bug
- [ ] 界面显示无错位、无闪烁

#### 性能测试
- [ ] 首屏加载 < 3秒
- [ ] 实时推送延迟 < 3秒
- [ ] 内存占用稳定，无泄漏

#### 兼容性测试
- [ ] 目标设备全部通过
- [ ] 响应式布局正常

---

## 后续优化方向

1. **会议室预约二维码** - 扫码快速预约
2. **语音播报** - 会议开始/结束提醒
3. **环境传感器集成** - 温度、湿度、空气质量显示
4. **人脸识别签到** - 自动记录参会人员
