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
  const isFinanceTheme = theme === 'finance';
  const darkBg = isFinanceTheme ? 'bg-[#0F172A]' : 'bg-gray-50';
  const darkHeaderBg = isFinanceTheme ? 'bg-[#1E293B] border-[#334155]' : `bg-${theme}-600`;
  const darkHeaderText = isFinanceTheme ? 'text-white' : 'text-white';
  const darkBorder = isFinanceTheme ? 'border-[#334155]' : 'border-gray-100';
  const darkButtonBg = isFinanceTheme ? 'bg-[#334155] text-white/80' : 'bg-white/20 text-white';
  const darkButtonHover = isFinanceTheme ? 'hover:bg-[#475569]' : 'hover:bg-white/30';

  return (
    <div className={`min-h-screen ${darkBg} pb-20 animate-in fade-in font-['IBM_Plex_Sans']`}>
      {/* Header */}
      <div className={`${darkHeaderBg} ${darkHeaderText} px-4 py-4 flex items-center justify-between sticky top-0 z-10 border-b ${darkBorder}`}>
        <div className="flex items-center">
          <button
            onClick={onBack}
            className={`p-2 -ml-2 ${darkButtonHover} rounded-full transition-colors`}
          >
            <ChevronLeft size={24} />
          </button>
          <h1 className="text-lg font-bold ml-2">{title}</h1>
        </div>
        {action && (
          <button
            onClick={action.onClick}
            className={`p-2 ${darkButtonBg} rounded-full ${darkButtonHover} transition-colors`}
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
