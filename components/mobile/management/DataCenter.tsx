import React from 'react';
import { Download, Upload, Database } from 'lucide-react';
import { MobileAdminPage } from '../common/MobileAdminPage';

interface DataCenterProps {
  users: any[];
  resources: any[];
  bookings: any[];
  departments: any[];
  theme: string;
  onBack: () => void;
}

export const DataCenter: React.FC<DataCenterProps> = ({
  users,
  resources,
  bookings,
  departments,
  theme,
  onBack
}) => {
  const handleExportData = () => {
    // 导出数据逻辑
    alert('数据导出功能开发中');
  };

  const handleImportData = () => {
    // 导入数据逻辑
    alert('数据导入功能开发中');
  };

  return (
    <MobileAdminPage 
      title="数据中心" 
      theme={theme} 
      onBack={onBack}
      action={{ icon: <Database size={20} />, onClick: () => {} }}
    >
      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-3">
        <div className={`p-4 rounded-xl border text-center transition-all duration-300 ${theme === 'finance' ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-100'}`}>
          <p className={`text-2xl font-black transition-colors duration-300 ${theme === 'finance' ? 'text-white' : 'text-gray-800'}`}>{users.length}</p>
          <p className={`text-xs transition-colors duration-300 ${theme === 'finance' ? 'text-gray-400' : 'text-gray-400'}`}>总用户数</p>
        </div>
        <div className={`p-4 rounded-xl border text-center transition-all duration-300 ${theme === 'finance' ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-100'}`}>
          <p className={`text-2xl font-black transition-colors duration-300 ${theme === 'finance' ? 'text-white' : 'text-gray-800'}`}>{resources.length}</p>
          <p className={`text-xs transition-colors duration-300 ${theme === 'finance' ? 'text-gray-400' : 'text-gray-400'}`}>资源总数</p>
        </div>
        <div className={`p-4 rounded-xl border text-center transition-all duration-300 ${theme === 'finance' ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-100'}`}>
          <p className={`text-2xl font-black transition-colors duration-300 ${theme === 'finance' ? 'text-white' : 'text-gray-800'}`}>{bookings.length}</p>
          <p className={`text-xs transition-colors duration-300 ${theme === 'finance' ? 'text-gray-400' : 'text-gray-400'}`}>预约总数</p>
        </div>
        <div className={`p-4 rounded-xl border text-center transition-all duration-300 ${theme === 'finance' ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-100'}`}>
          <p className={`text-2xl font-black transition-colors duration-300 ${theme === 'finance' ? 'text-white' : 'text-gray-800'}`}>{departments.length}</p>
          <p className={`text-xs transition-colors duration-300 ${theme === 'finance' ? 'text-gray-400' : 'text-gray-400'}`}>部门数量</p>
        </div>
      </div>
      
      {/* Data Operations */}
      <div className={`mt-6 rounded-xl border p-4 transition-all duration-300 ${theme === 'finance' ? 'bg-gray-800/50 border-gray-700' : 'bg-white border-gray-100'}`}>
        <h4 className={`font-bold mb-3 transition-colors duration-300 ${theme === 'finance' ? 'text-white' : 'text-gray-800'}`}>数据操作</h4>
        <div className="space-y-2">
          <button 
            onClick={handleExportData}
            className={`w-full py-3 rounded-xl text-sm font-bold flex items-center justify-center space-x-2 transition-all duration-300 ${theme === 'finance' ? 'bg-gray-700 text-gray-200 hover:bg-gray-600' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
          >
            <Download size={16} />
            <span>导出数据</span>
          </button>
          <button 
            onClick={handleImportData}
            className={`w-full py-3 rounded-xl text-sm font-bold flex items-center justify-center space-x-2 transition-all duration-300 ${theme === 'finance' ? 'bg-gray-700 text-gray-200 hover:bg-gray-600' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
          >
            <Upload size={16} />
            <span>导入数据</span>
          </button>
        </div>
      </div>

      {/* Data Information */}
      <div className={`mt-6 rounded-xl border p-4 transition-all duration-300 ${theme === 'finance' ? 'bg-gray-900/70 border-gray-700' : 'bg-gray-50 border-gray-100'}`}>
        <h4 className={`font-bold text-sm mb-2 transition-colors duration-300 ${theme === 'finance' ? 'text-gray-300' : 'text-gray-700'}`}>数据说明</h4>
        <p className={`text-xs transition-colors duration-300 ${theme === 'finance' ? 'text-gray-400' : 'text-gray-500'}`}>• 系统数据每小时自动备份</p>
        <p className={`text-xs mt-1 transition-colors duration-300 ${theme === 'finance' ? 'text-gray-400' : 'text-gray-500'}`}>• 导出数据格式为CSV和JSON</p>
        <p className={`text-xs mt-1 transition-colors duration-300 ${theme === 'finance' ? 'text-gray-400' : 'text-gray-500'}`}>• 导入数据支持增量更新</p>
      </div>
    </MobileAdminPage>
  );
};

export default DataCenter;