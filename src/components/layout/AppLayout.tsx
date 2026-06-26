import React from 'react';
import { Link } from 'react-router-dom';
import { Upload } from 'lucide-react';
import { MobileNavigation, Sidebar } from './Sidebar';
import { useAuth } from '../../hooks';
import styles from './AppLayout.module.css';

interface AppLayoutProps {
  children: React.ReactNode;
}

export const AppLayout: React.FC<AppLayoutProps> = ({ children }) => {
  const { user } = useAuth();

  return (
    <div className={styles.appContainer}>
      <Sidebar />
      <main className={styles.mainContent}>
        <header className={styles.mobileTopBar}>
          <div>
            <div className={styles.mobileLogo}>Contotron</div>
            {user?.display_name && <div className={styles.mobileUser}>{user.display_name}</div>}
          </div>
          <Link to="/scan" className={styles.mobileScanButton}>
            <Upload size={18} />
            <span>Scan</span>
          </Link>
        </header>
        <div className={styles.contentInner}>
          {children}
        </div>
      </main>
      <MobileNavigation />
    </div>
  );
};
