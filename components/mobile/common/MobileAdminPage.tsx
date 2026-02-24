import React from 'react';
import { ChevronLeft } from 'lucide-react';

interface MobileAdminPageProps {
  title: string;
  theme: string;
  onBack: () => void;
  children: React.ReactNode;
  action?: {
    icon: React.ReactNode;
    onClick: () => void;
  };
}

export const MobileAdminPage: React.FC<MobileAdminPageProps> = ({
  title,
  theme,
  onBack,
  children,
  action
}) => {
  return (
    <div className="min-h-screen bg-gray-50 pb-20 animate-in fade-in">
      {/* Header */}
      <div className={`bg-${theme}-600 text-white px-4 py-4 flex items-center justify-between sticky top-0 z-10`}>
        <div className="flex items-center">
          <button
            onClick={onBack}
            className="p-2 -ml-2 hover:bg-white/20 rounded-full transition-colors"
          >
            <ChevronLeft size={24} />
          </button>
          <h1 className="text-lg font-bold ml-2">{title}</h1>
        </div>
        {action && (
          <button
            onClick={action.onClick}
            className="p-2 bg-white/20 rounded-full hover:bg-white/30 transition-colors"
          >
            {action.icon}
          </button>
        )}
      </div>

      {/* Content */}
      <div className="p-4">
        {children}
      </div>
    </div>
  );
};
