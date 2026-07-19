import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from './AuthContext';
import type { Household, Account, Category, Subcategory } from '../types/database';

interface HouseholdContextType {
  household: Household | null;
  accounts: Account[];
  categories: Category[];
  subcategories: Subcategory[];
  loading: boolean;
  refreshData: () => Promise<void>;
}

const HouseholdContext = createContext<HouseholdContextType>({
  household: null,
  accounts: [],
  categories: [],
  subcategories: [],
  loading: true,
  refreshData: async () => {},
});

export const HouseholdProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [household, setHousehold] = useState<Household | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);
  const [loadedUserId, setLoadedUserId] = useState<string | null>(null);

  const fetchHouseholdData = useCallback(async () => {
    if (!userId) {
      setHousehold(null);
      setAccounts([]);
      setCategories([]);
      setSubcategories([]);
      setLoadedUserId(null);
      return;
    }

    try {
      const { data: membership } = await supabase
        .from('household_members')
        .select('household_id')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!membership) {
        setHousehold(null);
        setAccounts([]);
        setCategories([]);
        setSubcategories([]);
        setLoadedUserId(userId);
        return;
      }

      const { data: hhData } = await supabase
        .from('households')
        .select('*')
        .eq('id', membership.household_id)
        .single();

      if (!hhData) {
        return;
      }

      setHousehold(current => {
        if (
          current
          && current.id === hhData.id
          && current.name === hhData.name
          && current.updated_at === hhData.updated_at
          && current.invite_code === hhData.invite_code
        ) {
          return current;
        }

        return hhData;
      });

      // Fetch accounts
      const { data: accData } = await supabase
        .from('accounts')
        .select('*')
        .eq('household_id', hhData.id)
        .order('name');
      
      let accountsToSet = accData || [];
      if (accountsToSet.length === 0) {
        const { data: insertedAcc } = await supabase.from('accounts').insert([{
          household_id: hhData.id,
          name: 'Conto Principale',
          type: 'current_account',
          opening_balance: 0
        }]).select();
        
        if (insertedAcc) {
          accountsToSet = insertedAcc;
        }
      }
      setAccounts(accountsToSet);

      // Fetch categories
      const { data: catData } = await supabase
        .from('categories')
        .select('*')
        .eq('household_id', hhData.id)
        .order('name');
      
      let categoriesToSet = catData || [];

      // Auto-populate from Excel template if no categories exist
      if (categoriesToSet.length === 0) {
        const defaultCats = [
          { household_id: hhData.id, name: 'Alimentari', type: 'expense', sort_order: 1 },
          { household_id: hhData.id, name: 'Abitazione', type: 'expense', sort_order: 2 },
          { household_id: hhData.id, name: 'Trasporti', type: 'expense', sort_order: 3 },
          { household_id: hhData.id, name: 'Abbigliamento', type: 'expense', sort_order: 4 },
          { household_id: hhData.id, name: 'Tempo libero', type: 'expense', sort_order: 5 },
          { household_id: hhData.id, name: 'Cura della persona', type: 'expense', sort_order: 6 },
          { household_id: hhData.id, name: 'Assicurazione', type: 'expense', sort_order: 7 },
          { household_id: hhData.id, name: 'Imposte', type: 'expense', sort_order: 8 },
          { household_id: hhData.id, name: 'Regali e beneficenza', type: 'expense', sort_order: 9 },
          { household_id: hhData.id, name: 'Risparmi', type: 'expense', sort_order: 10 },
          { household_id: hhData.id, name: 'Prestiti', type: 'expense', sort_order: 11 },
          { household_id: hhData.id, name: 'Stipendio', type: 'income', sort_order: 1 },
          { household_id: hhData.id, name: 'Altre entrate', type: 'income', sort_order: 2 }
        ];
        
        const { data: insertedCats } = await supabase.from('categories').insert(defaultCats).select();
        if (insertedCats) {
          categoriesToSet = insertedCats;
        }
      }
      
      setCategories(categoriesToSet);

      // Fetch subcategories
      const { data: subData } = await supabase
        .from('subcategories')
        .select('*')
        .eq('household_id', hhData.id)
        .eq('is_active', true)
        .order('sort_order');
        
      setSubcategories(subData || []);

    } catch (error) {
      console.error("Errore caricamento dati household:", error);
    } finally {
      if (userId) {
        setLoadedUserId(userId);
      }
    }
  }, [userId]);

  useEffect(() => {
    const loadTimer = window.setTimeout(() => {
      void fetchHouseholdData();
    }, 0);

    return () => window.clearTimeout(loadTimer);
  }, [fetchHouseholdData]);

  const effectiveLoading = !!userId && loadedUserId !== userId;

  return (
    <HouseholdContext.Provider value={{ 
      household, 
      accounts, 
      categories, 
      subcategories, 
      loading: effectiveLoading,
      refreshData: fetchHouseholdData
    }}>
      {children}
    </HouseholdContext.Provider>
  );
};

// Context hooks intentionally live beside their provider.
// eslint-disable-next-line react-refresh/only-export-components
export const useHousehold = () => {
  const context = useContext(HouseholdContext);
  if (context === undefined) {
    throw new Error('useHousehold must be used within a HouseholdProvider');
  }
  return context;
};
