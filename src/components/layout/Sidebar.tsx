import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Bot, Home, PieChart, List, FileText, Settings, Upload, LogOut, Search, BarChart3, TrendingUp, ShoppingBasket, Scale, PlusCircle } from 'lucide-react';
import { ContotronBrand } from '../brand/ContotronBrand';
import { useAiConfiguration, useAuth, useNavigationVisibility, useViewMode } from '../../hooks';
import styles from './AppLayout.module.css';

const navItems = [
  { path: '/dashboard', label: 'Dashboard', icon: <Home size={20} /> },
  { path: '/transazioni', label: 'Transazioni', icon: <List size={20} /> },
  { path: '/split', label: 'Split', icon: <Scale size={20} /> },
  { path: '/report', label: 'Consuntivo mensile', mobileLabel: 'Consuntivo', icon: <BarChart3 size={20} /> },
  { path: '/mensile', label: 'Budget Mensile', icon: <PieChart size={20} /> },
  { path: '/analisi-annuale', label: 'Analisi annuale', mobileLabel: 'Annuale', icon: <TrendingUp size={20} /> },
  { path: '/analisi-alimentari', label: 'Analisi alimentari', mobileLabel: 'Alimentari', icon: <ShoppingBasket size={20} /> },
  { path: '/documenti', label: 'Documenti', icon: <FileText size={20} /> },
  { path: '/ricerca', label: 'Ricerca', icon: <Search size={20} /> },
  { path: '/impostazioni', label: 'Impostazioni', icon: <Settings size={20} /> },
];

const simpleNavItems = [
  { path: '/dashboard', label: 'Riepilogo', icon: <Home size={20} /> },
  { path: '/transazioni/nuova', label: 'Aggiungi spesa', icon: <PlusCircle size={20} /> },
  { path: '/transazioni', label: 'Movimenti', icon: <List size={20} /> },
  { path: '/split', label: 'Split', icon: <Scale size={20} /> },
  { path: '/impostazioni', label: 'Impostazioni', icon: <Settings size={20} /> },
];

const pathIsActive = (pathname: string, path: string) => {
  if (path === '/transazioni') return pathname === path;
  if (path === '/transazioni/nuova') return pathname === path;
  return pathname.startsWith(path);
};

export const Sidebar: React.FC = () => {
  const location = useLocation();
  const { user, logout } = useAuth();
  const { isSimple } = useViewMode();
  const { isAiEnabled } = useAiConfiguration();
  const { isHidden } = useNavigationVisibility();
  const baseItems = isSimple ? simpleNavItems : navItems;
  const visibleItems = (isAiEnabled
    ? [...baseItems.slice(0, -1), { path: '/assistente', label: 'Assistente AI', icon: <Bot size={20} /> }, baseItems[baseItems.length - 1]]
    : baseItems).filter(item => !isHidden(item.path));
  const isActive = (path: string) => pathIsActive(location.pathname, path);

  return (
    <aside className={styles.sidebar}>
      <div className={styles.sidebarHeader}>
        <Link to="/" className={styles.brandLink} aria-label="Vai alla pagina iniziale">
          <ContotronBrand size="medium" />
        </Link>
        {isSimple && <span className={styles.simpleModeBadge}>Modalità semplice</span>}
      </div>
      <nav className={styles.sidebarNav}>
        {visibleItems.map(item => (
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
        {!isSimple && !isHidden('/scan') && (
          <Link to="/scan" className={styles.actionBtn}>
            <Upload size={16} /> Scan Scontrino
          </Link>
        )}
        {user && (
          <div className={styles.userSection}>
            <div className={styles.userInfo}>
              <div className={styles.userAvatar}>
                {user.display_name ? user.display_name.charAt(0).toUpperCase() : '?'}
              </div>
              <span className={styles.userName}>{user.display_name}</span>
            </div>
            <button onClick={logout} className={styles.logoutBtn} title="Esci dall'account">
              <LogOut size={18} />
              <span>Esci</span>
            </button>
          </div>
        )}
      </div>
    </aside>
  );
};

export const MobileNavigation: React.FC = () => {
  const location = useLocation();
  const { isSimple } = useViewMode();
  const { isAiEnabled } = useAiConfiguration();
  const { isHidden } = useNavigationVisibility();
  const baseMobileItems = isSimple
    ? simpleNavItems
    : [...navItems, { path: '/scan', label: 'Scan', icon: <Upload size={20} /> }];
  const mobileItems = (isAiEnabled
    ? [...baseMobileItems, { path: '/assistente', label: 'AI', icon: <Bot size={20} /> }]
    : baseMobileItems).filter(item => !isHidden(item.path));
  const isActive = (path: string) => pathIsActive(location.pathname, path);

  return (
    <nav className={styles.mobileNav} aria-label="Navigazione mobile">
      {mobileItems.map(item => (
        <Link
          key={item.path}
          to={item.path}
          className={`${styles.mobileNavLink} ${isActive(item.path) ? styles.mobileActive : ''}`}
        >
          {item.icon}
          <span>{'mobileLabel' in item && typeof item.mobileLabel === 'string' ? item.mobileLabel : item.label}</span>
        </Link>
      ))}
    </nav>
  );
};
