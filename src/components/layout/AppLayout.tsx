import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Upload } from 'lucide-react';
import { MobileNavigation, Sidebar } from './Sidebar';
import { useAuth, useHousehold } from '../../hooks';
import { ensureMonthlyRecurringTransactions } from '../../lib/recurringTransactions';
import styles from './AppLayout.module.css';

interface AppLayoutProps {
  children: React.ReactNode;
}

export const AppLayout: React.FC<AppLayoutProps> = ({ children }) => {
  const { user } = useAuth();
  const { household, accounts } = useHousehold();
  const householdId = household?.id || null;

  useEffect(() => {
    if (!householdId) return;
    const now = new Date();
    void ensureMonthlyRecurringTransactions({
      householdId,
      accounts,
      year: now.getFullYear(),
      month: now.getMonth() + 1,
    }).catch(error => {
      console.error('Impossibile sincronizzare le spese fisse del mese:', error);
    });
  }, [accounts, householdId]);

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
