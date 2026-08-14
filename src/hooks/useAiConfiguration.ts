import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  getAiConfiguration,
  subscribeToAiConfiguration,
  type AiConfiguration,
} from '../lib/aiConfiguration';

export const useAiConfiguration = () => {
  const { user } = useAuth();
  const userId = user?.id || null;
  const readConfiguration = useCallback(
    (): AiConfiguration | null => getAiConfiguration(userId),
    [userId],
  );
  const [configuration, setConfiguration] = useState<AiConfiguration | null>(readConfiguration);

  useEffect(() => {
    const refresh = () => setConfiguration(readConfiguration());
    refresh();
    return subscribeToAiConfiguration(refresh);
  }, [readConfiguration]);

  return {
    configuration,
    isAiEnabled: Boolean(configuration),
  };
};
