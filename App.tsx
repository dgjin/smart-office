// ... existing imports
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Users, MapPin, Calendar, CheckCircle, XCircle, LayoutDashboard, Plus, LogOut, 
  Cpu, Monitor, Coffee, Edit2, Trash2, UserPlus, RefreshCw,
  Clock, GitMerge, ChevronRight, ArrowRight, ChevronDown, ChevronUp,
  Zap, ShieldCheck, Check, X, Building2, 
  PieChart, ChevronLeft, Timer, Briefcase, Shield, FolderTree,
  UserCircle, AlertTriangle, Download, Upload, Database,
  Info, MoreHorizontal, Activity, ArrowRightCircle, MessageSquare, Send,
  CalendarDays, History, Square, CheckSquare, Search, FileText, FileUp,
  Lock, Smartphone, Mail, Key, Minus, Layers, PlayCircle, QrCode, Eye, Lightbulb, Bell, Filter,
  Save, RotateCcw
} from 'lucide-react';
import { User, Resource, Booking, Role, BookingStatus, ResourceType, ApprovalNode, Department, RoleDefinition, ResourceStatus, Notification } from './types';
import { INITIAL_USERS, INITIAL_RESOURCES, INITIAL_BOOKINGS, DEFAULT_WORKFLOW, INITIAL_DEPARTMENTS, INITIAL_ROLES } from './constants';
import { getSmartRecommendation } from './services/geminiService';

const STORAGE_KEY = 'SMART_OFFICE_DATA_V27';
const THEME_KEY = 'SMART_OFFICE_THEME';

// --- Theme Config ---
const THEMES = [
  { id: 'indigo', name: '商务蓝', color: 'bg-indigo-600', text: 'text-indigo-600', border: 'border-indigo-100', bg: 'bg-indigo-50' },
  { id: 'emerald', name: '翡翠绿', color: 'bg-emerald-600', text: 'text-emerald-600', border: 'border-emerald-100', bg: 'bg-emerald-50' },
  { id: 'orange', name: '活力橙', color: 'bg-orange-600', text: 'text-orange-600', border: 'border-orange-100', bg: 'bg-orange-50' },
  { id: 'rose', name: '胭脂红', color: 'bg-rose-600', text: 'text-rose-600', border: 'border-rose-100', bg: 'bg-rose-50' },
  { id: 'purple', name: '极光紫', color: 'bg-purple-600', text: 'text-purple-600', border: 'border-purple-100', bg: 'bg-purple-50' },
];

// --- Helper Functions ---

const formatTime = (date: Date) => {
  return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
};

const formatDate = (date: Date) => {
  return date.toISOString().split('T')[0];
};

const findNextAvailableSlot = (resourceId: string, bookings: Booking[], durationMinutes: number) => {
  let pointer = new Date();
  pointer.setMinutes(Math.ceil(pointer.getMinutes() / 30) * 30, 0, 0); 
  
  const todayEnd = new Date(pointer);
  todayEnd.setHours(21, 0, 0, 0); 

  while (pointer < todayEnd) {
    const end = new Date(pointer.getTime() + durationMinutes * 60000);
    const hasConflict = bookings.some(b => {
      if (b.resourceId !== resourceId || b.status === 'REJECTED' || b.status === 'CANCELLED') return false;
      const bStart = new Date(b.startTime);
      const bEnd = new Date(b.endTime);
      return (pointer < bEnd && end > bStart);
    });

    if (!hasConflict) {
      return { start: new Date(pointer), end };
    }
    pointer = new Date(pointer.getTime() + 30 * 60000); 
  }
  
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  return { start: tomorrow, end: new Date(tomorrow.getTime() + durationMinutes * 60000) };
};

// --- Sub-components ---

const StatusBadge = ({ status, theme }: { status: string, theme: string }) => {
  const styles: any = { 
    AVAILABLE: 'bg-emerald-50 text-emerald-600 border-emerald-100', 
    PENDING: 'bg-amber-50 text-amber-600 border-amber-100', 
    OCCUPIED: 'bg-rose-50 text-rose-600 border-rose-100', 
    APPROVED: `bg-${theme}-50 text-${theme}-600 border-${theme}-100`, 
    REJECTED: 'bg-rose-50 text-rose-600 border-rose-100', 
    COMPLETED: 'bg-gray-100 text-gray-400 border-gray-200',
    MAINTENANCE: 'bg-gray-50 text-gray-500 border-gray-200'
  };
  const labels: any = { AVAILABLE: '空闲', PENDING: '审批中', APPROVED: '已通过', REJECTED: '驳回', OCCUPIED: '占用', COMPLETED: '结束', MAINTENANCE: '维护中' };
  return <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold border ${styles[status] || styles.PENDING}`}>{labels[status] || status}</span>;
};

const RoleTag = ({ roleId, roles, theme }: any) => {
  const role = roles.find((r: any) => r.id === roleId);
  if (!role) return <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-gray-100 text-gray-400">未知</span>;
  return <span className={`px-2 py-0.5 rounded text-[9px] font-bold bg-${role.color}-100 text-${role.color}-700 border border-${role.color}-200`}>{role.name}</span>;
};

const SidebarItem = ({ icon: Icon, label, id, active, onClick, theme, badge }: any) => (
  <button onClick={() => onClick(id)} className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all ${active ? `bg-${theme}-600 text-white shadow-lg` : `text-gray-500 hover:bg-${theme}-50 hover:text-${theme}-600`}`}>
    <div className="flex items-center space-x-3">
      <Icon size={18} /> 
      <span className="text-sm font-medium">{label}</span>
    </div>
    {badge > 0 && <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${active ? 'bg-white text-indigo-600' : 'bg-rose-500 text-white'}`}>{badge}</span>}
  </button>
);

const StatCard = ({ title, value, icon: Icon, trend, color, onClick }: any) => (
  <button onClick={onClick} className="bg-white p-6 rounded-[2rem] border border-gray-100 shadow-sm flex items-center justify-between group hover:border-gray-200 transition-all text-left">
    <div className="space-y-1">
      <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{title}</p>
      <h3 className="text-2xl font-black text-gray-800">{value}</h3>
      {trend && <p className={`text-[10px] font-bold ${trend.startsWith('+') ? 'text-emerald-500' : 'text-rose-500'}`}>{trend} <span className="text-gray-300">较上周</span></p>}
    </div>
    <div className={`w-12 h-12 rounded-2xl bg-${color}-50 flex items-center justify-center text-${color}-600 group-hover:scale-110 transition-transform`}>
      <Icon size={24} />
    </div>
  </button>
);

const QRScannerModal = ({ theme, onClose, onScanSuccess }: any) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    const startCamera = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (err) {
        setError("无法访问摄像头，请检查权限设置。");
      }
    };
    startCamera();
    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const simulateScan = () => {
    onScanSuccess("Check-in successful!");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[300] bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-white rounded-[3rem] w-full max-w-md p-8 shadow-2xl animate-in zoom-in overflow-hidden relative">
        <button onClick={onClose} className="absolute top-6 right-6 p-2 bg-gray-100 rounded-xl text-gray-400 hover:text-rose-500 z-10"><X size={20}/></button>
        <div className="text-center mb-6">
          <h3 className="text-xl font-black text-gray-800">扫码签到</h3>
          <p className="text-xs text-gray-400 font-medium mt-1">请将二维码置于框内</p>
        </div>
        
        <div className="relative aspect-square bg-gray-900 rounded-[2.5rem] overflow-hidden mb-6 border-4 border-gray-100 shadow-inner flex items-center justify-center">
          {error ? (
            <div className="p-8 text-center text-white space-y-4">
              <AlertTriangle size={48} className="mx-auto text-amber-500" />
              <p className="text-sm font-bold">{error}</p>
            </div>
          ) : (
            <>
              <video ref={videoRef} autoPlay playsInline className="absolute inset-0 w-full h-full object-cover" />
              <div className="absolute inset-0 border-[40px] border-black/40"></div>
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 border-2 border-emerald-500 rounded-3xl animate-pulse">
                <div className="absolute top-0 left-0 w-4 h-4 border-t-4 border-l-4 border-white rounded-tl-lg"></div>
                <div className="absolute top-0 right-0 w-4 h-4 border-t-4 border-r-4 border-white rounded-tr-lg"></div>
                <div className="absolute bottom-0 left-0 w-4 h-4 border-b-4 border-l-4 border-white rounded-bl-lg"></div>
                <div className="absolute bottom-0 right-0 w-4 h-4 border-b-4 border-r-4 border-white rounded-br-lg"></div>
                <div className={`absolute left-0 right-0 top-0 h-0.5 bg-${theme}-500 shadow-[0_0_15px_rgba(16,185,129,0.8)] animate-scan`}></div>
              </div>
            </>
          )}
        </div>

        <button 
          onClick={simulateScan}
          className={`w-full py-4 bg-${theme}-600 text-white font-black rounded-2xl shadow-xl hover:scale-105 transition-all flex items-center justify-center space-x-2`}
        >
          <QrCode size={18}/> <span>模拟扫描成功</span>
        </button>
      </div>
      <style>{`
        @keyframes scan {
          0% { top: 0%; }
          100% { top: 100%; }
        }
        .animate-scan {
          animation: scan 2s linear infinite;
        }
      `}</style>
    </div>
  );
};

const LoginView = ({ users, onLogin, theme }: any) => {
  return (
    <div className={`min-h-screen bg-gray-50 flex items-center justify-center p-4`}>
      <div className="max-w-md w-full bg-white rounded-[2.5rem] shadow-xl p-10 border border-gray-100">
        <div className="text-center mb-10">
          <div className={`w-16 h-16 bg-${theme}-600 rounded-2xl mx-auto flex items-center justify-center text-white shadow-lg mb-6`}>
            <Cpu size={32} />
          </div>
          <h1 className="text-3xl font-black text-gray-800 tracking-tight">SmartOffice</h1>
          <p className="text-gray-400 font-medium mt-2">请选择演示账号登录</p>
        </div>
        <div className="space-y-3">
          {users.map((u: any) => (
            <button key={u.id} onClick={() => onLogin(u)} className="w-full p-4 flex items-center space-x-4 rounded-2xl border border-gray-100 hover:border-indigo-200 hover:bg-indigo-50 transition-all group text-left">
              <div className={`w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center font-black text-gray-400 group-hover:bg-indigo-200 group-hover:text-indigo-600 transition-colors`}>{u.name[0]}</div>
              <div>
                <h4 className="font-bold text-gray-800">{u.name}</h4>
                <p className="text-xs text-gray-400">{u.role.join(', ')}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

const TodayResourceUsage = ({ resources, bookings, theme }: any) => {
  const hours = Array.from({ length: 13 }, (_, i) => i + 8); // 8:00 - 20:00
  return (
    <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100 overflow-x-auto">
      <h3 className="font-black text-lg mb-6">今日资源占用概览</h3>
      <div className="min-w-[600px]">
        <div className="flex mb-4">
          <div className="w-24 shrink-0"></div>
          <div className="flex-1 flex justify-between text-xs text-gray-400 font-bold uppercase">
            {hours.map(h => <div key={h} className="flex-1 text-center">{h}:00</div>)}
          </div>
        </div>
        <div className="space-y-3">
          {resources.slice(0, 5).map((r: any) => (
            <div key={r.id} className="flex items-center">
              <div className="w-24 shrink-0 text-xs font-bold text-gray-600 truncate pr-4">{r.name}</div>
              <div className="flex-1 h-8 bg-gray-50 rounded-lg relative overflow-hidden">
                {bookings.filter((b: any) => b.resourceId === r.id && b.status === 'APPROVED' && new Date(b.startTime).toDateString() === new Date().toDateString()).map((b: any) => {
                  const start = new Date(b.startTime);
                  const end = new Date(b.endTime);
                  const startHour = start.getHours() + start.getMinutes() / 60;
                  const endHour = end.getHours() + end.getMinutes() / 60;
                  const left = ((startHour - 8) / 13) * 100;
                  const width = ((endHour - startHour) / 13) * 100;
                  return (
                    <div key={b.id} className={`absolute top-1 bottom-1 bg-${theme}-400 rounded-md opacity-80`} style={{ left: `${left}%`, width: `${width}%` }} title={b.purpose}></div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const MonthlyUsageGrid = ({ resources, bookings, onDayClick, theme }: any) => {
  const days = Array.from({ length: 30 }, (_, i) => new Date(Date.now() + i * 86400000));

  return (
    <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100 flex flex-col">
      <h3 className="font-black text-lg mb-4">未来30天热度 (资源 x 日期)</h3>
      <div className="overflow-x-auto custom-scrollbar pb-2">
        <table className="border-collapse w-full min-w-[800px]">
          <thead>
            <tr>
              <th className="sticky left-0 z-20 bg-white p-3 text-left text-xs font-black text-gray-400 uppercase tracking-widest border-b border-gray-100 min-w-[140px]">资源名称</th>
              {days.map((d, i) => {
                const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                return (
                  <th key={i} className={`p-2 text-[10px] font-bold text-gray-400 border-b border-gray-100 min-w-[40px] text-center ${isWeekend ? 'bg-gray-50/50 text-gray-300' : ''}`}>
                    {d.getMonth() + 1}/{d.getDate()}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {resources.map((r: any) => (
              <tr key={r.id} className="group hover:bg-gray-50/30 transition-colors">
                <td className="sticky left-0 z-10 bg-white group-hover:bg-gray-50/30 p-3 text-xs font-bold text-gray-700 border-b border-gray-50 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)] truncate max-w-[140px]" title={r.name}>
                  <div className="flex items-center space-x-2">
                    <span className={`w-2 h-2 rounded-full ${r.type === 'ROOM' ? 'bg-indigo-400' : 'bg-emerald-400'}`}></span>
                    <span className="truncate">{r.name}</span>
                  </div>
                </td>
                {days.map((d, i) => {
                  const dateStr = d.toISOString().split('T')[0];
                  const bookingCount = bookings.filter((b: any) => 
                    b.resourceId === r.id && 
                    b.status === 'APPROVED' && 
                    b.startTime.startsWith(dateStr)
                  ).length;
                  const isWeekend = d.getDay() === 0 || d.getDay() === 6;

                  return (
                    <td key={i} className={`p-1 border-b border-gray-50 text-center ${isWeekend ? 'bg-gray-50/30' : ''}`}>
                      <button 
                        onClick={() => onDayClick(r.id, d)}
                        className={`w-full h-8 rounded-lg transition-all hover:scale-110 flex items-center justify-center ${bookingCount > 0 ? `bg-${theme}-500 shadow-sm` : 'hover:bg-gray-100'}`}
                        title={bookingCount > 0 ? `${bookingCount} 项预订` : '空闲'}
                      >
                        {bookingCount > 0 && (
                          <span className="text-[9px] font-bold text-white">{bookingCount}</span>
                        )}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex items-center space-x-4 text-[10px] text-gray-400 font-bold justify-end">
        <div className="flex items-center space-x-1"><span className={`w-3 h-3 rounded bg-${theme}-500`}></span><span>已预订</span></div>
        <div className="flex items-center space-x-1"><span className="w-3 h-3 rounded bg-gray-100"></span><span>空闲</span></div>
        <div className="flex items-center space-x-1"><span className="w-3 h-3 rounded border border-gray-200 bg-gray-50"></span><span>周末</span></div>
      </div>
    </div>
  );
};

const WorkflowStepper = ({ booking, workflow, theme }: any) => {
  return (
    <div className="flex items-center justify-between relative mt-4">
      <div className="absolute left-0 right-0 top-1/2 h-0.5 bg-gray-100 -z-10"></div>
      {workflow.map((node: any, idx: number) => {
        const isPassed = booking.currentNodeIndex > idx || (booking.currentNodeIndex === idx && booking.status === 'APPROVED');
        const isCurrent = booking.currentNodeIndex === idx && booking.status === 'PENDING';
        return (
          <div key={node.id} className="flex flex-col items-center bg-white px-2">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold border-2 ${isPassed ? `bg-${theme}-600 border-${theme}-600 text-white` : isCurrent ? `bg-white border-${theme}-600 text-${theme}-600` : 'bg-gray-50 border-gray-200 text-gray-300'}`}>
              {isPassed ? <Check size={12}/> : idx + 1}
            </div>
            <span className={`text-[9px] mt-1 font-bold ${isCurrent ? `text-${theme}-600` : 'text-gray-400'}`}>{node.name}</span>
          </div>
        );
      })}
    </div>
  );
};

const ApprovalTaskCard = ({ booking, workflow, users, resources, theme, onApprove, onReject }: any) => {
  const user = users.find((u: any) => u.id === booking.userId);
  const resource = resources.find((r: any) => r.id === booking.resourceId);
  return (
    <div className="bg-white p-6 rounded-[2rem] border border-gray-100 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6">
      <div className="flex items-center space-x-4">
        <div className={`w-12 h-12 rounded-2xl bg-${theme}-50 flex items-center justify-center text-${theme}-600 font-bold text-xs`}>{user?.name[0]}</div>
        <div>
           <h4 className="font-bold text-gray-800 text-lg">{user?.name} 申请 {resource?.name}</h4>
           <p className="text-xs text-gray-400 font-medium">{booking.startTime.replace('T', ' ')} 至 {booking.endTime.replace('T', ' ')} · {booking.purpose}</p>
        </div>
      </div>
      <div className="flex space-x-3">
        <button onClick={() => onReject('不符合规定')} className="px-6 py-2.5 rounded-xl border border-gray-200 text-gray-500 font-bold text-xs hover:bg-gray-50 transition-colors">驳回</button>
        <button onClick={onApprove} className={`px-6 py-2.5 rounded-xl bg-${theme}-600 text-white font-bold text-xs shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all`}>通过审批</button>
      </div>
    </div>
  );
};

const DayBookingDetailModal = ({ detail, onClose, users, resources, theme }: any) => (
  <div className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-4">
    <div className="bg-white rounded-3xl p-8 max-w-md w-full relative animate-in zoom-in">
      <button onClick={onClose} className="absolute top-4 right-4 p-2 bg-gray-100 rounded-full text-gray-400 hover:text-gray-600"><X size={20}/></button>
      <h3 className="font-black text-xl mb-1 text-gray-800">{formatDate(detail.date)}</h3>
      <p className="text-xs text-gray-400 font-bold uppercase tracking-widest mb-6">{detail.resource.name}</p>
      
      <div className="space-y-3 max-h-[60vh] overflow-y-auto custom-scrollbar pr-1">
         {detail.bookings.length === 0 ? (
           <div className="py-12 text-center border-2 border-dashed border-gray-100 rounded-2xl">
             <p className="text-gray-400 text-sm font-bold">该日暂无预订记录</p>
           </div>
         ) : (
           detail.bookings.map((b: any) => {
             const user = users.find((u: any) => u.id === b.userId);
             const resource = resources ? resources.find((r: any) => r.id === b.resourceId) : null;
             return (
               <div key={b.id} className="p-4 bg-gray-50 rounded-2xl border border-gray-100 hover:border-indigo-100 transition-all">
                 <div className="flex justify-between items-start mb-2">
                   <div>
                     <p className={`text-xs font-black text-${theme}-600 mb-0.5`}>{b.startTime.split('T')[1].slice(0,5)} - {b.endTime.split('T')[1].slice(0,5)}</p>
                     {resource && <p className="text-[10px] text-gray-400 font-bold uppercase">{resource.name}</p>}
                   </div>
                   <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${b.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'}`}>
                     {b.status === 'APPROVED' ? '已核准' : '待审批'}
                   </span>
                 </div>
                 <div className="flex items-center space-x-3 mt-3 pt-3 border-t border-gray-200/50">
                   <div className={`w-8 h-8 rounded-full bg-white flex items-center justify-center text-[10px] font-bold text-gray-600 shadow-sm`}>
                     {user?.name?.[0]}
                   </div>
                   <div>
                     <p className="text-xs font-bold text-gray-800">{user?.name} <span className="text-gray-400 font-medium">· {user?.department}</span></p>
                     <p className="text-[10px] text-gray-500 mt-0.5">{b.purpose}</p>
                   </div>
                 </div>
               </div>
             );
           })
         )}
      </div>
    </div>
  </div>
);

const BatchImportModal = ({ type, onClose, onImport, theme, existingDepartments = [], roles = [] }: any) => {
  const [text, setText] = useState('');
  
  const getTemplate = () => {
    if (type === 'USERS') return "姓名,邮箱,部门,角色(可选)\n张三,zhangsan@company.com,市场部,正式员工";
    if (type === 'RESOURCES') return "资源名称,类型(会议室/工位),容量,位置\nGamma 演示厅,会议室,20,2号楼";
    if (type === 'DEPARTMENTS') return "部门名称,上级部门名称(可选)\n华北区,\n北京分公司,华北区";
    return "";
  };

  const handleDownloadTemplate = () => {
    const template = getTemplate();
    const blob = new Blob([template], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `template_${type.toLowerCase()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const processData = () => {
    try {
      // Try JSON first
      const trimmed = text.trim();
      if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
         onImport(JSON.parse(trimmed));
         return;
      }

      // Try CSV
      const lines = trimmed.split('\n');
      const data = [];
      
      if (type === 'DEPARTMENTS') {
         // Special logic for departments to resolve IDs
         const deptMap = new Map();
         existingDepartments.forEach((d: any) => deptMap.set(d.name, d.id));
         
         // Skip header if present (simple check: first line contains '部门名称' or 'name' or Chinese comma)
         const startIndex = (lines[0].includes('部门名称') || lines[0].includes('name')) ? 1 : 0;
         
         for (let i = startIndex; i < lines.length; i++) {
            // Split by comma, handling both Chinese and English commas
            const parts = lines[i].split(/,|，/);
            const name = parts[0]?.trim();
            const parentName = parts[1]?.trim();
            
            if (!name) continue;
            
            const newId = `dpt-imp-${Date.now()}-${i}`;
            const parentId = parentName ? deptMap.get(parentName) : undefined;
            
            // Check if department already exists to prevent duplicates (optional, but good for import)
            if (deptMap.has(name)) {
                // If exists, skip or maybe update? For simplicity, skip.
                continue;
            }

            const newDept = { id: newId, name, parentId };
            data.push(newDept);
            deptMap.set(name, newId); // Add to map for subsequent rows to reference
         }
      } else if (type === 'USERS') {
         const startIndex = (lines[0].includes('姓名') || lines[0].includes('name')) ? 1 : 0;
         for (let i = startIndex; i < lines.length; i++) {
            const parts = lines[i].split(/,|，/);
            const name = parts[0]?.trim();
            const email = parts[1]?.trim();
            const department = parts[2]?.trim();
            const roleName = parts[3]?.trim();

            if (!name) continue;
            
            // Resolve Role
            let roleIds = ['EMPLOYEE'];
            if (roleName) {
               const foundRole = roles.find((r: any) => r.name === roleName);
               if (foundRole) roleIds = [foundRole.id];
            }
            
            data.push({
               id: `u-imp-${Date.now()}-${i}`,
               name,
               email: email || `${name}@company.com`, // Default email generator
               department: department || '待分配',
               role: roleIds
            });
         }
      } else if (type === 'RESOURCES') {
         const startIndex = (lines[0].includes('资源名称') || lines[0].includes('name')) ? 1 : 0;
         for (let i = startIndex; i < lines.length; i++) {
            const parts = lines[i].split(/,|，/);
            const name = parts[0]?.trim();
            const typeStr = parts[1]?.trim();
            const capacity = parts[2]?.trim();
            const location = parts[3]?.trim();

            if (!name) continue;
            
            data.push({
               id: `r-imp-${Date.now()}-${i}`,
               name,
               type: (typeStr === '会议室' || typeStr === 'ROOM') ? 'ROOM' : 'DESK',
               capacity: parseInt(capacity) || 4,
               location: location || '未标注',
               status: 'AVAILABLE',
               features: []
            });
         }
      }
      
      if (data.length > 0) {
         onImport(data);
      } else {
         alert("未解析到有效数据，请检查格式。");
      }

    } catch (e) {
      alert('数据解析失败，请检查格式。');
      console.error(e);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-[2rem] p-8 max-w-lg w-full shadow-2xl animate-in zoom-in">
        <div className="flex justify-between items-center mb-6">
           <h3 className="font-black text-xl text-gray-800">批量导入 {type === 'USERS' ? '成员' : (type === 'RESOURCES' ? '资源' : '部门')}</h3>
           <button onClick={handleDownloadTemplate} className={`text-xs font-bold text-${theme}-600 bg-${theme}-50 px-3 py-1.5 rounded-lg hover:bg-${theme}-100 transition-colors flex items-center space-x-1`}>
             <Download size={14}/> <span>下载模板</span>
           </button>
        </div>
        
        <div className="mb-4">
           <p className="text-xs text-gray-400 mb-2 font-bold">请粘贴 CSV 文本或 JSON 数据：</p>
           <textarea 
             className="w-full h-64 border border-gray-200 rounded-2xl p-4 text-xs font-mono mb-2 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none transition-all bg-gray-50/50" 
             placeholder={getTemplate()} 
             value={text} 
             onChange={e => setText(e.target.value)}
           ></textarea>
           <p className="text-[10px] text-gray-400">支持中文逗号(，)与英文逗号(,)分隔。第一行如果是表头将被自动跳过。</p>
        </div>

        <div className="flex space-x-3">
          <button onClick={onClose} className="flex-1 py-3 rounded-xl bg-gray-100 font-bold text-gray-500 hover:bg-gray-200 transition-colors">取消</button>
          <button onClick={processData} className={`flex-1 py-3 rounded-xl bg-${theme}-600 text-white font-bold shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all`}>确认导入</button>
        </div>
      </div>
    </div>
  );
};

const DepartmentNode = ({ dept, allDepts, level = 0, onEdit, onDelete, onAddSub, theme }: any) => {
  const children = allDepts.filter((d: any) => d.parentId === dept.id);
  
  return (
    <div className="space-y-1">
       <div className={`group flex items-center justify-between p-3 rounded-xl transition-all ${level === 0 ? 'bg-gray-50 border border-gray-100' : 'hover:bg-gray-50 border border-transparent hover:border-gray-100'}`} style={{ marginLeft: `${level * 24}px` }}>
          <div className="flex items-center space-x-3">
             {level === 0 ? (
                <div className={`p-1.5 rounded-lg bg-${theme}-100 text-${theme}-700`}><FolderTree size={16} /></div>
             ) : (
                <div className="flex items-center justify-center w-6 h-6"><div className="w-1.5 h-1.5 rounded-full bg-gray-300"></div></div>
             )}
             <span className={`font-bold ${level === 0 ? 'text-gray-800 text-sm' : 'text-gray-600 text-xs'}`}>{dept.name}</span>
             {level === 0 && <span className="px-2 py-0.5 bg-gray-100 text-gray-400 text-[9px] rounded-md font-bold uppercase">一级</span>}
          </div>
          <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-all">
             <button onClick={() => onAddSub(dept.id)} className={`p-1.5 text-${theme}-600 hover:bg-${theme}-50 rounded-lg transition-colors`} title="添加子部门"><Plus size={14}/></button>
             <button onClick={() => onEdit(dept)} className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors" title="编辑"><Edit2 size={14}/></button>
             <button onClick={() => onDelete(dept.id)} className="p-1.5 text-gray-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors" title="删除"><Trash2 size={14}/></button>
          </div>
       </div>
       {children.map((child: any) => (
          <DepartmentNode key={child.id} dept={child} allDepts={allDepts} level={level + 1} onEdit={onEdit} onDelete={onDelete} onAddSub={onAddSub} theme={theme} />
       ))}
    </div>
  );
};

const DepartmentModal = ({ department, parentId, onClose, onSave, theme }: any) => {
  const [name, setName] = useState(department?.name || '');
  return (
    <div className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-[2rem] p-8 max-w-sm w-full shadow-2xl animate-in zoom-in">
        <h3 className="font-black text-xl mb-6 text-gray-800">
          {department ? '编辑部门' : (parentId ? '添加子部门' : '新建一级部门')}
        </h3>
        <div className="space-y-4">
          <div>
             <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1 block">部门名称</label>
             <input 
                className="w-full p-4 bg-gray-50 rounded-2xl border-2 border-transparent focus:border-indigo-100 focus:bg-white outline-none font-bold text-gray-800 transition-all" 
                placeholder="请输入名称..." 
                value={name} 
                onChange={e => setName(e.target.value)} 
                autoFocus
             />
          </div>
        </div>
        <div className="flex space-x-3 mt-8">
          <button onClick={onClose} className="flex-1 py-3 rounded-xl bg-gray-100 font-bold text-gray-500 hover:bg-gray-200 transition-colors">取消</button>
          <button 
            onClick={() => { if(name.trim()) onSave({ name, parentId: department ? department.parentId : parentId }); }} 
            className={`flex-1 py-3 rounded-xl bg-${theme}-600 text-white font-bold shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all`}
            disabled={!name.trim()}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
};

const ResourceCalendarModal = ({ resource, onClose }: any) => (
  <div className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-4">
    <div className="bg-white rounded-3xl p-8 max-w-lg w-full h-[500px] flex flex-col">
       <div className="flex justify-between items-center mb-4">
          <h3 className="font-bold text-xl">{resource.name} 日历视图</h3>
          <button onClick={onClose}><X size={20}/></button>
       </div>
       <div className="flex-1 bg-gray-50 rounded-2xl flex items-center justify-center text-gray-400 font-bold">
         日历组件开发中...
       </div>
    </div>
  </div>
);

const UserModal = ({ user, onClose, onSave, theme }: any) => {
  const [formData, setFormData] = useState(user || { name: '', email: '', role: [], department: '' });
  return (
    <div className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl p-8 max-w-md w-full">
        <h3 className="font-bold text-xl mb-6">{user ? '编辑成员' : '新增成员'}</h3>
        <div className="space-y-4">
          <input className="w-full p-3 bg-gray-50 rounded-xl border border-transparent focus:border-indigo-100 outline-none" placeholder="姓名" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
          <input className="w-full p-3 bg-gray-50 rounded-xl border border-transparent focus:border-indigo-100 outline-none" placeholder="邮箱" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} />
          <input className="w-full p-3 bg-gray-50 rounded-xl border border-transparent focus:border-indigo-100 outline-none" placeholder="部门" value={formData.department} onChange={e => setFormData({...formData, department: e.target.value})} />
        </div>
        <div className="flex space-x-3 mt-8">
          <button onClick={onClose} className="flex-1 py-3 rounded-xl bg-gray-100 font-bold text-gray-500">取消</button>
          <button onClick={() => onSave(formData)} className={`flex-1 py-3 rounded-xl bg-${theme}-600 text-white font-bold`}>保存</button>
        </div>
      </div>
    </div>
  );
};

const ResourceModal = ({ resource, onClose, onSave, theme }: any) => {
  const [formData, setFormData] = useState(resource || { name: '', type: 'ROOM', capacity: 4, location: '' });
  return (
    <div className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl p-8 max-w-md w-full">
        <h3 className="font-bold text-xl mb-6">{resource ? '编辑资源' : '新增资源'}</h3>
        <div className="space-y-4">
          <input className="w-full p-3 bg-gray-50 rounded-xl border border-transparent outline-none" placeholder="资源名称" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
          <div className="flex space-x-4">
            <select className="flex-1 p-3 bg-gray-50 rounded-xl outline-none" value={formData.type} onChange={e => setFormData({...formData, type: e.target.value})}>
              <option value="ROOM">会议室</option>
              <option value="DESK">工位</option>
            </select>
            <input type="number" className="w-24 p-3 bg-gray-50 rounded-xl outline-none" placeholder="容量" value={formData.capacity} onChange={e => setFormData({...formData, capacity: parseInt(e.target.value)})} />
          </div>
          <input className="w-full p-3 bg-gray-50 rounded-xl border border-transparent outline-none" placeholder="位置" value={formData.location} onChange={e => setFormData({...formData, location: e.target.value})} />
        </div>
        <div className="flex space-x-3 mt-8">
          <button onClick={onClose} className="flex-1 py-3 rounded-xl bg-gray-100 font-bold text-gray-500">取消</button>
          <button onClick={() => onSave(formData)} className={`flex-1 py-3 rounded-xl bg-${theme}-600 text-white font-bold`}>保存</button>
        </div>
      </div>
    </div>
  );
};

const RoleModal = ({ role, onClose, onSave, theme }: any) => {
  const [formData, setFormData] = useState(role || { id: '', name: '', description: '', color: 'indigo' });
  return (
    <div className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl p-8 max-w-md w-full">
        <h3 className="font-bold text-xl mb-6">{role ? '编辑角色' : '新增角色'}</h3>
        <div className="space-y-4">
          <input className="w-full p-3 bg-gray-50 rounded-xl outline-none" placeholder="角色ID" value={formData.id} onChange={e => setFormData({...formData, id: e.target.value})} disabled={!!role} />
          <input className="w-full p-3 bg-gray-50 rounded-xl outline-none" placeholder="角色名称" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
          <textarea className="w-full p-3 bg-gray-50 rounded-xl outline-none h-24" placeholder="描述" value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} />
        </div>
        <div className="flex space-x-3 mt-8">
          <button onClick={onClose} className="flex-1 py-3 rounded-xl bg-gray-100 font-bold text-gray-500">取消</button>
          <button onClick={() => onSave(formData)} className={`flex-1 py-3 rounded-xl bg-${theme}-600 text-white font-bold`}>保存</button>
        </div>
      </div>
    </div>
  );
};

const WorkflowModal = ({ node, roles, onClose, onSave, theme }: any) => {
  const [formData, setFormData] = useState(node || { name: '', approverRole: '' });
  return (
    <div className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl p-8 max-w-md w-full">
        <h3 className="font-bold text-xl mb-6">{node ? '编辑节点' : '新增节点'}</h3>
        <div className="space-y-4">
          <input className="w-full p-3 bg-gray-50 rounded-xl outline-none" placeholder="节点名称" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
          <select className="w-full p-3 bg-gray-50 rounded-xl outline-none" value={formData.approverRole} onChange={e => setFormData({...formData, approverRole: e.target.value})}>
            <option value="">选择审批角色</option>
            {roles.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
        <div className="flex space-x-3 mt-8">
          <button onClick={onClose} className="flex-1 py-3 rounded-xl bg-gray-100 font-bold text-gray-500">取消</button>
          <button onClick={() => onSave(formData)} className={`flex-1 py-3 rounded-xl bg-${theme}-600 text-white font-bold`}>保存</button>
        </div>
      </div>
    </div>
  );
};

const BookingFormModal = ({ resource, theme, initialDate, onClose, onConfirm, availableResources }: any) => {
  const [startTime, setStartTime] = useState(`${initialDate || new Date().toISOString().split('T')[0]}T09:00`);
  const [endTime, setEndTime] = useState(`${initialDate || new Date().toISOString().split('T')[0]}T10:00`);
  const [purpose, setPurpose] = useState('');
  const [aiSuggestion, setAiSuggestion] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSmartRecommend = async () => {
    setLoading(true);
    const suggestion = await getSmartRecommendation(purpose, 4, availableResources);
    setAiSuggestion(suggestion);
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl p-8 max-w-md w-full">
        <h3 className="font-bold text-xl mb-6">预约 {resource.name}</h3>
        <div className="space-y-4">
           <div>
             <label className="text-xs font-bold text-gray-400">开始时间</label>
             <input type="datetime-local" className="w-full p-3 bg-gray-50 rounded-xl outline-none" value={startTime} onChange={e => setStartTime(e.target.value)} />
           </div>
           <div>
             <label className="text-xs font-bold text-gray-400">结束时间</label>
             <input type="datetime-local" className="w-full p-3 bg-gray-50 rounded-xl outline-none" value={endTime} onChange={e => setEndTime(e.target.value)} />
           </div>
           <div>
             <label className="text-xs font-bold text-gray-400">用途</label>
             <div className="flex space-x-2">
               <input className="flex-1 p-3 bg-gray-50 rounded-xl outline-none" placeholder="会议/办公/面试..." value={purpose} onChange={e => setPurpose(e.target.value)} />
               <button onClick={handleSmartRecommend} className={`p-3 bg-${theme}-100 text-${theme}-600 rounded-xl font-bold`}>AI 建议</button>
             </div>
           </div>
           {loading && <div className="text-xs text-gray-400 animate-pulse">正在思考中...</div>}
           {aiSuggestion && (
             <div className={`p-3 rounded-xl bg-${theme}-50 text-${theme}-700 text-xs border border-${theme}-100`}>
               <strong>AI 建议：</strong> {aiSuggestion}
             </div>
           )}
        </div>
        <div className="flex space-x-3 mt-8">
          <button onClick={onClose} className="flex-1 py-3 rounded-xl bg-gray-100 font-bold text-gray-500">取消</button>
          <button onClick={() => onConfirm(resource.id, purpose, startTime, endTime)} className={`flex-1 py-3 rounded-xl bg-${theme}-600 text-white font-bold`}>确认预约</button>
        </div>
      </div>
    </div>
  );
};

// ... DetailViewModal and BookingConflictModal implementation (omitted for brevity but assumed present) ...
// (Retaining existing DetailViewModal and BookingConflictModal from previous step)
const DetailViewModal = ({ viewDetail, onClose, users, bookings, theme, roles }: any) => {
  const { type, data } = viewDetail;
  const relatedBookings = bookings.filter((b: any) => 
    type === 'USER' ? b.userId === data.id : b.resourceId === data.id
  ).sort((a: any, b: any) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());

  return (
    <div className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl p-8 max-w-md w-full relative animate-in zoom-in max-h-[80vh] overflow-y-auto">
        <button onClick={onClose} className="absolute top-4 right-4 p-2 bg-gray-100 rounded-full text-gray-400 hover:text-gray-600"><X size={20}/></button>
        
        <div className="text-center mb-6">
           <div className={`w-20 h-20 mx-auto rounded-full bg-${theme}-50 flex items-center justify-center text-${theme}-600 mb-4`}>
             {type === 'USER' ? <UserCircle size={40}/> : <MapPin size={40}/>}
           </div>
           <h3 className="font-black text-xl text-gray-800">{data.name}</h3>
           <p className="text-gray-400 text-sm font-bold">{type === 'USER' ? data.email : data.location}</p>
        </div>

        <div className="space-y-6">
           {type === 'USER' && (
             <div className="bg-gray-50 rounded-2xl p-5 border border-gray-100">
               <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-3">详细信息</h4>
               <div className="space-y-2 text-sm font-medium text-gray-600">
                 <div className="flex justify-between"><span>部门</span><span className="text-gray-900 font-bold">{data.department}</span></div>
                 <div className="flex justify-between"><span>角色</span><span className="text-gray-900 font-bold">{data.role.map((rId: string) => roles.find((r: any) => r.id === rId)?.name || rId).join(', ')}</span></div>
                 <div className="flex justify-between"><span>电话</span><span className="text-gray-900 font-bold">{data.mobile || data.landline || '-'}</span></div>
               </div>
             </div>
           )}

           {type === 'RESOURCE' && (
             <div className="bg-gray-50 rounded-2xl p-5 border border-gray-100">
               <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-3">资源详情</h4>
               <div className="space-y-2 text-sm font-medium text-gray-600">
                 <div className="flex justify-between"><span>类型</span><span className="text-gray-900 font-bold">{data.type === 'ROOM' ? '会议室' : '工位'}</span></div>
                 <div className="flex justify-between"><span>容量</span><span className="text-gray-900 font-bold">{data.capacity} 人</span></div>
                 <div className="flex justify-between"><span>状态</span><StatusBadge status={data.status} theme={theme} /></div>
               </div>
             </div>
           )}

           <div>
              <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-3">最近相关活动</h4>
              <div className="space-y-2">
                 {relatedBookings.slice(0, 3).map((b: any) => (
                   <div key={b.id} className="p-3 border border-gray-100 rounded-xl text-xs flex justify-between items-center">
                      <div>
                        <p className="font-bold text-gray-700">{b.purpose}</p>
                        <p className="text-gray-400 mt-0.5">{b.startTime.replace('T', ' ')}</p>
                      </div>
                      <StatusBadge status={b.status} theme={theme} />
                   </div>
                 ))}
                 {relatedBookings.length === 0 && <p className="text-center text-gray-300 text-xs py-4 font-bold">暂无记录</p>}
              </div>
           </div>
        </div>
      </div>
    </div>
  );
};

const BookingConflictModal = ({ conflict, users, theme, onClose, onApplySuggestion }: any) => {
  const { resource, resourceBookings, errorType, suggestion } = conflict;

  return (
    <div className="fixed inset-0 z-[1050] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-[2.5rem] p-8 max-w-md w-full shadow-2xl animate-in zoom-in">
        <div className="text-center mb-6">
           <div className="w-16 h-16 bg-rose-50 rounded-full flex items-center justify-center text-rose-500 mx-auto mb-4">
              <AlertTriangle size={32}/>
           </div>
           <h3 className="font-black text-xl text-gray-800">预约冲突提示</h3>
           <p className="text-xs font-bold text-gray-400 mt-2">
             {errorType === 'PAST_TIME' ? "您选择的时间已是过去式" : "该时段已被其他同事预订"}
           </p>
        </div>

        {errorType === 'CONFLICT' && (
          <div className="bg-gray-50 rounded-2xl p-4 mb-6 max-h-32 overflow-y-auto custom-scrollbar">
             {resourceBookings.map((b: any) => {
                const user = users.find((u: any) => u.id === b.userId);
                return (
                   <div key={b.id} className="flex items-center space-x-3 mb-2 last:mb-0 pb-2 border-b border-gray-100 last:border-0 last:pb-0">
                      <div className={`w-6 h-6 rounded-full bg-white flex items-center justify-center text-[10px] font-bold shadow-sm shrink-0`}>{user?.name[0]}</div>
                      <div>
                         <p className="text-xs font-bold text-gray-700">{user?.name} · {b.purpose}</p>
                         <p className="text-[10px] text-gray-400">{b.startTime.replace('T', ' ')} - {b.endTime.split('T')[1]}</p>
                      </div>
                   </div>
                );
             })}
          </div>
        )}

        <div className="space-y-3">
           <button 
             onClick={() => onApplySuggestion(suggestion.start, suggestion.end)} 
             className={`w-full py-4 bg-${theme}-600 text-white rounded-xl font-bold shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all flex items-center justify-center space-x-2`}
           >
             <Lightbulb size={18} className="animate-pulse"/>
             <span className="text-sm">采纳建议：{formatDate(suggestion.start)} {formatTime(suggestion.start)}</span>
           </button>
           <button onClick={onClose} className="w-full py-3 bg-gray-100 text-gray-500 rounded-xl font-bold text-sm hover:bg-gray-200 transition-colors">取消</button>
        </div>
      </div>
    </div>
  );
};

// --- Main App ---

const App: React.FC = () => {
  const [view, setView] = useState<'DASHBOARD' | 'RESOURCES' | 'USERS' | 'BOOKINGS' | 'ROLES' | 'DEPARTMENTS' | 'APPROVAL_CENTER' | 'WORKFLOW_CONFIG' | 'DATA_CENTER'>('DASHBOARD');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [theme, setTheme] = useState<string>(() => localStorage.getItem(THEME_KEY) || 'indigo');
  
  const [roles, setRoles] = useState<RoleDefinition[]>(() => { const saved = localStorage.getItem(STORAGE_KEY); return saved ? JSON.parse(saved).roles : INITIAL_ROLES; });
  const [users, setUsers] = useState<User[]>(() => { const saved = localStorage.getItem(STORAGE_KEY); return saved ? JSON.parse(saved).users : INITIAL_USERS; });
  const [resources, setResources] = useState<Resource[]>(() => { const saved = localStorage.getItem(STORAGE_KEY); return saved ? JSON.parse(saved).resources : INITIAL_RESOURCES; });
  const [bookings, setBookings] = useState<Booking[]>(() => { const saved = localStorage.getItem(STORAGE_KEY); return saved ? JSON.parse(saved).bookings : INITIAL_BOOKINGS; });
  const [departments, setDepartments] = useState<Department[]>(() => { const saved = localStorage.getItem(STORAGE_KEY); return saved ? (JSON.parse(saved).departments || INITIAL_DEPARTMENTS) : INITIAL_DEPARTMENTS; });
  const [workflow, setWorkflow] = useState<ApprovalNode[]>(() => { const saved = localStorage.getItem(STORAGE_KEY); return saved ? (JSON.parse(saved).workflow || DEFAULT_WORKFLOW) : DEFAULT_WORKFLOW; });

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showQRScanner, setShowQRScanner] = useState(false);
  const [showUserModal, setShowUserModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [showResourceModal, setShowResourceModal] = useState(false);
  const [editingResource, setEditingResource] = useState<Resource | null>(null);
  const [showBookingModal, setShowBookingModal] = useState(false);
  const [selectedResource, setSelectedResource] = useState<Resource | null>(null);
  const [showWorkflowModal, setShowWorkflowModal] = useState(false);
  const [editingWorkflowNode, setEditingWorkflowNode] = useState<ApprovalNode | null>(null);
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleDefinition | null>(null);
  const [viewDetail, setViewDetail] = useState<{ type: 'USER' | 'RESOURCE', data: any } | null>(null);
  const [bookingConflict, setBookingConflict] = useState<{ 
    resource: Resource, 
    requestedStart: string, 
    requestedEnd: string, 
    purpose: string, 
    resourceBookings: Booking[],
    errorType: 'PAST_TIME' | 'CONFLICT',
    suggestion: { start: Date, end: Date }
  } | null>(null);
  const [showResourceCalendar, setShowResourceCalendar] = useState<Resource | null>(null);
  const [calendarDateForBooking, setCalendarDateForBooking] = useState<string | null>(null);
  const [dayDetail, setDayDetail] = useState<any | null>(null);
  
  const [showImportModal, setShowImportModal] = useState<'USERS' | 'RESOURCES' | 'DEPARTMENTS' | null>(null);
  const [selectedResourceIds, setSelectedResourceIds] = useState<string[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);

  // New states for Department management
  const [showDepartmentModal, setShowDepartmentModal] = useState(false);
  const [editingDepartment, setEditingDepartment] = useState<Department | null>(null);
  const [departmentParentId, setDepartmentParentId] = useState<string | null>(null);

  // ... (keep existing useEffects and helper functions)
  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify({ roles, users, resources, bookings, departments, workflow })); }, [roles, users, resources, bookings, departments, workflow]);
  useEffect(() => { localStorage.setItem(THEME_KEY, theme); }, [theme]);

  const addNotification = (title: string, content: string, type: 'INFO' | 'SUCCESS' | 'WARNING' = 'INFO') => {
    const newNotif: Notification = { id: Date.now().toString(), userId: currentUser?.id || 'sys', title, content, timestamp: new Date().toISOString(), isRead: false, type };
    setNotifications(prev => [newNotif, ...prev].slice(0, 10));
    setTimeout(() => { setNotifications(prev => prev.filter(n => n.id !== newNotif.id)); }, 4000);
  };

  const canApprove = (booking: Booking) => booking.status === 'PENDING' && currentUser?.role.includes(workflow[booking.currentNodeIndex]?.approverRole);
  const pendingCount = bookings.filter(b => canApprove(b)).length;

  const stats = useMemo(() => {
    const totalResources = resources.length;
    const availableRooms = resources.filter(r => r.type === 'ROOM' && r.status === 'AVAILABLE').length;
    const availableDesks = resources.filter(r => r.type === 'DESK' && r.status === 'AVAILABLE').length;
    const activeBookings = bookings.filter(b => b.status === 'APPROVED').length;
    return { totalResources, availableRooms, availableDesks, activeBookings };
  }, [resources, bookings]);

  // Filters
  const filteredResources = resources.filter(r => 
    r.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    r.location.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredUsers = users.filter(u => 
    u.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    u.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.department.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleBooking = (resourceId: string, purpose: string, startTime: string, endTime: string) => {
    // ... existing implementation
    const resource = resources.find(r => r.id === resourceId);
    if (!resource || !currentUser) return;
    
    const now = new Date();
    const start = new Date(startTime);
    const end = new Date(endTime);
    const requestedDuration = (end.getTime() - start.getTime()) / 60000;

    if (end <= start) {
      addNotification("预约失败", "结束时间必须晚于开始时间", "WARNING");
      return;
    }

    if (start < now) {
      const suggestion = findNextAvailableSlot(resourceId, bookings, requestedDuration);
      setBookingConflict({ 
        resource, 
        requestedStart: startTime, 
        requestedEnd: endTime, 
        purpose,
        resourceBookings: bookings.filter(b => b.resourceId === resourceId && b.status !== 'REJECTED'), 
        errorType: 'PAST_TIME', 
        suggestion 
      });
      return;
    }

    const conflict = bookings.find(b => b.resourceId === resourceId && (b.status === 'APPROVED' || b.status === 'PENDING') && (start < new Date(b.endTime) && end > new Date(b.startTime)));
    if (conflict) {
      const suggestion = findNextAvailableSlot(resourceId, bookings, requestedDuration);
      setBookingConflict({ 
        resource, 
        requestedStart: startTime, 
        requestedEnd: endTime, 
        purpose,
        resourceBookings: bookings.filter(b => b.resourceId === resourceId && (b.status === 'APPROVED' || b.status === 'PENDING')), 
        errorType: 'CONFLICT', 
        suggestion 
      });
      return;
    }

    const newBooking: Booking = { id: `bk-${Date.now()}`, userId: currentUser.id, resourceId, type: resource.type, startTime, endTime, status: workflow.length === 0 ? 'APPROVED' : 'PENDING', purpose, createdAt: new Date().toISOString(), currentNodeIndex: 0, approvalHistory: [] };
    setBookings(prev => [newBooking, ...prev]);
    setShowBookingModal(false);
    setCalendarDateForBooking(null);
    addNotification("预约申请已提交", `资源 ${resource.name} 的预约已进入审批流程。`, "SUCCESS");
  };

  // ... existing handlers
  const handleApprove = (booking: Booking) => {
    const isLast = booking.currentNodeIndex === workflow.length - 1;
    setBookings(prev => prev.map(b => b.id === booking.id ? { ...b, currentNodeIndex: isLast ? b.currentNodeIndex : b.currentNodeIndex + 1, status: isLast ? 'APPROVED' : 'PENDING', approvalHistory: [...b.approvalHistory, { nodeName: workflow[b.currentNodeIndex].name, approverName: currentUser?.name || '未知', status: 'APPROVED', timestamp: new Date().toISOString() }] } : b));
    addNotification("审批完成", isLast ? "申请已通过最终核准。" : "申请已通过本环节预审。", "SUCCESS");
  };

  const handleReject = (booking: Booking, comment: string) => {
    setBookings(prev => prev.map(b => b.id === booking.id ? { ...b, status: 'REJECTED', approvalHistory: [...b.approvalHistory, { nodeName: workflow[b.currentNodeIndex].name, approverName: currentUser?.name || '未知', status: 'REJECTED', comment, timestamp: new Date().toISOString() }] } : b));
    addNotification("申请已驳回", "您驳回了该项资源预约申请。", "INFO");
  };

  // --- Department Handlers ---
  const handleSaveDepartment = (data: { name: string, parentId?: string }) => {
    if (editingDepartment) {
       // Update department name
       const oldName = editingDepartment.name;
       const newName = data.name;
       
       setDepartments(prev => prev.map(d => d.id === editingDepartment.id ? { ...d, name: newName } : d));
       
       // Update users associated with this department (simple cascade)
       if (oldName !== newName) {
          setUsers(prev => prev.map(u => u.department === oldName ? { ...u, department: newName } : u));
       }
       addNotification("部门更新成功", `部门名称已更改为 ${newName}`, "SUCCESS");
    } else {
       const newDept = { id: `dpt-${Date.now()}`, name: data.name, parentId: data.parentId };
       setDepartments(prev => [...prev, newDept]);
       addNotification("部门创建成功", `已添加新部门 ${data.name}`, "SUCCESS");
    }
    setShowDepartmentModal(false);
    setEditingDepartment(null);
    setDepartmentParentId(null);
  };

  const handleDeleteDepartment = (id: string) => {
     // Check for children
     const hasChildren = departments.some(d => d.parentId === id);
     if (hasChildren) {
        addNotification("无法删除", "该部门下包含子部门，请先删除子部门。", "WARNING");
        return;
     }
     // Check for users (Warning only)
     const deptName = departments.find(d => d.id === id)?.name;
     const hasUsers = users.some(u => u.department === deptName); 
     
     if (hasUsers && !confirm(`该部门 (${deptName}) 下仍有员工，删除后这些员工的部门信息将失效。确定继续吗？`)) {
        return;
     }
     
     if (confirm("确定要删除该部门吗？此操作无法撤销。")) {
        setDepartments(prev => prev.filter(d => d.id !== id));
        addNotification("删除成功", "部门已移除。", "SUCCESS");
     }
  };

  if (!currentUser) return <LoginView users={users} onLogin={setCurrentUser} theme={theme} />;

  return (
    <div className="min-h-screen flex bg-gray-50 overflow-hidden font-sans">
      {/* Toast Notifications */}
      <div className="fixed top-6 right-6 z-[1000] space-y-3 pointer-events-none">
        {notifications.map(n => (
          <div key={n.id} className="w-80 p-4 bg-white/95 backdrop-blur-md rounded-2xl shadow-2xl border border-gray-100 flex items-start space-x-3 animate-in slide-in-from-right-8 fade-in pointer-events-auto">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${n.type === 'SUCCESS' ? 'bg-emerald-50 text-emerald-600' : n.type === 'WARNING' ? 'bg-amber-50 text-amber-600' : 'bg-indigo-50 text-indigo-600'}`}>
              {n.type === 'SUCCESS' ? <CheckCircle size={18}/> : n.type === 'WARNING' ? <AlertTriangle size={18}/> : <Info size={18}/>}
            </div>
            <div className="flex-1">
              <h5 className="text-sm font-black text-gray-800">{n.title}</h5>
              <p className="text-xs text-gray-500 font-medium mt-0.5">{n.content}</p>
            </div>
            <button onClick={() => setNotifications(prev => prev.filter(item => item.id !== n.id))} className="text-gray-300 hover:text-gray-500"><X size={14}/></button>
          </div>
        ))}
      </div>

      <aside className="w-64 bg-white border-r hidden lg:flex flex-col p-6 h-screen sticky top-0 shrink-0">
        {/* ... Sidebar content ... */}
        <div className="flex items-center space-x-3 mb-10 px-2 shrink-0">
          <div className={`w-8 h-8 bg-${theme}-600 rounded-lg flex items-center justify-center text-white shadow-lg`}><Cpu size={18}/></div>
          <span className="text-lg font-black tracking-tight italic">SmartOffice</span>
        </div>
        <nav className="flex-1 space-y-2 overflow-y-auto custom-scrollbar pr-1">
          <SidebarItem icon={LayoutDashboard} label="数据全景看板" id="DASHBOARD" active={view === 'DASHBOARD'} onClick={setView} theme={theme} />
          <SidebarItem icon={MapPin} label="空间资源库" id="RESOURCES" active={view === 'RESOURCES'} onClick={setView} theme={theme} />
          <SidebarItem icon={Calendar} label="我的申请" id="BOOKINGS" active={view === 'BOOKINGS'} onClick={setView} theme={theme} />
          <div className="pt-6 pb-2 px-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">流程与中心</div>
          <SidebarItem icon={ShieldCheck} label="审批工作台" id="APPROVAL_CENTER" active={view === 'APPROVAL_CENTER'} onClick={setView} theme={theme} badge={pendingCount} />
          {currentUser.role.includes('SYSTEM_ADMIN') && (
            <>
              <div className="pt-6 pb-2 px-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">系统管理</div>
              <SidebarItem icon={GitMerge} label="流程配置" id="WORKFLOW_CONFIG" active={view === 'WORKFLOW_CONFIG'} onClick={setView} theme={theme} />
              <SidebarItem icon={Building2} label="部门管理" id="DEPARTMENTS" active={view === 'DEPARTMENTS'} onClick={setView} theme={theme} />
              <SidebarItem icon={Shield} label="角色管理" id="ROLES" active={view === 'ROLES'} onClick={setView} theme={theme} />
              <SidebarItem icon={Users} label="成员中心" id="USERS" active={view === 'USERS'} onClick={setView} theme={theme} />
              <SidebarItem icon={Database} label="数据中心" id="DATA_CENTER" active={view === 'DATA_CENTER'} onClick={setView} theme={theme} />
            </>
          )}
        </nav>

        <div className="mt-4 pt-4 border-t shrink-0">
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3 px-2">系统主题风格</p>
          <div className="flex items-center justify-around px-2">
            {THEMES.map(t => (
              <button key={t.id} onClick={() => setTheme(t.id)} title={t.name} className={`w-6 h-6 rounded-full ${t.color} border-2 transition-all ${theme === t.id ? 'border-gray-900 scale-125 shadow-md' : 'border-transparent hover:scale-110'}`} />
            ))}
          </div>
        </div>

        <div className="mt-6 pt-6 border-t shrink-0 flex items-center justify-between">
          <div className="flex items-center space-x-2 truncate">
            <div className={`w-8 h-8 bg-${theme}-600 rounded-full flex items-center justify-center text-white font-bold text-xs shadow-inner`}>{currentUser.name[0]}</div>
            <p className="text-xs font-bold truncate">{currentUser.name}</p>
          </div>
          <button onClick={() => setCurrentUser(null)} className="text-gray-400 hover:text-rose-500 transition-colors"><LogOut size={16}/></button>
        </div>
      </aside>

      <main className="flex-1 min-w-0 overflow-auto relative bg-gray-50 pb-32">
        <header className="h-16 bg-white/80 backdrop-blur-md border-b px-8 flex items-center justify-between sticky top-0 z-40">
          <div className="flex items-center space-x-6 flex-1 max-w-2xl">
            <h2 className="text-lg font-bold shrink-0">
              {view === 'DASHBOARD' && '数据全景看板'}
              {view === 'RESOURCES' && '空间资源库'}
              {view === 'USERS' && '成员中心'}
              {view === 'BOOKINGS' && '我的申请记录'}
              {view === 'APPROVAL_CENTER' && '审批中心'}
              {view === 'WORKFLOW_CONFIG' && '审批引擎配置'}
              {view === 'DEPARTMENTS' && '组织架构'}
              {view === 'ROLES' && '角色权限集'}
              {view === 'DATA_CENTER' && '数据维护中心'}
            </h2>
            {(view === 'RESOURCES' || view === 'USERS') && (
              <div className="relative flex-1 group">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300 group-focus-within:text-indigo-500 transition-colors" size={16}/>
                <input 
                  type="text" 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={view === 'RESOURCES' ? "搜索资源名称或位置..." : "搜索姓名、邮箱或部门..."} 
                  className="w-full pl-10 pr-4 py-2 bg-gray-100/50 border border-transparent rounded-xl outline-none text-sm focus:bg-white focus:border-indigo-100 transition-all font-medium" 
                />
              </div>
            )}
          </div>
          <div className="flex items-center space-x-4">
             <button className={`bg-${theme}-50 text-${theme}-600 px-4 py-2 rounded-xl font-black text-[10px] flex items-center space-x-2 hover:bg-${theme}-100 transition-all shadow-sm border border-${theme}-100`} onClick={() => setShowQRScanner(true)}>
               <QrCode size={14}/>
               <span>扫码签到</span>
             </button>
             <button className="relative p-2 text-gray-400 hover:text-indigo-600 transition-colors">
               <Bell size={20}/>
               <span className="absolute top-1 right-1 w-2 h-2 bg-rose-500 rounded-full"></span>
             </button>
          </div>
        </header>

        <div className="p-8 max-w-7xl mx-auto">
          {view === 'DASHBOARD' && (
            <div className="space-y-6 animate-in fade-in">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <button onClick={() => { setView('RESOURCES'); setSearchQuery(''); }} className={`flex items-center justify-between p-5 bg-${theme}-600 rounded-[2rem] text-white shadow-lg hover:translate-y-[-2px] transition-all group overflow-hidden relative active:scale-[0.98]`}>
                  <div className="flex items-center space-x-4 relative z-10">
                    <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center backdrop-blur-md group-hover:scale-110 transition-transform">
                      <Monitor size={24} />
                    </div>
                    <div className="text-left">
                      <h3 className="font-black text-lg leading-tight">预订会议室</h3>
                      <p className="text-[10px] text-white/70 font-bold uppercase mt-1">当前可用: <span className="text-white">{stats.availableRooms}</span></p>
                    </div>
                  </div>
                  <ArrowRightCircle className="relative z-10 text-white/50 group-hover:text-white group-hover:translate-x-1 transition-all" size={24} />
                  <Monitor className="absolute -right-4 -bottom-4 text-white/10 opacity-50 group-hover:scale-125 transition-all pointer-events-none" size={100} />
                </button>

                <button onClick={() => { setView('RESOURCES'); setSearchQuery(''); }} className="flex items-center justify-between p-5 bg-emerald-600 rounded-[2rem] text-white shadow-lg hover:translate-y-[-2px] transition-all group overflow-hidden relative active:scale-[0.98]">
                  <div className="flex items-center space-x-4 relative z-10">
                    <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center backdrop-blur-md group-hover:scale-110 transition-transform">
                      <Coffee size={24} />
                    </div>
                    <div className="text-left">
                      <h3 className="font-black text-lg leading-tight">申请工位</h3>
                      <p className="text-[10px] text-white/70 font-bold uppercase mt-1">当前可用: <span className="text-white">{stats.availableDesks}</span></p>
                    </div>
                  </div>
                  <ArrowRightCircle className="relative z-10 text-white/50 group-hover:text-white group-hover:translate-x-1 transition-all" size={24} />
                  <Coffee className="absolute -right-4 -bottom-4 text-white/10 opacity-50 group-hover:scale-125 transition-all pointer-events-none" size={100} />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <StatCard title="资源资产总量" value={stats.totalResources} icon={MapPin} trend="+2" color={theme} onClick={() => setView('RESOURCES')} />
                <StatCard title="活跃核准单" value={stats.activeBookings} icon={Activity} trend="+12%" color="emerald" onClick={() => setView('BOOKINGS')} />
                <StatCard title="待处理任务" value={pendingCount} icon={ShieldCheck} color="amber" onClick={() => setView('APPROVAL_CENTER')} />
              </div>

              <TodayResourceUsage resources={resources} bookings={bookings} users={users} theme={theme} />
              
              <MonthlyUsageGrid 
                resources={resources} 
                bookings={bookings} 
                users={users} 
                theme={theme} 
                onDayClick={(resId: string | null, date: Date) => { 
                  const dateStr = date.toISOString().split('T')[0];
                  const targetResource = resId ? resources.find(r => r.id === resId) : { name: '全公司资源概览' };
                  
                  const dayBookings = bookings.filter(b => 
                    b.status === 'APPROVED' && 
                    b.startTime.startsWith(dateStr) &&
                    (!resId || b.resourceId === resId) 
                  );
                  
                  setDayDetail({ 
                    resource: targetResource, 
                    date, 
                    bookings: dayBookings 
                  }); 
                }} 
              />
            </div>
          )}

          {/* ... existing views ... */}
          {view === 'RESOURCES' && (
            <div className="space-y-6 animate-in fade-in">
              <div className="flex justify-between items-end mb-6">
                <div><h3 className="text-2xl font-black">空间资产</h3><p className="text-sm text-gray-400 mt-1">查看及预约全公司物理空间资源。</p></div>
                <div className="flex items-center space-x-3">
                  <button onClick={() => setShowImportModal('RESOURCES')} className="bg-white border border-gray-200 text-gray-600 px-5 py-2.5 rounded-xl font-bold shadow-sm flex items-center space-x-2 hover:bg-gray-50 transition-all"><Upload size={18}/> <span>批量导入</span></button>
                  <button onClick={() => { setEditingResource(null); setShowResourceModal(true); }} className={`bg-${theme}-600 text-white px-5 py-2.5 rounded-xl font-bold shadow-lg flex items-center space-x-2 hover:shadow-xl transition-all`}><Plus size={18}/> <span>新增资源</span></button>
                </div>
              </div>
              <div className="bg-white rounded-3xl border border-gray-100 overflow-hidden shadow-sm">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-gray-50 border-b">
                      <th className="px-6 py-4 w-12 text-center">
                        <button onClick={() => setSelectedResourceIds(prev => prev.length === filteredResources.length ? [] : filteredResources.map(r => r.id))} className={`transition-colors ${selectedResourceIds.length === filteredResources.length && filteredResources.length > 0 ? `text-${theme}-600` : 'text-gray-300'}`}>
                          {selectedResourceIds.length === filteredResources.length && filteredResources.length > 0 ? <CheckSquare size={18}/> : <Square size={18}/>}
                        </button>
                      </th>
                      <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">资源标识</th>
                      <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">物理位置</th>
                      <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">类型/容量</th>
                      <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">状态</th>
                      <th className="px-6 py-4 text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {filteredResources.map(r => (
                      <tr key={r.id} className={`hover:bg-${theme}-50/20 transition-colors ${selectedResourceIds.includes(r.id) ? `bg-${theme}-50/30` : ''}`}>
                        <td className="px-6 py-4 text-center">
                          <button onClick={() => setSelectedResourceIds(prev => prev.includes(r.id) ? prev.filter(id => id !== r.id) : [...prev, r.id])} className={`transition-colors ${selectedResourceIds.includes(r.id) ? `text-${theme}-600` : 'text-gray-200 hover:text-gray-400'}`}>
                            {selectedResourceIds.includes(r.id) ? <CheckSquare size={18}/> : <Square size={18}/>}
                          </button>
                        </td>
                        <td className="px-6 py-4 font-bold text-gray-800">{r.name}</td>
                        <td className="px-6 py-4 text-xs font-medium text-gray-500">{r.location}</td>
                        <td className="px-6 py-4 text-xs text-gray-500 font-bold">{r.type === 'ROOM' ? '会议室' : '工位'} / {r.capacity || 0}人</td>
                        <td className="px-6 py-4"><StatusBadge status={r.status} theme={theme} /></td>
                        <td className="px-6 py-4 text-right space-x-1">
                          <button onClick={() => setViewDetail({ type: 'RESOURCE', data: r })} className="p-2 text-gray-300 hover:text-indigo-600 transition-colors" title="详情"><Info size={16}/></button>
                          {r.type === 'DESK' && <button onClick={() => setShowResourceCalendar(r)} className="p-2 text-gray-300 hover:text-emerald-600 transition-colors" title="日历"><CalendarDays size={16}/></button>}
                          <button onClick={() => { setSelectedResource(r); setShowBookingModal(true); }} className={`px-4 py-1.5 bg-${theme}-600 text-white rounded-lg text-[10px] font-black shadow-md hover:translate-y-[-1px] transition-all`}>预约</button>
                          {currentUser.role.includes('SYSTEM_ADMIN') && <button onClick={() => { setEditingResource(r); setShowResourceModal(true); }} className="p-2 text-gray-200 hover:text-indigo-600 transition-colors"><Edit2 size={16}/></button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredResources.length === 0 && (
                  <div className="py-20 text-center space-y-4 opacity-40">
                    <Search size={48} className="mx-auto" />
                    <p className="font-bold text-sm">未找到匹配的资源</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {view === 'USERS' && (
            <div className="space-y-6 animate-in fade-in">
              <div className="flex justify-between items-end mb-6">
                <div><h3 className="text-2xl font-black">成员名录</h3><p className="text-sm text-gray-400 mt-1">管理企业员工信息及其系统角色。</p></div>
                <div className="flex items-center space-x-3">
                  <button onClick={() => setShowImportModal('USERS')} className="bg-white border border-gray-200 text-gray-600 px-5 py-2.5 rounded-xl font-bold shadow-sm flex items-center space-x-2 hover:bg-gray-50 transition-all"><Upload size={18}/> <span>批量导入</span></button>
                  <button onClick={() => { setEditingUser(null); setShowUserModal(true); }} className={`bg-${theme}-600 text-white px-5 py-2.5 rounded-xl font-bold shadow-lg flex items-center space-x-2 hover:shadow-xl transition-all`}><UserPlus size={18}/> <span>录入成员</span></button>
                </div>
              </div>
              <div className="bg-white rounded-3xl border border-gray-100 overflow-hidden shadow-sm">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-gray-50 border-b">
                      <th className="px-6 py-4 w-12 text-center">
                        <button onClick={() => setSelectedUserIds(prev => prev.length === filteredUsers.length ? [] : filteredUsers.map(u => u.id))} className={`transition-colors ${selectedUserIds.length === filteredUsers.length && filteredUsers.length > 0 ? `text-${theme}-600` : 'text-gray-300'}`}>
                          {selectedUserIds.length === filteredUsers.length && filteredUsers.length > 0 ? <CheckSquare size={18}/> : <Square size={18}/>}
                        </button>
                      </th>
                      <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">基本信息</th>
                      <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">部门</th>
                      <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">角色</th>
                      <th className="px-6 py-4 text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {filteredUsers.map(u => (
                      <tr key={u.id} className={`hover:bg-${theme}-50/20 transition-colors ${selectedUserIds.includes(u.id) ? `bg-${theme}-50/30` : ''}`}>
                        <td className="px-6 py-4 text-center">
                          <button onClick={() => setSelectedUserIds(prev => prev.includes(u.id) ? prev.filter(id => id !== u.id) : [...prev, u.id])} className={`transition-colors ${selectedUserIds.includes(u.id) ? `text-${theme}-600` : 'text-gray-200 hover:text-gray-400'}`}>
                            {selectedUserIds.includes(u.id) ? <CheckSquare size={18}/> : <Square size={18}/>}
                          </button>
                        </td>
                        <td className="px-6 py-4 flex items-center space-x-3">
                          <div className={`w-8 h-8 rounded-full bg-${theme}-100 flex items-center justify-center font-black text-${theme}-600 text-[10px]`}>{u.name[0]}</div>
                          <div><p className="font-bold text-gray-800 text-sm">{u.name}</p><p className="text-[10px] text-gray-400 font-medium">{u.email}</p></div>
                        </td>
                        <td className="px-6 py-4 text-xs font-black text-gray-500 uppercase">{u.department}</td>
                        <td className="px-6 py-4"><div className="flex flex-wrap gap-1">{u.role.map(rid => <RoleTag key={rid} roleId={rid} roles={roles} theme={theme}/>)}</div></td>
                        <td className="px-6 py-4 text-right">
                          <button onClick={() => setViewDetail({ type: 'USER', data: u })} className="p-2 text-gray-300 hover:text-indigo-600 transition-colors"><Info size={16}/></button>
                          <button onClick={() => { setEditingUser(u); setShowUserModal(true); }} className="p-2 text-gray-200 hover:text-indigo-600 transition-colors"><Edit2 size={16}/></button>
                          <button onClick={() => { if(confirm("确定注销该成员吗？")) setUsers(users.filter(user => user.id !== u.id)); }} className="p-2 text-gray-200 hover:text-rose-500 transition-colors"><Trash2 size={16}/></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredUsers.length === 0 && (
                  <div className="py-20 text-center space-y-4 opacity-40">
                    <Users size={48} className="mx-auto" />
                    <p className="font-bold text-sm">未找到匹配的成员</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {view === 'APPROVAL_CENTER' && (
            <div className="space-y-6 animate-in fade-in">
              <div className="mb-8 flex items-center justify-between">
                <div>
                  <h3 className="text-3xl font-black text-gray-800 tracking-tight">审批工作台</h3>
                  <p className="text-sm text-gray-400 mt-2 flex items-center space-x-2">
                    <ShieldCheck size={14} className={`text-${theme}-600`}/>
                    <span>当前共 <strong className={`text-${theme}-600`}>{pendingCount}</strong> 项待处理申请</span>
                  </p>
                </div>
                <div className="flex items-center space-x-2 bg-white px-4 py-2 rounded-2xl border border-gray-100 shadow-sm">
                   <Activity size={16} className="text-emerald-500 animate-pulse"/>
                   <span className="text-xs font-black text-gray-500">队列实时监听中</span>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-6">
                {bookings.filter(b => canApprove(b)).map(b => (
                  <ApprovalTaskCard key={b.id} booking={b} workflow={workflow} users={users} resources={resources} theme={theme} onApprove={() => handleApprove(b)} onReject={(c: string) => handleReject(b, c)} />
                ))}
                {bookings.filter(b => canApprove(b)).length === 0 && (
                  <div className="text-center py-32 bg-white rounded-[3rem] border border-dashed border-gray-200">
                    <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-6 text-gray-200">
                      <CheckCircle size={40}/>
                    </div>
                    <p className="text-gray-400 font-black">所有任务已处理完毕，保持高效！</p>
                  </div>
                )}
              </div>
            </div>
          )}
          
          {view === 'BOOKINGS' && (
             <div className="space-y-4 animate-in fade-in">
               <h3 className="text-2xl font-black mb-4">我的申请动态</h3>
               <div className="grid grid-cols-1 gap-4">
                 {bookings.filter(b => b.userId === currentUser.id).length === 0 ? (
                   <div className="text-center py-32 bg-white rounded-[3rem] border border-dashed text-gray-400 font-bold">
                     <History size={48} className="mx-auto mb-4 opacity-20"/>
                     暂无预约申请记录，去资源库看看吧。
                   </div>
                 ) : (
                   bookings.filter(b => b.userId === currentUser.id).map(b => (
                     <div key={b.id} className="bg-white rounded-[2.5rem] border border-gray-100 shadow-sm overflow-hidden p-8 hover:border-gray-200 hover:shadow-lg transition-all">
                       <div className="flex items-center justify-between mb-8">
                         <div className="flex items-center space-x-4">
                           <div className={`w-12 h-12 rounded-2xl bg-${theme}-50 flex items-center justify-center text-${theme}-600`}><Briefcase size={24}/></div>
                           <div><h4 className="font-black text-lg text-gray-800 leading-none">{b.purpose}</h4><p className="text-[10px] text-gray-400 font-black uppercase mt-2 tracking-widest">{resources.find(r => r.id === b.resourceId)?.name} · {b.startTime.replace('T', ' ')}</p></div>
                         </div>
                         <StatusBadge status={b.status} theme={theme} />
                       </div>
                       <WorkflowStepper booking={b} workflow={workflow} users={users} theme={theme} />
                     </div>
                   ))
                 )}
               </div>
             </div>
          )}

          {view === 'WORKFLOW_CONFIG' && (
             <div className="space-y-6 animate-in fade-in max-w-4xl">
               <div className="flex justify-between items-center mb-6"><div><h3 className="text-2xl font-black">审批流程引擎</h3><p className="text-sm text-gray-400 mt-1">编排资源申请的流转节点及负责人。</p></div><button onClick={() => { setEditingWorkflowNode(null); setShowWorkflowModal(true); }} className={`bg-${theme}-600 text-white px-5 py-2.5 rounded-xl font-bold shadow-lg flex items-center space-x-2`}><Plus size={18}/> <span>新增节点</span></button></div>
               <div className="space-y-4">
                 {workflow.map((node, index) => (
                   <div key={node.id} className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm flex items-center justify-between group hover:border-gray-200 transition-all">
                     <div className="flex items-center space-x-6">
                       <div className={`w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center font-black text-${theme}-600 border border-gray-100 shadow-inner`}>{index + 1}</div>
                       <div><h5 className="font-bold text-gray-800">{node.name}</h5><p className="text-xs text-gray-400 mt-1 font-medium">负责角色：{roles.find(r => r.id === node.approverRole)?.name}</p></div>
                     </div>
                     <div className="flex items-center space-x-2 opacity-0 group-hover:opacity-100 transition-all">
                       <button onClick={() => { const nw = [...workflow]; if(index > 0) { [nw[index], nw[index-1]] = [nw[index-1], nw[index]]; setWorkflow(nw); } }} disabled={index === 0} className="p-2 text-gray-400 hover:text-indigo-600 disabled:opacity-30"><ChevronUp size={16}/></button>
                       <button onClick={() => { const nw = [...workflow]; if(index < nw.length-1) { [nw[index], nw[index+1]] = [nw[index+1], nw[index]]; setWorkflow(nw); } }} disabled={index === workflow.length-1} className="p-2 text-gray-400 hover:text-indigo-600 disabled:opacity-30"><ChevronDown size={16}/></button>
                       <button onClick={() => { setEditingWorkflowNode(node); setShowWorkflowModal(true); }} className="p-2 text-gray-400 hover:text-indigo-600"><Edit2 size={16}/></button>
                       <button onClick={() => setWorkflow(workflow.filter(n => n.id !== node.id))} className="p-2 text-gray-400 hover:text-rose-500"><Trash2 size={16}/></button>
                     </div>
                   </div>
                 ))}
                 {workflow.length === 0 && <div className="p-20 text-center bg-white rounded-3xl border border-dashed text-gray-300 font-bold">暂无审批节点，流程将默认免审通过。</div>}
               </div>
             </div>
          )}

          {view === 'ROLES' && (
             <div className="space-y-6 animate-in fade-in">
               <div className="flex justify-between items-center mb-6"><div><h3 className="text-2xl font-black">权限集管理</h3><p className="text-sm text-gray-400 mt-1">定义系统角色及其对应的业务职能。</p></div><button onClick={() => { setEditingRole(null); setShowRoleModal(true); }} className={`bg-${theme}-600 text-white px-5 py-2.5 rounded-xl font-bold shadow-lg flex items-center space-x-2`}><Plus size={18}/> <span>新增角色集</span></button></div>
               <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                 {roles.map(r => (
                   <div key={r.id} className="bg-white p-8 rounded-[2rem] border border-gray-100 shadow-sm relative group hover:border-gray-200 hover:shadow-md transition-all">
                     <div className={`w-12 h-12 rounded-2xl bg-${r.color}-50 flex items-center justify-center text-${r.color}-600 mb-6 shadow-inner`}><Shield size={24}/></div>
                     <h5 className="font-black text-xl text-gray-800">{r.name}</h5>
                     <p className="text-xs text-gray-400 mt-3 leading-relaxed font-medium">{r.description}</p>
                     <div className="mt-6 pt-6 border-t border-gray-50 flex justify-between items-center">
                       <span className="text-[9px] font-black text-gray-300 uppercase tracking-widest">ID: {r.id}</span>
                       <button onClick={() => { setEditingRole(r); setShowRoleModal(true); }} className="p-2 text-gray-300 hover:text-indigo-600 opacity-0 group-hover:opacity-100 transition-all"><Edit2 size={14}/></button>
                     </div>
                   </div>
                 ))}
               </div>
             </div>
          )}

          {view === 'DEPARTMENTS' && (
            <div className="space-y-6 animate-in fade-in">
               <div className="flex justify-between items-center mb-6"><div><h3 className="text-2xl font-black">组织架构</h3><p className="text-sm text-gray-400 mt-1">管理企业部门层级结构。</p></div><div className="flex space-x-3"><button onClick={() => setShowImportModal('DEPARTMENTS')} className="bg-white border border-gray-200 text-gray-600 px-5 py-2.5 rounded-xl font-bold shadow-sm flex items-center space-x-2 hover:bg-gray-50 transition-all"><Upload size={18}/> <span>批量导入</span></button><button onClick={() => { setEditingDepartment(null); setDepartmentParentId(null); setShowDepartmentModal(true); }} className={`bg-${theme}-600 text-white px-5 py-2.5 rounded-xl font-bold shadow-lg flex items-center space-x-2`}><Plus size={18}/> <span>新增一级部门</span></button></div></div>
               <div className="bg-white rounded-[2.5rem] p-8 border border-gray-100 shadow-sm min-h-[400px]">
                  {departments.length === 0 ? (
                     <div className="text-center py-20 text-gray-300 font-bold">暂无部门数据，请先导入或添加。</div>
                  ) : (
                     <div className="space-y-4">
                       {departments.filter(d => !d.parentId).map(root => (
                          <DepartmentNode key={root.id} dept={root} allDepts={departments} theme={theme} onEdit={(d: any) => { setEditingDepartment(d); setShowDepartmentModal(true); }} onDelete={handleDeleteDepartment} onAddSub={(pid: string) => { setEditingDepartment(null); setDepartmentParentId(pid); setShowDepartmentModal(true); }} />
                       ))}
                     </div>
                  )}
               </div>
            </div>
          )}

          {view === 'DATA_CENTER' && (
             <div className="space-y-6 animate-in fade-in">
               <div className="flex justify-between items-center mb-6"><div><h3 className="text-2xl font-black">数据中心</h3><p className="text-sm text-gray-400 mt-1">系统数据的备份、恢复与重置。</p></div></div>
               <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                 <div className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm flex flex-col items-center text-center hover:border-gray-200 transition-all">
                    <div className="w-16 h-16 bg-indigo-50 rounded-full flex items-center justify-center text-indigo-600 mb-6"><Download size={32}/></div>
                    <h4 className="font-black text-xl text-gray-800">全量备份</h4>
                    <p className="text-gray-400 text-xs mt-2 mb-8 px-4 h-8">导出包含用户、资源、预约记录在内的所有数据为 JSON 文件。</p>
                    <button onClick={() => {
                      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify({ users, resources, bookings, departments, roles, workflow }));
                      const downloadAnchorNode = document.createElement('a');
                      downloadAnchorNode.setAttribute("href", dataStr);
                      downloadAnchorNode.setAttribute("download", "smart_office_backup.json");
                      document.body.appendChild(downloadAnchorNode);
                      downloadAnchorNode.click();
                      downloadAnchorNode.remove();
                      addNotification("备份成功", "数据已导出至本地。", "SUCCESS");
                    }} className="w-full py-3 bg-indigo-600 text-white rounded-xl font-bold shadow-lg hover:translate-y-[-2px] transition-all">立即导出</button>
                 </div>

                 <div className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm flex flex-col items-center text-center hover:border-gray-200 transition-all">
                    <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center text-emerald-600 mb-6"><RefreshCw size={32}/></div>
                    <h4 className="font-black text-xl text-gray-800">数据恢复</h4>
                    <p className="text-gray-400 text-xs mt-2 mb-8 px-4 h-8">通过 JSON 备份文件还原系统状态。</p>
                    <button onClick={() => {
                       const input = document.createElement('input');
                       input.type = 'file';
                       input.accept = 'application/json';
                       input.onchange = (e: any) => {
                         const file = e.target.files[0];
                         const reader = new FileReader();
                         reader.onload = (event) => {
                           try {
                             const data = JSON.parse(event.target?.result as string);
                             if(data.users) setUsers(data.users);
                             if(data.resources) setResources(data.resources);
                             if(data.bookings) setBookings(data.bookings);
                             if(data.departments) setDepartments(data.departments);
                             if(data.roles) setRoles(data.roles);
                             if(data.workflow) setWorkflow(data.workflow);
                             addNotification("恢复成功", "系统数据已重置为备份状态。", "SUCCESS");
                           } catch(err) { alert("文件格式错误"); }
                         };
                         reader.readAsText(file);
                       };
                       input.click();
                    }} className="w-full py-3 bg-white border-2 border-emerald-100 text-emerald-600 rounded-xl font-bold hover:bg-emerald-50 transition-all">导入备份</button>
                 </div>

                 <div className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm flex flex-col items-center text-center hover:border-gray-200 transition-all">
                    <div className="w-16 h-16 bg-rose-50 rounded-full flex items-center justify-center text-rose-600 mb-6"><Trash2 size={32}/></div>
                    <h4 className="font-black text-xl text-gray-800">重置系统</h4>
                    <p className="text-gray-400 text-xs mt-2 mb-8 px-4 h-8">清空所有业务数据，恢复至出厂默认设置。</p>
                    <button onClick={() => {
                       if(confirm("警告：此操作不可逆！将清空所有用户产生的预约和配置，确定继续？")) {
                          localStorage.removeItem(STORAGE_KEY);
                          window.location.reload();
                       }
                    }} className="w-full py-3 bg-rose-50 text-rose-600 rounded-xl font-bold hover:bg-rose-100 transition-all">恢复出厂设置</button>
                 </div>
               </div>
             </div>
          )}
        </div>
      </main>

      {/* --- Modals --- */}
      {showDepartmentModal && (
        <DepartmentModal 
          department={editingDepartment} 
          parentId={departmentParentId} 
          theme={theme} 
          onClose={() => setShowDepartmentModal(false)} 
          onSave={handleSaveDepartment} 
        />
      )}

      {showQRScanner && (
        <QRScannerModal 
          theme={theme} 
          onClose={() => setShowQRScanner(false)} 
          onScanSuccess={(msg: string) => addNotification("签到成功", msg, "SUCCESS")} 
        />
      )}

      {dayDetail && (
        <DayBookingDetailModal detail={dayDetail} users={users} resources={resources} theme={theme} onClose={() => setDayDetail(null)} />
      )}

      {showImportModal && (
        <BatchImportModal 
          type={showImportModal} 
          theme={theme} 
          existingDepartments={departments} 
          roles={roles}
          onClose={() => setShowImportModal(null)} 
          onImport={(data: any) => {
            if (showImportModal === 'USERS') setUsers(prev => [...prev, ...data]);
            else if (showImportModal === 'RESOURCES') setResources(prev => [...prev, ...data]);
            else if (showImportModal === 'DEPARTMENTS') setDepartments(prev => [...prev, ...data]);
            addNotification("导入成功", `已成功导入 ${data.length} 条数据。`, "SUCCESS");
            setShowImportModal(null);
          }} 
        />
      )}

      {showResourceCalendar && (
        <ResourceCalendarModal resource={showResourceCalendar} bookings={bookings} users={users} theme={theme} onClose={() => setShowResourceCalendar(null)} onSelectDate={(date: string) => { setCalendarDateForBooking(date); setSelectedResource(showResourceCalendar); setShowResourceCalendar(null); setShowBookingModal(true); }} />
      )}

      {viewDetail && (
        <DetailViewModal viewDetail={viewDetail} theme={theme} roles={roles} users={users} bookings={bookings} onClose={() => setViewDetail(null)} />
      )}

      {showUserModal && <UserModal user={editingUser} departments={departments} roles={roles} onClose={() => setShowUserModal(false)} onSave={(data: any) => { if(editingUser) setUsers(users.map(u => u.id === editingUser.id ? {...u, ...data} : u)); else setUsers([...users, { id: 'u-'+Date.now(), ...data }]); setShowUserModal(false); addNotification("操作成功", "成员信息已更新。", "SUCCESS"); }} theme={theme} />}
      {showResourceModal && <ResourceModal resource={editingResource} onClose={() => setShowResourceModal(false)} onSave={(data: any) => { if(editingResource) setResources(resources.map(r => r.id === editingResource.id ? {...r, ...data} : r)); else setResources([...resources, { id: 'r-'+Date.now(), status: 'AVAILABLE', features: [], ...data }]); setShowResourceModal(false); addNotification("操作成功", "资源配置已保存。", "SUCCESS"); }} theme={theme} />}
      {showRoleModal && <RoleModal role={editingRole} onClose={() => setShowRoleModal(false)} onSave={(data: any) => { if(editingRole) setRoles(roles.map(r => r.id === editingRole.id ? {...r, ...data} : r)); else setRoles([...roles, { id: 'rl-'+Date.now(), ...data }]); setShowRoleModal(false); addNotification("操作成功", "角色集已更新。", "SUCCESS"); }} theme={theme} />}
      {showWorkflowModal && <WorkflowModal node={editingWorkflowNode} roles={roles} onClose={() => setShowWorkflowModal(false)} onSave={(data: any) => { if(editingWorkflowNode) setWorkflow(workflow.map(n => n.id === editingWorkflowNode.id ? {...n, ...data} : n)); else setWorkflow([...workflow, { id: 'wf-'+Date.now(), ...data }]); setShowWorkflowModal(false); addNotification("流程已更新", "审批链路配置已生效。", "SUCCESS"); }} theme={theme} />}
      
      {/* Booking Form must be before Conflict Modal in logic or behind in stacking, here we rely on z-index but rendering order matters too */}
      {showBookingModal && selectedResource && (<BookingFormModal resource={selectedResource} theme={theme} initialDate={calendarDateForBooking} onClose={() => { setShowBookingModal(false); setCalendarDateForBooking(null); }} onConfirm={handleBooking} availableResources={resources.filter(r => r.status === 'AVAILABLE')}/>)}

      {/* Moved BookingConflictModal to the very end and increased z-index to 1050 to ensure it is always on top */}
      {bookingConflict && (
        <BookingConflictModal 
          conflict={bookingConflict} 
          users={users} 
          theme={theme} 
          onClose={() => setBookingConflict(null)} 
          onApplySuggestion={(start: Date, end: Date) => { 
            if (selectedResource && bookingConflict) { 
              handleBooking(selectedResource.id, bookingConflict.purpose, start.toISOString(), end.toISOString()); 
              setBookingConflict(null); 
            } 
          }} 
        />
      )}
    </div>
  );
};

export default App;