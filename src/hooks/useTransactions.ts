import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useHousehold } from '../contexts/HouseholdContext';
import { useAuth } from '../contexts/AuthContext';
import type { Transaction } from '../types/database';

export const useTransactions = () => {
  const { household } = useHousehold();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveClassificationRule = async (transaction: Partial<Transaction>) => {
    if (!household || !transaction.merchant || !transaction.category_id) return;

    const merchantLower = transaction.merchant.trim().toLowerCase();
    const { data: existingRule } = await supabase
      .from('classification_rules')
      .select('id, use_count')
      .eq('household_id', household.id)
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
          household_id: household.id,
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
  };

  const fetchTransactions = useCallback(async (
    month?: number,
    year?: number,
    categoryId?: string
  ): Promise<Transaction[]> => {
    if (!household) return [];
    
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
        .eq('household_id', household.id)
        .order('transaction_date', { ascending: false });

      if (year && month) {
        // Construct date range for the month
        const startDay = household.budget_month_start_day || 1;
        // Basic month filtering (can be improved based on budget_month_start_day)
        const startDate = new Date(year, month - 1, startDay).toISOString().split('T')[0];
        const endDate = new Date(year, month, startDay - 1).toISOString().split('T')[0];
        
        query = query.gte('transaction_date', startDate).lte('transaction_date', endDate);
      }

      if (categoryId) {
        query = query.eq('category_id', categoryId);
      }

      const { data, error: fetchError } = await query;

      if (fetchError) throw fetchError;
      return (data || []) as any; // Cast for now, need proper join types later
    } catch (err: any) {
      console.error('Error fetching transactions:', err);
      setError(err.message);
      return [];
    } finally {
      setLoading(false);
    }
  }, [household]);

  const addTransaction = async (transaction: Partial<Transaction>) => {
    if (!household) return null;
    
    setLoading(true);
    setError(null);
    try {
      const { data, error: insertError } = await supabase
        .from('transactions')
        .insert([{
          ...transaction,
          household_id: household.id,
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
    } catch (err: any) {
      console.error('Error adding transaction:', err);
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  };

  const updateTransaction = async (id: string, transaction: Partial<Transaction>) => {
    if (!household) return null;

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
        .eq('household_id', household.id)
        .select()
        .single();

      if (updateError) throw updateError;

      await saveClassificationRule(transaction);
      return data;
    } catch (err: any) {
      console.error('Error updating transaction:', err);
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  };

  const deleteTransaction = async (id: string) => {
    if (!household) return false;
    
    setLoading(true);
    setError(null);
    try {
      const { error: deleteError } = await supabase
        .from('transactions')
        .delete()
        .eq('id', id)
        .eq('household_id', household.id);

      if (deleteError) throw deleteError;
      return true;
    } catch (err: any) {
      console.error('Error deleting transaction:', err);
      setError(err.message);
      return false;
    } finally {
      setLoading(false);
    }
  };

  return {
    fetchTransactions,
    addTransaction,
    updateTransaction,
    deleteTransaction,
    loading,
    error
  };
};
