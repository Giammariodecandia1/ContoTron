import { useCallback, useEffect, useState } from 'react';
import {
  getPersonalDriveConnection,
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
