import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Home, PieChart, List, FileText, Settings, Upload, ArrowLeftRight, Search, BarChart3 } from 'lucide-react';
import { useAuth } from '../../hooks';
import styles from './AppLayout.module.css';

export const navItems = [
  { path: '/', label: 'Dashboard', icon: <Home size={20} /> },
  { path: '/transazioni', label: 'Transazioni', icon: <List size={20} /> },
  { path: '/mensile', label: 'Budget Mensile', icon: <PieChart size={20} /> },
  { path: '/documenti', label: 'Documenti', icon: <FileText size={20} /> },
  { path: '/ricerca', label: 'Ricerca', icon: <Search size={20} /> },
  { path: '/report', label: 'Report', icon: <BarChart3 size={20} /> },
  { path: '/impostazioni', label: 'Impostazioni', icon: <Settings size={20} /> },
];

export const Sidebar: React.FC = () => {
  const location = useLocation();
  const { user, logout } = useAuth();
  const isActive = (path: string) => (
    path === '/' ? location.pathname === '/' : location.pathname.startsWith(path)
  );

  return (
    <aside className={styles.sidebar}>
      <div className={styles.sidebarHeader}>
        <h2 className={styles.logo}>Contotron</h2>
      </div>
      <nav className={styles.sidebarNav}>
        {navItems.map(item => (
          <Link
            key={item.path}
            to={item.path}
            className={`${styles.navLink} ${isActive(item.path) ? styles.active : ''}`}
          >
            {item.icon}
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
      <div className={styles.sidebarFooter}>
        <Link to="/scan" className={styles.actionBtn}>
          <Upload size={16} /> Scan Scontrino
        </Link>
        {user && (
          <div className={styles.userSection}>
            <div className={styles.userInfo}>
              <div className={styles.userAvatar}>
                {user.display_name ? user.display_name.charAt(0).toUpperCase() : '?'}
              </div>
              <span className={styles.userName}>{user.display_name}</span>
            </div>
            <button onClick={logout} className={styles.logoutBtn} title="Cambia utente">
              <ArrowLeftRight size={18} />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
};

export const MobileNavigation: React.FC = () => {
  const location = useLocation();
  const mobileItems = [
    ...navItems,
    { path: '/scan', label: 'Scan', icon: <Upload size={20} /> },
  ];
  const isActive = (path: string) => (
    path === '/' ? location.pathname === '/' : location.pathname.startsWith(path)
  );

  return (
    <nav className={styles.mobileNav} aria-label="Navigazione mobile">
      {mobileItems.map(item => (
        <Link
          key={item.path}
          to={item.path}
          className={`${styles.mobileNavLink} ${isActive(item.path) ? styles.mobileActive : ''}`}
        >
          {item.icon}
          <span>{item.label}</span>
        </Link>
      ))}
    </nav>
  );
};
