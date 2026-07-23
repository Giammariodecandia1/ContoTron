import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useHousehold } from '../contexts/HouseholdContext';
import type { BudgetTarget } from '../types/database';

const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

export const useBudget = () => {
  const { household } = useHousehold();
  const householdId = household?.id || null;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchBudgetTargets = useCallback(async (year: number, month: number): Promise<BudgetTarget[]> => {
    if (!householdId) return [];
    
    setLoading(true);
    setError(null);
    try {
      // 1. Try to fetch current month's targets
      const { data, error: fetchError } = await supabase
        .from('budget_targets')
        .select('*')
        .eq('household_id', householdId)
        .eq('year', year)
        .eq('month', month);

      if (fetchError) throw fetchError;

      // I budget dei mesi restano indipendenti. Le sole cifre automatiche
      // arrivano dalle spese fisse attive quando il mese ha inizio.
      return (data || []) as BudgetTarget[];
    } catch (err: unknown) {
      console.error('Error fetching/prefilling budget targets:', err);
      setError(errorMessage(err));
      return [];
    } finally {
      setLoading(false);
    }
  }, [householdId]);

  const upsertBudgetTarget = async (
    categoryId: string,
    amount: number,
    year: number,
    month: number,
    subcategoryId: string | null = null,
  ) => {
    if (!householdId) return null;
    
    // Non settare loading a true qui, altrimenti l'UI scatta ad ogni tasto
    try {
      const baseLookup = supabase
        .from('budget_targets')
        .select('id')
        .eq('household_id', householdId)
        .eq('year', year)
        .eq('month', month)
        .eq('category_id', categoryId);
      const lookup = subcategoryId
        ? baseLookup.eq('subcategory_id', subcategoryId)
        : baseLookup.is('subcategory_id', null);
      const { data: existingRows, error: lookupError } = await lookup
        .order('updated_at', { ascending: false })
        .limit(1);

      if (lookupError) throw lookupError;

      const existingId = existingRows?.[0]?.id;
      if (existingId) {
        const { data, error: updateError } = await supabase
          .from('budget_targets')
          .update({
            planned_amount: amount,
            notes: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingId)
          .eq('household_id', householdId)
          .select()
          .single();

        if (updateError) throw updateError;
        return data as BudgetTarget;
      }

      const { data, error: insertError } = await supabase
        .from('budget_targets')
        .insert({
          household_id: householdId,
          year,
          month,
          category_id: categoryId,
          subcategory_id: subcategoryId,
          planned_amount: amount,
        })
        .select()
        .single();

      if (insertError) throw insertError;
      return data as BudgetTarget;
    } catch (err: unknown) {
      console.error('Error saving budget target:', err);
      return null;
    }
  };

  return {
    fetchBudgetTargets,
    upsertBudgetTarget,
    loading,
    error
  };
};
