import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useHousehold } from '../contexts/HouseholdContext';
import { useAuth } from '../contexts/AuthContext';
import { toIsoDate } from '../lib/dates';
import type { Transaction } from '../types/database';

const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

export type TransactionItemDraft = {
  description: string;
  amount: number;
  category_id: string | null;
  subcategory_id: string | null;
  is_confirmed: boolean;
};

export const useTransactions = () => {
  const { household } = useHousehold();
  const { user } = useAuth();
  const householdId = household?.id || null;
  const budgetMonthStartDay = household?.budget_month_start_day || 1;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveClassificationRule = useCallback(async (transaction: Partial<Transaction>) => {
    if (!householdId || !transaction.merchant || !transaction.category_id) return;

    const merchantLower = transaction.merchant.trim().toLowerCase();
    const { data: existingRule } = await supabase
      .from('classification_rules')
      .select('id, use_count')
      .eq('household_id', householdId)
      .eq('match_text', merchantLower)
      .single();

    if (existingRule) {
      await supabase
        .from('classification_rules')
        .update({
          category_id: transaction.category_id,
          subcategory_id: transaction.subcategory_id || null,
          use_count: (existingRule.use_count || 0) + 1,
          last_used_at: new Date().toISOString()
        })
        .eq('id', existingRule.id);
    } else {
      await supabase
        .from('classification_rules')
        .insert([{
          household_id: householdId,
          match_text: merchantLower,
          merchant: transaction.merchant.trim(),
          category_id: transaction.category_id,
          subcategory_id: transaction.subcategory_id || null,
          created_by: user?.id || null,
          priority: 100,
          use_count: 1,
          last_used_at: new Date().toISOString()
        }]);
    }
  }, [householdId, user?.id]);

  const fetchTransactions = useCallback(async (
    month?: number,
    year?: number,
    categoryId?: string,
    dateBasis: 'transaction' | 'cash_impact' = 'transaction',
  ): Promise<Transaction[]> => {
    if (!householdId) return [];
    
    setLoading(true);
    setError(null);
    try {
      let query = supabase
        .from('transactions')
        .select(`
          *,
          accounts!transactions_account_id_fkey(name),
          categories(name),
          subcategories(name),
          inserted_by_profile:profiles!transactions_inserted_by_fkey(display_name, email)
        `)
        .eq('household_id', householdId)
        .order('transaction_date', { ascending: false })
        .order('created_at', { ascending: false });

      if (year && month) {
        // Budget and annual analysis use calendar months based on the date on
        // which the amount affects availability. The transaction list keeps
        // using the household's accounting-period start day.
        const startDay = dateBasis === 'cash_impact' ? 1 : budgetMonthStartDay;
        const startDate = toIsoDate(new Date(year, month - 1, startDay));
        const endDate = toIsoDate(new Date(year, month, startDay - 1));
        const dateColumn = dateBasis === 'cash_impact' ? 'cash_impact_date' : 'transaction_date';
        
        query = query.gte(dateColumn, startDate).lte(dateColumn, endDate);
      }

      if (categoryId) {
        query = query.eq('category_id', categoryId);
      }

      const { data, error: fetchError } = await query;

      if (fetchError) {
        console.warn('Caricamento dettagli transazioni fallito, uso elenco essenziale:', fetchError);
        let fallbackQuery = supabase
          .from('transactions')
          .select('*')
          .eq('household_id', householdId)
          .order('transaction_date', { ascending: false })
          .order('created_at', { ascending: false });

        if (year && month) {
          const startDay = dateBasis === 'cash_impact' ? 1 : budgetMonthStartDay;
          const startDate = toIsoDate(new Date(year, month - 1, startDay));
          const endDate = toIsoDate(new Date(year, month, startDay - 1));
          const dateColumn = dateBasis === 'cash_impact' ? 'cash_impact_date' : 'transaction_date';
          fallbackQuery = fallbackQuery.gte(dateColumn, startDate).lte(dateColumn, endDate);
        }
        if (categoryId) fallbackQuery = fallbackQuery.eq('category_id', categoryId);

        const { data: fallbackData, error: fallbackError } = await fallbackQuery;
        if (fallbackError) throw fallbackError;
        return (fallbackData || []) as Transaction[];
      }
      return (data || []) as Transaction[];
    } catch (err: unknown) {
      console.error('Error fetching transactions:', err);
      setError(errorMessage(err));
      return [];
    } finally {
      setLoading(false);
    }
  }, [budgetMonthStartDay, householdId]);

  const addTransaction = async (transaction: Partial<Transaction>) => {
    if (!householdId) return null;
    
    setLoading(true);
    setError(null);
    try {
      const { data, error: insertError } = await supabase
        .from('transactions')
        .insert([{
          ...transaction,
          household_id: householdId,
          inserted_by: transaction.inserted_by || user?.id || null
        }])
        .select()
        .single();

      if (insertError) throw insertError;
      
      // Update account balance (could also be done via Supabase trigger)
      if (transaction.account_id && transaction.amount && transaction.type) {
         // Ideally this is a stored procedure or trigger to avoid race conditions.
         // For MVP, if it's purely client side, we could update it here.
         // But Supabase triggers are better. We added an insert policy, but no balance trigger yet.
      }

      await saveClassificationRule(transaction);

      return data;
    } catch (err: unknown) {
      console.error('Error adding transaction:', err);
      setError(errorMessage(err));
      return null;
    } finally {
      setLoading(false);
    }
  };

  const addTransactionWithItems = async (
    transaction: Partial<Transaction>,
    items: TransactionItemDraft[],
  ) => {
    if (!householdId || items.length === 0) return null;

    setLoading(true);
    setError(null);
    try {
      const { data, error: insertError } = await supabase.rpc('create_transaction_with_items', {
        p_transaction: {
          ...transaction,
          household_id: householdId,
          inserted_by: transaction.inserted_by || user?.id || null,
        },
        p_items: items,
      });

      if (insertError) throw insertError;

      await saveClassificationRule(transaction);
      return data as Transaction;
    } catch (err: unknown) {
      console.error('Error adding transaction with items:', err);
      setError(errorMessage(err));
      return null;
    } finally {
      setLoading(false);
    }
  };

  const updateTransaction = async (id: string, transaction: Partial<Transaction>) => {
    if (!householdId) return null;

    setLoading(true);
    setError(null);
    try {
      const { data, error: updateError } = await supabase
        .from('transactions')
        .update({
          ...transaction,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .eq('household_id', householdId)
        .select()
        .single();

      if (updateError) throw updateError;

      await saveClassificationRule(transaction);
      return data;
    } catch (err: unknown) {
      console.error('Error updating transaction:', err);
      setError(errorMessage(err));
      return null;
    } finally {
      setLoading(false);
    }
  };

  const deleteTransaction = async (id: string) => {
    if (!householdId) return false;
    
    setLoading(true);
    setError(null);
    try {
      const { error: deleteError } = await supabase
        .from('transactions')
        .delete()
        .eq('id', id)
        .eq('household_id', householdId);

      if (deleteError) throw deleteError;
      return true;
    } catch (err: unknown) {
      console.error('Error deleting transaction:', err);
      setError(errorMessage(err));
      return false;
    } finally {
      setLoading(false);
    }
  };

  return {
    fetchTransactions,
    addTransaction,
    addTransactionWithItems,
    updateTransaction,
    deleteTransaction,
    loading,
    error
  };
};
