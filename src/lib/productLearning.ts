import { supabase } from './supabaseClient';
import { normalizeSearchText } from './receiptParsing';
import type { ProductClassificationRule } from '../types/database';

export type LearnableProduct = {
  description: string;
  categoryId?: string | null;
  subcategoryId?: string | null;
};

export const normalizeProductMatchText = (value: string) => (
  normalizeSearchText(value)
    .replace(/\b\d+\b/g, ' ')
    .replace(/\b(?:gr|g|kg|ml|cl|l|lt|pz|conf|pezzi)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
);

export const loadProductClassificationRules = async (householdId: string) => {
  const { data, error } = await supabase
    .from('product_classification_rules')
    .select('*')
    .eq('household_id', householdId)
    .order('use_count', { ascending: false });

  if (error) {
    console.warn('Regole prodotto non disponibili:', error.message);
    return [] as ProductClassificationRule[];
  }

  return (data || []) as ProductClassificationRule[];
};

export const findProductClassificationRule = (
  description: string,
  rules: ProductClassificationRule[],
) => {
  const key = normalizeProductMatchText(description);
  if (key.length < 3) return null;

  return rules.find(rule => rule.match_text === key)
    || rules.find(rule => (
      rule.match_text.length >= 4
      && (key.includes(rule.match_text) || rule.match_text.includes(key))
    ))
    || null;
};

export const saveProductClassificationRules = async ({
  householdId,
  userId,
  products,
}: {
  householdId: string;
  userId?: string | null;
  products: LearnableProduct[];
}) => {
  const validProducts = products
    .map(product => ({ ...product, matchText: normalizeProductMatchText(product.description) }))
    .filter(product => product.matchText.length >= 3 && product.categoryId);

  for (const product of validProducts) {
    const { data: existing, error: lookupError } = await supabase
      .from('product_classification_rules')
      .select('id, use_count')
      .eq('household_id', householdId)
      .eq('match_text', product.matchText)
      .maybeSingle();

    if (lookupError) {
      console.warn('Apprendimento prodotto non disponibile:', lookupError.message);
      return;
    }

    if (existing) {
      await supabase
        .from('product_classification_rules')
        .update({
          display_name: product.description.trim(),
          category_id: product.categoryId,
          subcategory_id: product.subcategoryId || null,
          use_count: Number(existing.use_count || 0) + 1,
          last_used_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .eq('household_id', householdId);
    } else {
      await supabase.from('product_classification_rules').insert([{
        household_id: householdId,
        match_text: product.matchText,
        display_name: product.description.trim(),
        category_id: product.categoryId,
        subcategory_id: product.subcategoryId || null,
        created_by: userId || null,
        use_count: 1,
        last_used_at: new Date().toISOString(),
      }]);
    }
  }
};
