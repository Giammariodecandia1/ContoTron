import React, { useEffect, useState } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { supabase } from '../lib/supabaseClient';
import { UserPlus, X } from 'lucide-react';
import { useAuth } from '../hooks';
import type { Profile } from '../types/database';
import styles from './UserSelectPage.module.css';

export const UserSelectPage: React.FC = () => {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [newUserName, setNewUserName] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const { loginAs } = useAuth();

  const fetchProfiles = async () => {
    setLoading(true);
    const { data } = await supabase.from('profiles').select('*').order('display_name');
    if (data) setProfiles(data);
    setLoading(false);
  };

  useEffect(() => {
    const timer = window.setTimeout(() => void fetchProfiles(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserName.trim()) return;
    
    setLoading(true);
    const { data } = await supabase
      .from('profiles')
      .insert({ display_name: newUserName.trim() })
      .select()
      .single();
      
    if (data) {
      setNewUserName('');
      setShowAdd(false);
      await fetchProfiles();
    }
    setLoading(false);
  };

  const handleDeleteUser = async (id: string, name: string) => {
    // Check if the user owns any households
    const { data: households } = await supabase
      .from('households')
      .select('id, name')
      .eq('created_by', id);

    const hasHouseholds = households && households.length > 0;
    
    let confirmMessage = `Sei sicuro di voler eliminare il profilo "${name}"? Questa azione non può essere annullata.`;
    if (hasHouseholds) {
      confirmMessage = `ATTENZIONE: Il profilo "${name}" ha creato ${households.length} nucleo/i familiare/i (es. "${households[0].name}"). Eliminandolo, verranno rimossi TUTTI i dati associati (transazioni, categorie, budget). Vuoi procedere?`;
    }

    if (!window.confirm(confirmMessage)) {
      return;
    }

    setLoading(true);
    
    try {
      // If the user owns households, delete them first to trigger cascade deletion
      if (hasHouseholds) {
        for (const hh of households) {
          const { error: hhError } = await supabase
            .from('households')
            .delete()
            .eq('id', hh.id);
            
          if (hhError) throw hhError;
        }
      }

      // Clear any foreign key dependencies to allow deletion if not cascade deleting
      // 1. Transactions inserted_by
      await supabase.from('transactions').update({ inserted_by: null }).eq('inserted_by', id);
      // 2. Transactions reviewed_by
      await supabase.from('transactions').update({ reviewed_by: null }).eq('reviewed_by', id);
      // 3. Classification rules created_by
      await supabase.from('classification_rules').update({ created_by: null }).eq('created_by', id);

      // Now delete the profile
      const { error } = await supabase
        .from('profiles')
        .delete()
        .eq('id', id);

      if (error) throw error;
      
    } catch (error) {
      console.error('Error deleting profile:', error);
      alert('Impossibile eliminare il profilo. Potrebbe avere altri dati associati che impediscono la rimozione.');
    } finally {
      await fetchProfiles();
      setLoading(false);
    }
  };

  return (
    <div className={styles.page}>
      <Card className={styles.card}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <h2>Chi sei?</h2>
          <p className="text-muted">Seleziona il tuo profilo per entrare</p>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center' }}>Caricamento...</div>
        ) : profiles.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2rem 0' }}>
            <p className="text-muted" style={{ marginBottom: '1rem' }}>Nessun profilo trovato. Aggiungi il primo utente per iniziare.</p>
          </div>
        ) : (
          <div className={styles.grid}>
            {profiles.map(p => (
              <div key={p.id} className={styles.userWrapper}>
                <button 
                  className={styles.userBtn}
                  onClick={() => loginAs(p)}
                >
                  <div className={styles.avatar}>
                    {p.display_name ? p.display_name.charAt(0).toUpperCase() : '?'}
                  </div>
                  <span>{p.display_name || 'Senza Nome'}</span>
                </button>
                <button
                  className={styles.deleteBtn}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteUser(p.id, p.display_name || 'Senza Nome');
                  }}
                  title="Elimina profilo"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        {!showAdd ? (
          <Button 
            variant="ghost" 
            className="w-full mt-4" 
            icon={<UserPlus size={18}/>}
            onClick={() => setShowAdd(true)}
          >
            Aggiungi Persona
          </Button>
        ) : (
          <form onSubmit={handleAddUser} className={styles.addForm}>
            <input 
              type="text" 
              placeholder="Nome della persona" 
              required
              value={newUserName}
              onChange={e => setNewUserName(e.target.value)}
              className={styles.input}
            />
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
              <Button type="button" variant="secondary" onClick={() => setShowAdd(false)} className="w-full">Annulla</Button>
              <Button type="submit" className="w-full" disabled={loading}>Salva</Button>
            </div>
          </form>
        )}
      </Card>
    </div>
  );
};
