import React from 'react';
import styles from './Card.module.css';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}

export const Card: React.FC<CardProps> = ({ 
  title, 
  icon,
  action,
  children,
  className,
  ...props 
}) => {
  return (
    <div className={`${styles.card} ${className || ''}`} {...props}>
      {(title || icon || action) && (
        <div className={styles.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {icon && <span className={styles.icon}>{icon}</span>}
            {title && <h3 className={styles.title}>{title}</h3>}
          </div>
          {action && <div className={styles.action}>{action}</div>}
        </div>
      )}
      <div className={styles.cardBody}>
        {children}
      </div>
    </div>
  );
};
