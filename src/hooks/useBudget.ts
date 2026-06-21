import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useHousehold } from '../contexts/HouseholdContext';
import type { BudgetTarget } from '../types/database';

export const useBudget = () => {
  const { household } = useHousehold();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchBudgetTargets = useCallback(async (year: number, month: number): Promise<BudgetTarget[]> => {
    if (!household) return [];
    
    setLoading(true);
    setError(null);
    try {
      // 1. Try to fetch current month's targets
      const { data, error: fetchError } = await supabase
        .from('budget_targets')
        .select('*')
        .eq('household_id', household.id)
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
        .eq('household_id', household.id)
        .eq('year', prevYear)
        .eq('month', prevMonth);

      if (prevError) throw prevError;

      // TODO in futuro: incrociare prevData con i dati storici dello *stesso mese* (es. Agosto dell'anno prima per le vacanze).
      // Per il momento facciamo la copia esatta del mese scorso (che è la regola più usata nell'Excel di partenza).

      if (prevData && prevData.length > 0) {
        // Cloniamo i dati per il mese corrente
        const newTargets = prevData.map(t => ({
          household_id: household.id,
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
    } catch (err: any) {
      console.error('Error fetching/prefilling budget targets:', err);
      setError(err.message);
      return [];
    } finally {
      setLoading(false);
    }
  }, [household]);

  const upsertBudgetTarget = async (categoryId: string, amount: number, year: number, month: number) => {
    if (!household) return null;
    
    // Non settare loading a true qui, altrimenti l'UI scatta ad ogni tasto
    try {
      // Usa upsert su household_id, year, month, category_id
      const { data, error: upsertError } = await supabase
        .from('budget_targets')
        .upsert({
          household_id: household.id,
          year,
          month,
          category_id: categoryId,
          planned_amount: amount
        }, { onConflict: 'household_id,year,month,category_id,subcategory_id' }) // supabase richiede i campi dell'indice unique
        .select()
        .single();

      if (upsertError) throw upsertError;
      return data as BudgetTarget;
    } catch (err: any) {
      console.error('Error upserting budget target:', err);
      // Fallback manuale in caso onConflict dia problemi se subcategory_id è null e non fa match
      try {
        // Cerca se esiste
        const { data: existing } = await supabase.from('budget_targets')
          .select('id')
          .eq('household_id', household.id).eq('year', year).eq('month', month).eq('category_id', categoryId)
          .single();
          
        if (existing) {
          const { data: updated } = await supabase.from('budget_targets')
            .update({ planned_amount: amount }).eq('id', existing.id).select().single();
          return updated;
        } else {
          const { data: inserted } = await supabase.from('budget_targets')
            .insert({ household_id: household.id, year, month, category_id: categoryId, planned_amount: amount }).select().single();
          return inserted;
        }
      } catch (fallbackErr) {
        console.error("Fallback error", fallbackErr);
      }
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
