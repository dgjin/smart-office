import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { User, Resource, Booking, RoleDefinition, Department, ApprovalNode } from '../types';

// Supabase 配置 - 请替换为您的实际配置
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'your-supabase-url';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'your-supabase-anon-key';

// 调试日志
console.log('Supabase URL:', SUPABASE_URL);
console.log('Supabase Key 是否存在:', !!SUPABASE_ANON_KEY);

// 数据库表名（使用 smartoffice 前缀）
const TABLES = {
  USERS: 'smartoffice_users',
  RESOURCES: 'smartoffice_resources',
  BOOKINGS: 'smartoffice_bookings',
  ROLES: 'smartoffice_roles',
  DEPARTMENTS: 'smartoffice_departments',
  WORKFLOW: 'smartoffice_workflow',
  AUDIT: 'smartoffice_approval_audit',
} as const;

// 创建 Supabase 客户端
export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
  },
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
  global: {
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
  },
});

// 测试 Supabase 连接
export async function testConnection(): Promise<boolean> {
  try {
    const { data, error } = await supabase.from(TABLES.USERS).select('*').limit(1);
    if (error) {
      console.error('Supabase 连接测试失败:', JSON.stringify(error, null, 2));
      return false;
    }
    console.log('连接成功，数据:', data);
    return true;
  } catch (error: any) {
    console.error('Supabase 连接测试异常:', error?.message || error);
    return false;
  }
}


// 根据邮箱获取用户
export async function getUserByEmail(email: string): Promise<User | null> {
  const { data, error } = await supabase
    .from(TABLES.USERS)
    .select('*')
    .eq('email', email)
    .single();
  
  if (error) {
    if (error.code === 'PGRST116') {
      // 找不到记录
      return null;
    }
    console.error('获取用户失败:', error);
    throw error;
  }
  
  return data ? transformUserFromDB(data) : null;
}

// 密码加密函数 (SHA-256)
async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// 邮箱和密码登录
export async function loginWithEmailAndPassword(email: string, password: string): Promise<User | null> {
  try {
    console.log('登录尝试:', email);
    
    // 先获取用户信息（包括密码哈希）
    const { data: userData, error: userError } = await supabase
      .from(TABLES.USERS)
      .select('*')
      .eq('email', email)
      .single();
    
    if (userError || !userData) {
      console.log('用户不存在:', email);
      return null;
    }
    
    console.log('找到用户:', userData.name);
    console.log('数库密码:', userData.password);
    console.log('密码长度:', userData.password?.length);
    
    const dbPassword = userData.password?.trim();
    let isValid = false;
    
    // 方式1: 如果是 bcrypt 格式（以 $2a$, $2b$, $2y$ 开头）
    if (dbPassword?.startsWith('$2')) {
      console.log('检测到 bcrypt 格式，尝试验证...');
      try {
        const { data: verifyResult } = await supabase
          .rpc('smartoffice_verify_password', {
            p_password: password,
            p_hash: dbPassword
          });
        console.log('bcrypt 验证结果:', verifyResult);
        isValid = verifyResult === true;
      } catch (e) {
        console.log('bcrypt 验证失败:', e);
      }
    }
    
    // 方式2: 如果是 SHA-256 格式（64位十六进制）
    if (!isValid && dbPassword?.length === 64) {
      console.log('检测到 SHA-256 格式，尝试验证...');
      const hashedPassword = await hashPassword(password);
      console.log('计算的 SHA-256:', hashedPassword);
      isValid = dbPassword === hashedPassword;
      console.log('SHA-256 验证结果:', isValid);
    }
    
    // 方式3: 明文密码（不推荐，仅用于迁移）
    if (!isValid) {
      console.log('尝试明文比较...');
      isValid = dbPassword === password;
      console.log('明文验证结果:', isValid);
    }
    
    if (isValid) {
      return transformUserFromDB(userData);
    }
    
    return null;
  } catch (error) {
    console.error('登录失败:', error);
    return null;
  }
}

// 获取所有用户
export async function getUsers(): Promise<User[]> {
  const { data, error } = await supabase
    .from(TABLES.USERS)
    .select('*')
    .order('created_at', { ascending: false });
  
  if (error) {
    console.error('获取用户列表失败:', error);
    throw error;
  }
  
  return data?.map(transformUserFromDB) || [];
}

export async function createUserWithPassword(userData: Omit<User, 'id'>): Promise<User | null> {
  try {
    // 检查邮箱是否已存在
    const existingUser = await getUserByEmail(userData.email);
    if (existingUser) {
      return null;
    }
    
    // 创建用户
    const newUser = await createUser(userData);
    return newUser;
  } catch (error) {
    console.error('注册失败:', error);
    return null;
  }
}

export async function createUser(user: Omit<User, 'id'>): Promise<User> {
  const dbUser = transformUserToDB(user);
  const { data, error } = await supabase
    .from(TABLES.USERS)
    .insert([dbUser])
    .select()
    .single();
  
  if (error) {
    console.error('创建用户失败:', error);
    throw error;
  }
  
  return transformUserFromDB(data);
}

export async function updateUser(id: string, updates: Partial<User>): Promise<User> {
  const dbUpdates = transformUserToDB(updates);
  const { data, error } = await supabase
    .from(TABLES.USERS)
    .update(dbUpdates)
    .eq('id', id)
    .select()
    .single();
  
  if (error) {
    console.error('更新用户失败:', error);
    throw error;
  }
  
  return transformUserFromDB(data);
}

export async function deleteUser(id: string): Promise<void> {
  const { error } = await supabase
    .from(TABLES.USERS)
    .delete()
    .eq('id', id);
  
  if (error) {
    console.error('删除用户失败:', error);
    throw error;
  }
}

// ==================== 资源相关操作 ====================

export async function getResources(): Promise<Resource[]> {
  const { data, error } = await supabase
    .from(TABLES.RESOURCES)
    .select('*')
    .order('created_at', { ascending: false });
  
  if (error) {
    console.error('获取资源失败:', error);
    throw error;
  }
  
  return data?.map(transformResourceFromDB) || [];
}

export async function createResource(resource: Omit<Resource, 'id'>): Promise<Resource> {
  const dbResource = transformResourceToDB(resource);
  const { data, error } = await supabase
    .from(TABLES.RESOURCES)
    .insert([dbResource])
    .select()
    .single();
  
  if (error) {
    console.error('创建资源失败:', error);
    throw error;
  }
  
  return transformResourceFromDB(data);
}

export async function updateResource(id: string, updates: Partial<Resource>): Promise<Resource> {
  const dbUpdates = transformResourceToDB(updates);
  const { data, error } = await supabase
    .from(TABLES.RESOURCES)
    .update(dbUpdates)
    .eq('id', id)
    .select()
    .single();
  
  if (error) {
    console.error('更新资源失败:', error);
    throw error;
  }
  
  return transformResourceFromDB(data);
}

export async function deleteResource(id: string): Promise<void> {
  const { error } = await supabase
    .from(TABLES.RESOURCES)
    .delete()
    .eq('id', id);
  
  if (error) {
    console.error('删除资源失败:', error);
    throw error;
  }
}

// ==================== 预约相关操作 ====================

export async function getBookings(): Promise<Booking[]> {
  const { data, error } = await supabase
    .from(TABLES.BOOKINGS)
    .select('*')
    .order('created_at', { ascending: false });
  
  if (error) {
    console.error('获取预约失败:', error);
    throw error;
  }
  
  return data?.map(transformBookingFromDB) || [];
}

export async function getBookingsByUserId(userId: string): Promise<Booking[]> {
  const { data, error } = await supabase
    .from(TABLES.BOOKINGS)
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  
  if (error) {
    console.error('获取用户预约失败:', error);
    throw error;
  }
  
  return data?.map(transformBookingFromDB) || [];
}

export async function getBookingsByResourceId(resourceId: string): Promise<Booking[]> {
  const { data, error } = await supabase
    .from(TABLES.BOOKINGS)
    .select('*')
    .eq('resource_id', resourceId)
    .order('start_time', { ascending: true });
  
  if (error) {
    console.error('获取资源预约失败:', error);
    throw error;
  }
  
  return data?.map(transformBookingFromDB) || [];
}

export async function createBooking(booking: Omit<Booking, 'id'>): Promise<Booking> {
  const dbBooking = transformBookingToDB(booking);
  const { data, error } = await supabase
    .from(TABLES.BOOKINGS)
    .insert([dbBooking])
    .select()
    .single();
  
  if (error) {
    console.error('创建预约失败:', error);
    throw error;
  }
  
  return transformBookingFromDB(data);
}

export async function updateBooking(id: string, updates: Partial<Booking>): Promise<Booking> {
  const dbUpdates = transformBookingToDB(updates);
  const { data, error } = await supabase
    .from(TABLES.BOOKINGS)
    .update(dbUpdates)
    .eq('id', id)
    .select()
    .single();
  
  if (error) {
    console.error('更新预约失败:', error);
    throw error;
  }
  
  return transformBookingFromDB(data);
}

export async function deleteBooking(id: string): Promise<void> {
  const { error } = await supabase
    .from(TABLES.BOOKINGS)
    .delete()
    .eq('id', id);
  
  if (error) {
    console.error('删除预约失败:', error);
    throw error;
  }
}

// ==================== 角色相关操作 ====================

export async function getRoles(): Promise<RoleDefinition[]> {
  const { data, error } = await supabase
    .from(TABLES.ROLES)
    .select('*')
    .order('created_at', { ascending: true });
  
  if (error) {
    console.error('获取角色失败:', error);
    throw error;
  }
  
  return data?.map(transformRoleFromDB) || [];
}

export async function createRole(role: Omit<RoleDefinition, 'id'>): Promise<RoleDefinition> {
  const id = `role_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const dbRole = {
    id,
    name: role.name,
    description: role.description || '',
    color: role.color || 'indigo',
  };
  const { data, error } = await supabase
    .from(TABLES.ROLES)
    .insert([dbRole])
    .select()
    .single();
  
  if (error) {
    console.error('创建角色失败:', error);
    throw error;
  }
  
  return transformRoleFromDB(data);
}

export async function updateRole(id: string, updates: Partial<RoleDefinition>): Promise<RoleDefinition> {
  const dbUpdates = transformRoleToDB(updates);
  const { data, error } = await supabase
    .from(TABLES.ROLES)
    .update(dbUpdates)
    .eq('id', id)
    .select()
    .single();
  
  if (error) {
    console.error('更新角色失败:', error);
    throw error;
  }
  
  return transformRoleFromDB(data);
}

export async function deleteRole(id: string): Promise<void> {
  const { error } = await supabase
    .from(TABLES.ROLES)
    .delete()
    .eq('id', id);
  
  if (error) {
    console.error('删除角色失败:', error);
    throw error;
  }
}

// ==================== 部门相关操作 ====================

export async function getDepartments(): Promise<Department[]> {
  const { data, error } = await supabase
    .from(TABLES.DEPARTMENTS)
    .select('*')
    .order('created_at', { ascending: true });
  
  if (error) {
    console.error('获取部门失败:', error);
    throw error;
  }
  
  return data?.map(transformDepartmentFromDB) || [];
}

export async function createDepartment(department: Omit<Department, 'id'>): Promise<Department> {
  const dbDepartment = transformDepartmentToDB(department);
  const { data, error } = await supabase
    .from(TABLES.DEPARTMENTS)
    .insert([dbDepartment])
    .select()
    .single();
  
  if (error) {
    console.error('创建部门失败:', error);
    throw error;
  }
  
  return transformDepartmentFromDB(data);
}

export async function updateDepartment(id: string, updates: Partial<Department>): Promise<Department> {
  const dbUpdates = transformDepartmentToDB(updates);
  const { data, error } = await supabase
    .from(TABLES.DEPARTMENTS)
    .update(dbUpdates)
    .eq('id', id)
    .select()
    .single();
  
  if (error) {
    console.error('更新部门失败:', error);
    throw error;
  }
  
  return transformDepartmentFromDB(data);
}

export async function deleteDepartment(id: string): Promise<void> {
  const { error } = await supabase
    .from(TABLES.DEPARTMENTS)
    .delete()
    .eq('id', id);
  
  if (error) {
    console.error('删除部门失败:', error);
    throw error;
  }
}

// ==================== 工作流相关操作 ====================

export async function getWorkflow(): Promise<ApprovalNode[]> {
  const { data, error } = await supabase
    .from(TABLES.WORKFLOW)
    .select('*')
    .order('sort_order', { ascending: true });
  
  if (error) {
    console.error('获取工作流失败:', error);
    throw error;
  }
  
  return data?.map(transformWorkflowFromDB) || [];
}

export async function updateWorkflow(nodes: ApprovalNode[]): Promise<void> {
  // 使用 upsert（插入或更新），避免全表删除导致短暂不一致
  const dbNodes = nodes.map((node, index) => ({
    id: node.id,
    name: node.name,
    approver_role: node.approverRole,
    sort_order: index,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from(TABLES.WORKFLOW)
    .upsert(dbNodes, { onConflict: 'id' });

  if (error) {
    console.error('upsert 工作流节点失败:', error);
    throw error;
  }
}

/**
 * 在数据库层做原子审批操作：
 * - 验证 booking 存在且 current_node_index 与预期一致（避免并发冲突）
 * - 根据 decision 推进或置为已拒绝
 * - 向独立审计表插入一条不可变记录
 */
export async function approveBooking(
  bookingId: string,
  approverId: string,
  approverName: string,
  expectedNodeIndex: number,
  decision: 'APPROVED' | 'REJECTED',
  comment?: string
): Promise<Booking> {
  // 读取当前 booking
  const { data: dbBooking, error: fetchError } = await supabase
    .from(TABLES.BOOKINGS)
    .select('*')
    .eq('id', bookingId)
    .single();

  if (fetchError) {
    console.error('读取 booking 失败:', fetchError);
    throw fetchError;
  }
  if (!dbBooking) throw new Error('BOOKING_NOT_FOUND');

  const currentNodeIndex = dbBooking.current_node_index || 0;
  if (currentNodeIndex !== expectedNodeIndex) {
    throw new Error('CONFLICT: booking already processed');
  }

  // 获取工作流以判断是否为最后一级
  const workflow = await getWorkflow();
  const isLast = expectedNodeIndex === (workflow.length - 1);

  const approvalRecord = {
    nodeName: workflow[expectedNodeIndex]?.name || '未知',
    approverName: approverName || '未知',
    status: decision,
    comment: comment || '',
    timestamp: new Date().toISOString(),
  };

  const newApprovalHistory = Array.isArray(dbBooking.approval_history) ? [...dbBooking.approval_history, approvalRecord] : [approvalRecord];

  const newCurrentNodeIndex = (decision === 'APPROVED' && !isLast) ? currentNodeIndex + 1 : currentNodeIndex;
  const newStatus = decision === 'REJECTED' ? 'REJECTED' : (decision === 'APPROVED' && isLast ? 'APPROVED' : 'PENDING');

  // 原子更新：只在 current_node_index 未被修改的情况下更新
  const { data: updatedData, error: updateError } = await supabase
    .from(TABLES.BOOKINGS)
    .update({
      current_node_index: newCurrentNodeIndex,
      status: newStatus,
      approval_history: newApprovalHistory,
    })
    .eq('id', bookingId)
    .eq('current_node_index', currentNodeIndex)
    .select()
    .single();

  if (updateError) {
    console.error('审批更新失败:', updateError);
    throw updateError;
  }

  if (!updatedData) {
    // 未命中更新条件，视为并发冲突
    throw new Error('CONFLICT: booking updated by other actor');
  }

  // 如果是长期预订的主记录，批量更新所有从记录
  if (dbBooking.is_long_term && dbBooking.is_master) {
    try {
      // 更新所有关联的从记录
      await supabase
        .from(TABLES.BOOKINGS)
        .update({
          status: newStatus,
          approval_history: newApprovalHistory,
        })
        .eq('master_id', bookingId);
      
      console.log(`已批量更新长期预订组 ${bookingId} 的所有从记录状态为 ${newStatus}`);
    } catch (batchError) {
      console.error('批量更新从记录失败:', batchError);
      // 不阻止主流程，但记录错误
    }
  }

  // 写入审计表（不可回滚的审计记录）
  try {
    await supabase.from(TABLES.AUDIT).insert([{
      booking_id: bookingId,
      node_index: expectedNodeIndex,
      node_name: workflow[expectedNodeIndex]?.name || null,
      approver_id: approverId,
      approver_name: approverName,
      status: decision,
      comment: comment || null,
    }]);
  } catch (auditErr) {
    // 审计写入失败不应阻止主流程成功，但需要日志记录
    console.error('写入审批审计失败:', auditErr);
  }

  return transformBookingFromDB(updatedData);
}

// ==================== 数据转换函数 ====================

// 用户数据转换
function transformUserFromDB(dbUser: any): User {
  return {
    id: dbUser.id,
    name: dbUser.name,
    email: dbUser.email,
    role: dbUser.role || [],
    department: dbUser.department,
    landline: dbUser.landline,
    mobile: dbUser.mobile,
  };
}

function transformUserToDB(user: Partial<User>): any {
  return {
    ...(user.name && { name: user.name }),
    ...(user.email && { email: user.email }),
    ...(user.password && { password: user.password }),
    ...(user.role && { role: user.role }),
    ...(user.department && { department: user.department }),
    ...(user.landline && { landline: user.landline }),
    ...(user.mobile && { mobile: user.mobile }),
  };
}

// 资源数据转换
export function transformResourceFromDB(dbResource: any): Resource {
  return {
    id: dbResource.id,
    name: dbResource.name,
    type: dbResource.type,
    capacity: dbResource.capacity,
    location: dbResource.location,
    features: dbResource.features || [],
    status: dbResource.status,
  };
}

function transformResourceToDB(resource: Partial<Resource>): any {
  return {
    ...(resource.name && { name: resource.name }),
    ...(resource.type && { type: resource.type }),
    ...(resource.capacity && { capacity: resource.capacity }),
    ...(resource.location && { location: resource.location }),
    ...(resource.features && { features: resource.features }),
    ...(resource.status && { status: resource.status }),
  };
}

// 预约数据转换
export function transformBookingFromDB(dbBooking: any): Booking {
  return {
    id: dbBooking.id,
    userId: dbBooking.user_id,
    resourceId: dbBooking.resource_id,
    type: dbBooking.type,
    startTime: dbBooking.start_time,
    endTime: dbBooking.end_time,
    status: dbBooking.status,
    purpose: dbBooking.purpose,
    participants: dbBooking.participants,
    createdAt: dbBooking.created_at,
    currentNodeIndex: dbBooking.current_node_index || 0,
    approvalHistory: dbBooking.approval_history || [],
    hasLeader: dbBooking.has_leader,
    leaderDetails: dbBooking.leader_details,
    isVideoConference: dbBooking.is_video_conference,
    needsTeaService: dbBooking.needs_tea_service,
    needsNameCard: dbBooking.needs_name_card,
    nameCardDetails: dbBooking.name_card_details,
    // 长期预订字段
    isLongTerm: dbBooking.is_long_term,
    longTermGroupId: dbBooking.long_term_group_id,
    longTermStartDate: dbBooking.long_term_start_date,
    longTermEndDate: dbBooking.long_term_end_date,
    dailyStartTime: dbBooking.daily_start_time,
    dailyEndTime: dbBooking.daily_end_time,
    // 按周预订字段
    longTermType: dbBooking.long_term_type,
    selectedWeekDays: dbBooking.selected_week_days,
    weekCount: dbBooking.week_count,
    // 主从记录字段
    isMaster: dbBooking.is_master,
    masterId: dbBooking.master_id,
  };
}

function transformBookingToDB(booking: Partial<Booking>): any {
  return {
    ...(booking.userId && { user_id: booking.userId }),
    ...(booking.resourceId && { resource_id: booking.resourceId }),
    ...(booking.type && { type: booking.type }),
    ...(booking.startTime && { start_time: booking.startTime }),
    ...(booking.endTime && { end_time: booking.endTime }),
    ...(booking.status && { status: booking.status }),
    ...(booking.purpose && { purpose: booking.purpose }),
    ...(booking.participants && { participants: booking.participants }),
    ...(booking.currentNodeIndex !== undefined && { current_node_index: booking.currentNodeIndex }),
    ...(booking.approvalHistory && { approval_history: booking.approvalHistory }),
    ...(booking.hasLeader !== undefined && { has_leader: booking.hasLeader }),
    ...(booking.leaderDetails && { leader_details: booking.leaderDetails }),
    ...(booking.isVideoConference !== undefined && { is_video_conference: booking.isVideoConference }),
    ...(booking.needsTeaService !== undefined && { needs_tea_service: booking.needsTeaService }),
    ...(booking.needsNameCard !== undefined && { needs_name_card: booking.needsNameCard }),
    ...(booking.nameCardDetails && { name_card_details: booking.nameCardDetails }),
    // 长期预订字段
    ...(booking.isLongTerm !== undefined && { is_long_term: booking.isLongTerm }),
    ...(booking.longTermGroupId && { long_term_group_id: booking.longTermGroupId }),
    ...(booking.longTermStartDate && { long_term_start_date: booking.longTermStartDate }),
    ...(booking.longTermEndDate && { long_term_end_date: booking.longTermEndDate }),
    ...(booking.dailyStartTime && { daily_start_time: booking.dailyStartTime }),
    ...(booking.dailyEndTime && { daily_end_time: booking.dailyEndTime }),
    // 按周预订字段
    ...(booking.longTermType && { long_term_type: booking.longTermType }),
    ...(booking.selectedWeekDays && { selected_week_days: booking.selectedWeekDays }),
    ...(booking.weekCount && { week_count: booking.weekCount }),
    // 主从记录字段
    ...(booking.isMaster !== undefined && { is_master: booking.isMaster }),
    ...(booking.masterId && { master_id: booking.masterId }),
  };
}

// 角色数据转换
function transformRoleFromDB(dbRole: any): RoleDefinition {
  return {
    id: dbRole.id,
    name: dbRole.name,
    description: dbRole.description,
    color: dbRole.color,
  };
}

function transformRoleToDB(role: Partial<RoleDefinition>): any {
  return {
    ...(role.name && { name: role.name }),
    ...(role.description && { description: role.description }),
    ...(role.color && { color: role.color }),
  };
}

// 部门数据转换
function transformDepartmentFromDB(dbDepartment: any): Department {
  return {
    id: dbDepartment.id,
    name: dbDepartment.name,
    parentId: dbDepartment.parent_id,
  };
}

function transformDepartmentToDB(department: Partial<Department>): any {
  return {
    ...(department.name && { name: department.name }),
    ...(department.parentId !== undefined && { parent_id: department.parentId }),
  };
}

// 工作流数据转换
function transformWorkflowFromDB(dbWorkflow: any): ApprovalNode {
  return {
    id: dbWorkflow.id,
    name: dbWorkflow.name,
    approverRole: dbWorkflow.approver_role,
  };
}

// ==================== 实时订阅 ====================

export function subscribeToBookings(callback: (bookings: Booking[]) => void) {
  return supabase
    .channel('bookings_changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: TABLES.BOOKINGS }, async () => {
      const bookings = await getBookings();
      callback(bookings);
    })
    .subscribe();
}

export function subscribeToResources(callback: (resources: Resource[]) => void) {
  return supabase
    .channel('resources_changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: TABLES.RESOURCES }, async () => {
      const resources = await getResources();
      callback(resources);
    })
    .subscribe();
}

// ==================== 批量操作 ====================

export async function batchImportUsers(users: Omit<User, 'id'>[]): Promise<void> {
  const dbUsers = users.map(user => ({
    name: user.name,
    email: user.email,
    role: user.role,
    department: user.department,
    landline: user.landline,
    mobile: user.mobile,
  }));
  
  const { error } = await supabase
    .from(TABLES.USERS)
    .insert(dbUsers);
  
  if (error) {
    console.error('批量导入用户失败:', error);
    throw error;
  }
}

export async function batchImportResources(resources: Omit<Resource, 'id'>[]): Promise<void> {
  const dbResources = resources.map(resource => ({
    name: resource.name,
    type: resource.type,
    capacity: resource.capacity,
    location: resource.location,
    features: resource.features,
    status: resource.status,
  }));
  
  const { error } = await supabase
    .from(TABLES.RESOURCES)
    .insert(dbResources);
  
  if (error) {
    console.error('批量导入资源失败:', error);
    throw error;
  }
}

export async function batchImportDepartments(departments: Omit<Department, 'id'>[]): Promise<void> {
  const dbDepartments = departments.map(dept => ({
    name: dept.name,
    parent_id: dept.parentId,
  }));
  
  const { error } = await supabase
    .from(TABLES.DEPARTMENTS)
    .insert(dbDepartments);
  
  if (error) {
    console.error('批量导入部门失败:', error);
    throw error;
  }
}

// ==================== 导出所有数据 ====================

export async function exportAllData() {
  const [users, resources, bookings, roles, departments, workflow] = await Promise.all([
    getUsers(),
    getResources(),
    getBookings(),
    getRoles(),
    getDepartments(),
    getWorkflow(),
  ]);
  
  return {
    users,
    resources,
    bookings,
    roles,
    departments,
    workflow,
  };
}

// ==================== 恢复所有数据 ====================

export async function restoreAllData(data: {
  users: User[];
  resources: Resource[];
  bookings: Booking[];
  roles: RoleDefinition[];
  departments: Department[];
  workflow: ApprovalNode[];
}): Promise<void> {
  // 清空所有表
  await Promise.all([
    supabase.from(TABLES.BOOKINGS).delete().neq('id', ''),
    supabase.from(TABLES.RESOURCES).delete().neq('id', ''),
    supabase.from(TABLES.USERS).delete().neq('id', ''),
    supabase.from(TABLES.DEPARTMENTS).delete().neq('id', ''),
    supabase.from(TABLES.ROLES).delete().neq('id', ''),
  ]);
  
  // 插入数据
  await Promise.all([
    data.roles.length > 0 ? supabase.from(TABLES.ROLES).insert(data.roles.map(r => ({ id: r.id, name: r.name, description: r.description, color: r.color }))) : Promise.resolve(),
    data.departments.length > 0 ? supabase.from(TABLES.DEPARTMENTS).insert(data.departments.map(d => ({ id: d.id, name: d.name, parent_id: d.parentId }))) : Promise.resolve(),
    data.users.length > 0 ? supabase.from(TABLES.USERS).insert(data.users.map(transformUserToDB)) : Promise.resolve(),
    data.resources.length > 0 ? supabase.from(TABLES.RESOURCES).insert(data.resources.map(transformResourceToDB)) : Promise.resolve(),
    data.bookings.length > 0 ? supabase.from(TABLES.BOOKINGS).insert(data.bookings.map(transformBookingToDB)) : Promise.resolve(),
  ]);
  
  // 更新工作流
  if (data.workflow.length > 0) {
    await updateWorkflow(data.workflow);
  }
}
