import { useCallback, useEffect, useState } from 'react';
import {
  GoogleDriveAuthError,
  getPersonalDriveConnection,
  verifyGoogleDriveFolder,
  type PersonalDriveConnection,
} from '../lib/googleDriveStorage';
import type { Household } from '../types/database';

export const usePersonalDriveConnection = (
  household?: Household | null,
  userId?: string | null,
) => {
  const [connection, setConnection] = useState<PersonalDriveConnection | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!household || !userId) {
      setConnection(null);
      setError(null);
      setLoading(false);
      return null;
    }

    setLoading(true);
    setError(null);
    try {
      const nextConnection = await getPersonalDriveConnection(household, userId);
      if (nextConnection.status === 'ready' && nextConnection.folderId) {
        try {
          const verifiedFolder = await verifyGoogleDriveFolder(nextConnection.folderId);
          const verifiedConnection = {
            ...nextConnection,
            folderName: verifiedFolder.name || nextConnection.folderName,
          };
          setConnection(verifiedConnection);
          return verifiedConnection;
        } catch (verificationError) {
          const unavailableConnection: PersonalDriveConnection = {
            ...nextConnection,
            status: 'connection_error',
          };
          setConnection(unavailableConnection);
          setError(verificationError instanceof GoogleDriveAuthError
            ? 'L autorizzazione Google Drive e scaduta o non e disponibile in questo browser. Premi Ricollega Google Drive.'
            : verificationError instanceof Error
              ? verificationError.message
              : 'Impossibile verificare la cartella Google Drive.');
          return unavailableConnection;
        }
      }
      setConnection(nextConnection);
      return nextConnection;
    } catch (connectionError) {
      setConnection(null);
      setError(connectionError instanceof Error
        ? connectionError.message
        : 'Impossibile verificare il collegamento Google Drive.');
      return null;
    } finally {
      setLoading(false);
    }
  }, [household, userId]);

  useEffect(() => {
    const refreshTimer = window.setTimeout(() => {
      void refresh();
    }, 0);

    return () => window.clearTimeout(refreshTimer);
  }, [refresh]);

  return {
    connection,
    loading,
    error,
    refresh,
    setConnection,
  };
};
