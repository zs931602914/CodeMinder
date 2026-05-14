import React from 'react';

interface TerminalTabProps {
  title: string;
  isActive: boolean;
  onClick: () => void;
  onClose: () => void;
}

export const TerminalTab: React.FC<TerminalTabProps> = ({
  title,
  isActive,
  onClick,
  onClose,
}) => {
  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClose();
  };

  return (
    <div className={`tab ${isActive ? 'active' : ''}`} onClick={onClick}>
      <span className="tab-title" title={title}>
        {title}
      </span>
      <span className="tab-close" onClick={handleClose}>
        ×
      </span>
    </div>
  );
};
