import React from 'react';
import { Button } from './Button';
import styles from './EmptyState.module.css';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description: string;
  actionText?: string;
  onAction?: () => void;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ 
  icon, 
  title, 
  description, 
  actionText, 
  onAction,
  className = ''
}) => {
  return (
    <div className={`${styles.emptyState} ${className}`}>
      {icon && <div className={styles.iconWrapper}>{icon}</div>}
      <h3 className={styles.title}>{title}</h3>
      <p className={styles.description}>{description}</p>
      {actionText && onAction && (
        <div className={styles.actionWrapper}>
          <Button onClick={onAction}>{actionText}</Button>
        </div>
      )}
    </div>
  );
};
