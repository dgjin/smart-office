import React from 'react';
import { ShieldOff } from 'lucide-react';

interface NoPermissionViewProps {
  theme?: string;
}

export const NoPermissionView: React.FC<NoPermissionViewProps> = ({ theme = 'indigo' }) => (
  <div className="flex flex-col items-center justify-center min-h-[60vh] p-8">
    <div className={`w-20 h-20 rounded-full bg-${theme}-50 flex items-center justify-center mb-4`}>
      <ShieldOff size={40} className={`text-${theme}-400`} />
    </div>
    <h2 className="text-lg font-bold text-gray-700 mb-2">无访问权限</h2>
    <p className="text-sm text-gray-400 text-center max-w-xs">
      您没有权限访问此功能，请联系管理员获取相应权限
    </p>
  </div>
);
