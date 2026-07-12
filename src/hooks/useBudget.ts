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

      // Se ci sono già dati, li ritorniamo
      if (data && data.length > 0) {
        return data as BudgetTarget[];
      }

      // 2. PRECOMPILAZIONE (Auto-fill) se il mese corrente è vuoto
      // Cerchiamo i dati del mese precedente (stesso anno, o dicembre dell'anno precedente se mese = 1)
      const prevMonth = month === 1 ? 12 : month - 1;
      const prevYear = month === 1 ? year - 1 : year;

      const { data: prevData, error: prevError } = await supabase
        .from('budget_targets')
        .select('*')
        .eq('household_id', householdId)
        .eq('year', prevYear)
        .eq('month', prevMonth);

      if (prevError) throw prevError;

      // TODO in futuro: incrociare prevData con i dati storici dello *stesso mese* (es. Agosto dell'anno prima per le vacanze).
      // Per il momento facciamo la copia esatta del mese scorso (che è la regola più usata nell'Excel di partenza).

      if (prevData && prevData.length > 0) {
        // Cloniamo i dati per il mese corrente
        const newTargets = prevData.map(t => ({
          household_id: householdId,
          year,
          month,
          category_id: t.category_id,
          subcategory_id: t.subcategory_id,
          planned_amount: t.planned_amount,
          notes: t.notes
        }));

        // Salviamo i nuovi target precompilati
        const { data: insertedData, error: insertError } = await supabase
          .from('budget_targets')
          .insert(newTargets)
          .select();

        if (insertError) throw insertError;
        return (insertedData || []) as BudgetTarget[];
      }

      // Se non ci sono nemmeno dati del mese scorso, ritorna array vuoto (sarà l'utente a compilare da zero la prima volta)
      return [];
    } catch (err: unknown) {
      console.error('Error fetching/prefilling budget targets:', err);
      setError(errorMessage(err));
      return [];
    } finally {
      setLoading(false);
    }
  }, [householdId]);

  const upsertBudgetTarget = async (categoryId: string, amount: number, year: number, month: number) => {
    if (!householdId) return null;
    
    // Non settare loading a true qui, altrimenti l'UI scatta ad ogni tasto
    try {
      const { data: existingRows, error: lookupError } = await supabase
        .from('budget_targets')
        .select('id')
        .eq('household_id', householdId)
        .eq('year', year)
        .eq('month', month)
        .eq('category_id', categoryId)
        .is('subcategory_id', null)
        .order('updated_at', { ascending: false })
        .limit(1);

      if (lookupError) throw lookupError;

      const existingId = existingRows?.[0]?.id;
      if (existingId) {
        const { data, error: updateError } = await supabase
          .from('budget_targets')
          .update({ planned_amount: amount, updated_at: new Date().toISOString() })
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
          subcategory_id: null,
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
