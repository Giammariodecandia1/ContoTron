import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Copy, Plus, RefreshCw, ShieldCheck, Trash2, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { supabase } from '../lib/supabaseClient';
import { useAuth, useHousehold } from '../hooks';
import type { MemberRole } from '../types/database';
import styles from './HouseholdMembersPage.module.css';

type MemberWithProfile = {
  id: string;
  user_id: string;
  role: MemberRole;
  created_at: string;
  profiles: {
    display_name: string | null;
    email: string | null;
  } | null;
};

type RoleOption = Exclude<MemberRole, 'owner'>;

const roleLabels: Record<MemberRole, string> = {
  owner: 'Proprietario',
  editor: 'Editor',
  viewer: 'Solo lettura',
};

const roleHelp: Record<MemberRole, string> = {
  owner: 'Gestisce nucleo, membri e dati condivisi.',
  editor: 'Puo aggiungere e modificare spese, documenti, budget e categorie.',
  viewer: 'Puo consultare dati e report, senza modificare.',
};

const roleVariant: Record<MemberRole, 'success' | 'info' | 'neutral'> = {
  owner: 'success',
  editor: 'info',
  viewer: 'neutral',
};

const getErrorMessage = (error: unknown) => {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: string }).message || '');
  }
  return '';
};

export const HouseholdMembersPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { household, refreshData } = useHousehold();
  const householdId = household?.id || null;
  const [members, setMembers] = useState<MemberWithProfile[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<RoleOption>('editor');
  const [householdName, setHouseholdName] = useState('');
  const [householdNameDirty, setHouseholdNameDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const currentMember = useMemo(
    () => members.find(member => member.user_id === user?.id) || null,
    [members, user?.id],
  );
  const isOwner = currentMember?.role === 'owner';
  const inviteCode = household?.invite_code || '';

  useEffect(() => {
    if (householdNameDirty) return;

    const syncTimer = window.setTimeout(() => {
      setHouseholdName(household?.name || '');
    }, 0);

    return () => window.clearTimeout(syncTimer);
  }, [household?.name, householdNameDirty]);

  const loadMembers = useCallback(async () => {
    if (!householdId) return;

    setLoading(true);
    setErrorMessage(null);

    try {
      const { data, error } = await supabase
        .from('household_members')
        .select(`
          id,
          user_id,
          role,
          created_at,
          profiles!household_members_user_id_fkey (
            display_name,
            email
          )
        `)
        .eq('household_id', householdId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setMembers((data || []) as unknown as MemberWithProfile[]);
    } catch (err) {
      console.error('Errore caricamento membri nucleo:', err);
      setErrorMessage('Non riesco a caricare i membri del nucleo familiare.');
    } finally {
      setLoading(false);
    }
  }, [householdId]);

  useEffect(() => {
    const loadTimer = window.setTimeout(() => {
      void loadMembers();
    }, 0);

    return () => window.clearTimeout(loadTimer);
  }, [loadMembers]);

  const handleAddMember = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!household || !email.trim()) return;

    setSaving(true);
    setMessage(null);
    setErrorMessage(null);

    try {
      const { error } = await supabase.rpc('add_household_member_by_email' as never, {
        target_household_id: household.id,
        member_email: email.trim(),
        member_role_value: role,
      } as never);

      if (error) throw error;

      setEmail('');
      setRole('editor');
      await loadMembers();
      await refreshData();
      setMessage('Account associato a questo nucleo. Se era in un altro nucleo, verra spostato qui.');
    } catch (err) {
      console.error('Errore aggiunta membro nucleo:', err);
      const detail = getErrorMessage(err);
      if (detail.includes('function') || detail.includes('schema cache')) {
        setErrorMessage('La funzione database per aggiungere e spostare membri non e ancora attiva. Applica la migration 011 su Supabase.');
      } else {
        setErrorMessage(detail || 'Non riesco ad aggiungere questo account. Verifica che sia gia registrato a Contotron.');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleCopyInviteCode = async () => {
    if (!inviteCode) {
      setErrorMessage('Il codice invito non e ancora disponibile. Applica la migration 011 su Supabase.');
      return;
    }

    try {
      await navigator.clipboard.writeText(inviteCode);
      setMessage('Codice invito copiato.');
      setErrorMessage(null);
    } catch {
      setErrorMessage(`Codice invito: ${inviteCode}`);
    }
  };

  const handleUpdateHouseholdName = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!household || !isOwner) return;

    const nextName = householdName.trim();
    if (!nextName) {
      setErrorMessage('Inserisci un nome valido per il nucleo.');
      setMessage(null);
      return;
    }

    if (nextName === household.name) {
      setMessage('Nome nucleo gia aggiornato.');
      setErrorMessage(null);
      return;
    }

    setSaving(true);
    setMessage(null);
    setErrorMessage(null);

    try {
      const { error } = await supabase
        .from('households')
        .update({
          name: nextName,
          updated_at: new Date().toISOString(),
        })
        .eq('id', household.id);

      if (error) throw error;
      await refreshData();
      setHouseholdNameDirty(false);
      setMessage('Nome nucleo aggiornato.');
    } catch (err) {
      console.error('Errore aggiornamento nome nucleo:', err);
      setErrorMessage(getErrorMessage(err) || 'Non riesco ad aggiornare il nome del nucleo.');
    } finally {
      setSaving(false);
    }
  };

  const handleRoleChange = async (member: MemberWithProfile, nextRole: RoleOption) => {
    if (!household || member.role === 'owner' || member.user_id === user?.id) return;

    setSaving(true);
    setMessage(null);
    setErrorMessage(null);

    try {
      const { error } = await supabase
        .from('household_members')
        .update({ role: nextRole })
        .eq('id', member.id)
        .eq('household_id', household.id);

      if (error) throw error;
      await loadMembers();
      setMessage('Ruolo aggiornato.');
    } catch (err) {
      console.error('Errore aggiornamento ruolo membro:', err);
      setErrorMessage('Non riesco ad aggiornare il ruolo del membro.');
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveMember = async (member: MemberWithProfile) => {
    if (!household || member.role === 'owner' || member.user_id === user?.id) return;

    const label = member.profiles?.display_name || member.profiles?.email || 'questo membro';
    if (!window.confirm(`Rimuovere ${label} dal nucleo familiare? Non vedra piu i dati condivisi.`)) {
      return;
    }

    setSaving(true);
    setMessage(null);
    setErrorMessage(null);

    try {
      const { error } = await supabase
        .from('household_members')
        .delete()
        .eq('id', member.id)
        .eq('household_id', household.id);

      if (error) throw error;
      await loadMembers();
      setMessage('Membro rimosso dal nucleo familiare.');
    } catch (err) {
      console.error('Errore rimozione membro nucleo:', err);
      setErrorMessage('Non riesco a rimuovere questo membro.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerContent}>
          <Button variant="ghost" icon={<ArrowLeft size={18} />} onClick={() => navigate('/impostazioni')}>
            Indietro
          </Button>
          <div>
            <h1 className={styles.title}>Nucleo Familiare</h1>
            <p className="text-muted">
              Gestisci chi puo usare il conto comune di {household?.name || 'Contotron'}.
            </p>
          </div>
        </div>
      </header>

      <div className={styles.grid}>
        <div className={styles.mainStack}>
          <Card title="Nucleo attivo" icon={<Users size={20} />}>
            {message && <div className={`${styles.banner} ${styles.success}`}>{message}</div>}
            {errorMessage && <div className={`${styles.banner} ${styles.error}`}>{errorMessage}</div>}

            <div className={styles.householdSummary}>
              <div>
                <span>Nome nucleo</span>
                <strong>{household?.name || 'Nucleo Contotron'}</strong>
              </div>
              <div>
                <span>Membri</span>
                <strong>{loading ? '...' : members.length}</strong>
              </div>
              <div>
                <span>Codice invito</span>
                <div className={styles.inviteCodeRow}>
                  <strong>{inviteCode || 'Da attivare'}</strong>
                  <button
                    type="button"
                    className={styles.iconButton}
                    onClick={handleCopyInviteCode}
                    title="Copia codice invito"
                  >
                    <Copy size={16} />
                  </button>
                </div>
              </div>
            </div>

            {isOwner && (
              <form className={styles.nameForm} onSubmit={handleUpdateHouseholdName}>
                <label className={styles.label} htmlFor="household-name">Modifica nome nucleo</label>
                <div className={styles.nameInputRow}>
                  <input
                    id="household-name"
                    className={styles.input}
                    value={householdName}
                    disabled={saving}
                    onChange={event => {
                      setHouseholdNameDirty(true);
                      setHouseholdName(event.target.value);
                    }}
                    placeholder="Nome nucleo"
                  />
                  <Button
                    type="submit"
                    size="sm"
                    disabled={saving || !householdName.trim()}
                  >
                    Salva nome
                  </Button>
                </div>
              </form>
            )}

            <p className={styles.ruleText}>
              Ogni account puo essere collegato a un solo nucleo alla volta. Se un account entra qui, viene scollegato dal nucleo precedente.
            </p>

            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCw size={16} />}
              onClick={loadMembers}
              disabled={loading}
            >
              Aggiorna membri
            </Button>
          </Card>

          <Card title="Membri" icon={<Users size={20} />}>
            {loading ? (
              <p className="text-muted fs-sm">Caricamento membri...</p>
            ) : (
              <div className={styles.memberList}>
                {members.map(member => {
                  const isCurrentUser = member.user_id === user?.id;
                  const displayName = member.profiles?.display_name || 'Utente Contotron';
                  const emailLabel = member.profiles?.email || 'Email non disponibile';
                  const canManageMember = isOwner && !isCurrentUser && member.role !== 'owner';

                  return (
                    <div key={member.id} className={styles.memberRow}>
                      <div className={styles.memberIdentity}>
                        <div className={styles.avatar}>
                          {(displayName || emailLabel).charAt(0).toUpperCase()}
                        </div>
                        <div className={styles.memberText}>
                          <div className={styles.memberName}>
                            {displayName}
                            {isCurrentUser && <span className={styles.youLabel}>Tu</span>}
                          </div>
                          <div className={styles.memberEmail}>{emailLabel}</div>
                          <div className={styles.roleHint}>{roleHelp[member.role]}</div>
                        </div>
                      </div>

                      <div className={styles.memberActions}>
                        <Badge variant={roleVariant[member.role]}>{roleLabels[member.role]}</Badge>

                        {canManageMember && (
                          <>
                            <select
                              className={styles.select}
                              value={member.role}
                              disabled={saving}
                              onChange={event => handleRoleChange(member, event.target.value as RoleOption)}
                              aria-label={`Cambia ruolo di ${displayName}`}
                            >
                              <option value="editor">Editor</option>
                              <option value="viewer">Solo lettura</option>
                            </select>
                            <button
                              className={styles.iconButton}
                              onClick={() => handleRemoveMember(member)}
                              disabled={saving}
                              title="Rimuovi membro"
                              type="button"
                            >
                              <Trash2 size={16} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        <div className={styles.sideStack}>
          <Card title="Aggiungi membro" icon={<Plus size={20} />}>
            {isOwner ? (
              <form onSubmit={handleAddMember} className={styles.form}>
                <label className={styles.label} htmlFor="member-email">Email account</label>
                <input
                  id="member-email"
                  className={styles.input}
                  type="email"
                  placeholder="esempio@email.com"
                  value={email}
                  disabled={saving}
                  onChange={event => setEmail(event.target.value)}
                />

                <label className={styles.label} htmlFor="member-role">Ruolo</label>
                <select
                  id="member-role"
                  className={styles.input}
                  value={role}
                  disabled={saving}
                  onChange={event => setRole(event.target.value as RoleOption)}
                >
                  <option value="editor">Editor: puo modificare</option>
                  <option value="viewer">Solo lettura: puo consultare</option>
                </select>

                <p className="text-muted fs-sm">
                  La persona deve prima registrarsi a Contotron con questa email. Dopo l'aggiunta verra associata a questo nucleo e vedra conti, documenti e report condivisi.
                </p>

                <Button type="submit" icon={<Plus size={16} />} disabled={saving || !email.trim()}>
                  Aggiungi al nucleo
                </Button>
              </form>
            ) : (
              <p className="text-muted fs-sm">
                Solo il proprietario del nucleo puo aggiungere o rimuovere membri.
              </p>
            )}
          </Card>

          <Card title="Privacy del nucleo" icon={<ShieldCheck size={20} />}>
            <ul className={styles.privacyList}>
              <li>Ogni nucleo vede solo i propri conti, transazioni, documenti e report.</li>
              <li>Categorie e sottocategorie sono indipendenti per ogni nucleo.</li>
              <li>Gli editor possono lavorare sulle spese condivise.</li>
              <li>I membri in sola lettura possono controllare i dati senza modificarli.</li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
};
