import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '../ui/Button';
import { useHouseholdMembers } from '../../hooks';
import { listInternalDocuments, migrateInternalDocument, type MigrationProgress } from '../../lib/archiveDriveMigration';
import { supabase } from '../../lib/supabaseClient';
import type { Document, Household } from '../../types/database';
import styles from './ArchiveMigrationPanel.module.css';

interface ArchiveMigrationPanelProps {
  household: Household;
  userId: string;
  driveReady: boolean;
}

export const ArchiveMigrationPanel: React.FC<ArchiveMigrationPanelProps> = ({ household, userId, driveReady }) => {
  const { isOwner } = useHouseholdMembers();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [migrating, setMigrating] = useState(false);
  const [progress, setProgress] = useState<MigrationProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recommendedBy, setRecommendedBy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [legacyDocuments, transition] = await Promise.all([
        listInternalDocuments(household.id),
        supabase.from('document_drive_transition').select('recommended_by').eq('id', 1).maybeSingle(),
      ]);
      setDocuments(legacyDocuments);
      if (!transition.error) setRecommendedBy(transition.data?.recommended_by || null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Non riesco a contare i documenti da trasferire.');
    } finally {
      setLoading(false);
    }
  }, [household.id]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const mine = useMemo(() => documents.filter(document => document.uploaded_by === userId), [documents, userId]);
  const unassigned = useMemo(() => documents.filter(document => !document.uploaded_by), [documents]);
  const others = documents.length - mine.length - unassigned.length;
  const transferable = isOwner ? [...mine, ...unassigned] : mine;

  const migrateAll = async () => {
    if (migrating || !driveReady || transferable.length === 0) return;
    setMigrating(true);
    setError(null);
    const next: MigrationProgress = {
      completed: 0,
      total: transferable.length,
      currentName: '',
      failed: [],
    };
    setProgress({ ...next });
    try {
      for (const document of transferable) {
        next.currentName = document.vendor_name || document.original_filename;
        setProgress({ ...next });
        try {
          await migrateInternalDocument(household, userId, document);
          next.completed += 1;
        } catch (cause) {
          next.failed.push({
            id: document.id,
            name: next.currentName,
            error: cause instanceof Error ? cause.message : 'Errore sconosciuto',
          });
        }
        setProgress({ ...next });
      }
      next.currentName = '';
      setProgress({ ...next });
      await load();
    } finally {
      setMigrating(false);
    }
  };

  return (
    <section id="migrazione-drive" className={styles.panel} aria-labelledby="migration-title">
      <h3 id="migration-title">Trasferisci il vecchio archivio</h3>
      <p>
        I nuovi scontrini vanno solo sul tuo Google Drive. Ti consigliamo di trasferire i vecchi file
        {recommendedBy
          ? ` entro il ${new Date(recommendedBy).toLocaleDateString('it-IT')}`
          : ' entro una settimana dall’aggiornamento'}. Quelli non ancora trasferiti restano consultabili e
        potrai migrarli anche dopo: nessun file viene cancellato automaticamente.
      </p>
      {loading ? <p>Controllo dei documenti in corso...</p> : (
        <>
          <p className={styles.count}>
            Da trasferire nel tuo Drive: <strong>{transferable.length}</strong>
            {isOwner && unassigned.length > 0 && ` (inclusi ${unassigned.length} senza autore registrato)`}
          </p>
          {others > 0 && <p className={styles.muted}>{others} documenti appartengono ad altri componenti: ciascuno li trasferirà nel proprio Drive dal proprio account.</p>}
          {transferable.length > 0 && (
            <Button type="button" size="sm" onClick={() => void migrateAll()} disabled={!driveReady || migrating}>
              {migrating ? 'Trasferimento in corso...' : `Trasferisci ${transferable.length} documenti`}
            </Button>
          )}
          {!driveReady && transferable.length > 0 && <p className={styles.warning}>Collega prima il tuo Google Drive qui sopra.</p>}
          {transferable.length === 0 && <p className={styles.success}>Nessun tuo documento da trasferire.</p>}
        </>
      )}
      {progress && (
        <div className={styles.progress} role="status" aria-live="polite">
          <strong>{progress.completed} di {progress.total} trasferiti</strong>
          {progress.currentName && <span>Ora: {progress.currentName}</span>}
          {progress.failed.length > 0 && (
            <div className={styles.warning}>
              {progress.failed.length} non riusciti. I file originali restano nell&apos;archivio interno; puoi riprovare.
              <ul>{progress.failed.map(item => <li key={item.id}>{item.name}: {item.error}</li>)}</ul>
            </div>
          )}
        </div>
      )}
      {error && <p className={styles.warning}>{error}</p>}
    </section>
  );
};
