import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { useHousehold } from '../contexts/HouseholdContext';
import type { MemberRole } from '../types/database';

export interface HouseholdMemberOption {
  userId: string;
  role: MemberRole;
  displayName: string;
  email: string | null;
}

export const useHouseholdMembers = () => {
  const { household } = useHousehold();
  const { user } = useAuth();
  const [members, setMembers] = useState<HouseholdMemberOption[]>([]);
  const [loadedHouseholdId, setLoadedHouseholdId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!household?.id) return;

    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('household_members')
        .select('user_id, role, profiles!household_members_user_id_fkey(display_name, email)')
        .eq('household_id', household.id)
        .order('created_at');

      if (!cancelled) {
        if (error) {
          console.warn('Elenco componenti non disponibile:', error);
          setMembers([]);
        } else {
          setMembers((data || []).map(row => {
            const profile = row.profiles as unknown as { display_name?: string | null; email?: string | null } | null;
            return {
              userId: row.user_id,
              role: row.role as MemberRole,
              displayName: profile?.display_name || profile?.email || 'Componente',
              email: profile?.email || null,
            };
          }));
        }
        setLoadedHouseholdId(household.id);
        setLoading(false);
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [household?.id]);

  const effectiveMembers = useMemo(
    () => household?.id === loadedHouseholdId ? members : [],
    [household?.id, loadedHouseholdId, members],
  );
  const currentMembership = useMemo(
    () => effectiveMembers.find(member => member.userId === user?.id) || null,
    [effectiveMembers, user?.id],
  );

  return {
    members: effectiveMembers,
    loading,
    isOwner: currentMembership?.role === 'owner',
  };
};
