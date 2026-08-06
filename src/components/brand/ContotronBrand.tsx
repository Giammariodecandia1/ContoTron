import React from 'react';
import styles from './ContotronBrand.module.css';

interface ContotronBrandProps {
  className?: string;
  size?: 'small' | 'medium' | 'large';
}

export const ContotronBrand: React.FC<ContotronBrandProps> = ({
  className = '',
  size = 'medium',
}) => (
  <span className={`${styles.brand} ${styles[size]} ${className}`} aria-label="Contotron">
    <img className={styles.mark} src="/contotron-mark.svg" alt="" aria-hidden="true" />
    <span className={styles.wordmark}>Contotron</span>
  </span>
);
