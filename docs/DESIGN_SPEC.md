# 智慧办公空间管理系统 (SmartOffice) - 详细设计说明书

## 1. 技术栈与架构
*   **前端框架**：React 19 (ESM 模式)
*   **样式体系**：Tailwind CSS (响应式、原子化 CSS)
*   **图标库**：Lucide React
*   **核心算法**：Gemini API (@google/genai)
*   **持久化层**：浏览器 LocalStorage + 模拟 REST API 同步

---

## 2. 数据模型设计 (Types)
系统核心实体定义如下：

```typescript
// 用户模型
interface User {
  id: string;
  name: string;
  role: string[]; // 关联 RoleDefinition.id
  department: string;
}

// 资源模型
interface Resource {
  id: string;
  type: 'ROOM' | 'DESK';
  capacity: number;
  status: 'AVAILABLE' | 'OCCUPIED' | 'MAINTENANCE';
}

// 预约单模型
interface Booking {
  id: string;
  userId: string;
  resourceId: string;
  startTime: string; // ISO String
  endTime: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  recurrence?: { frequency: string; count: number }; // 周期性配置
}
```

---

## 3. 关键模块详细设计

### 3.1 周期性预约逻辑
当 `isRecurring` 为真时，`handleBooking` 方法进入批量处理模式：
1.  根据 `frequency` (DAILY/WEEKLY/MONTHLY) 循环 `count` 次。
2.  每次循环通过 `Date` 对象计算出下一个目标日期。
3.  对每一个生成的时间片执行 `Conflict Check`。
4.  **原子性保证**：若所有时间片均无冲突，则一次性写入状态；若部分冲突，则仅创建成功部分，并返回详细报告。

### 3.2 冲突检测算法
`findNextAvailableSlot` 函数实现思路：
1.  获取当前资源的所有非“驳回”状态预约。
2.  从当前时间点开始，以 30 分钟为步长向后探测。
3.  查找第一个能够容纳 `requestedDuration` 且不与已有记录重叠的空档。

### 3.3 审批流引擎实现
审批系统采用“状态机”设计模式：
*   每个 `Booking` 维护一个 `currentNodeIndex`。
*   `status` 默认为 `PENDING`。
*   当 `currentNodeIndex` 等于 `workflow.length - 1` 且审批通过时，最终状态变更为 `APPROVED`。

---

## 4. UI/UX 规范
*   **主题变量**：基于 Tailwind 类名动态拼接（如 `bg-${theme}-600`），实现运行时主题切换。
*   **响应式适配**：侧边栏在移动端自动隐藏，主视图通过 `overflow-hidden` 配合 `flex-1` 实现全屏沉浸式体验。
*   **加载反馈**：AI 交互过程中使用 `animate-spin` 提升感知体验。
