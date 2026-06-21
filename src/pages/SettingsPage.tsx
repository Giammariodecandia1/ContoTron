import React from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Settings as SettingsIcon, Users, Tag } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import styles from './SettingsPage.module.css';

export const SettingsPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Impostazioni</h1>
        <p className="text-muted">Configura il tuo nucleo familiare e le tue preferenze.</p>
      </header>

      <div className={styles.grid}>
        <Card title="Nucleo Familiare" icon={<Users size={20} />} action={<Button size="sm">Gestisci</Button>}>
          <p className="text-muted fs-sm">Invita altri membri della tua famiglia per condividere spese e budget.</p>
        </Card>

        <Card title="Gestione Categorie" icon={<Tag size={20} />} action={<Button size="sm" onClick={() => navigate('/impostazioni/categorie')}>Gestisci</Button>}>
          <p className="text-muted fs-sm">Aggiungi, modifica o rimuovi categorie e sottocategorie di spesa.</p>
        </Card>

        <Card title="Preferenze" icon={<SettingsIcon size={20} />} action={<Button size="sm">Modifica</Button>}>
          <p className="text-muted fs-sm">Modifica la valuta predefinita e la data di inizio del budget mensile.</p>
        </Card>
      </div>
    </div>
  );
};
