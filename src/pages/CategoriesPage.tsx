import React, { useState } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { ArrowLeft, Check, ChevronDown, ChevronRight, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useHousehold } from '../hooks';
import { supabase } from '../lib/supabaseClient';
import { spendingTypeOptions, getSpendingTypeLabel } from '../lib/spendingTypes';
import { foodCharacteristicOptions, getFoodCharacteristicLabel } from '../lib/foodCharacteristics';
import type { FoodCharacteristic, SpendingType, TransactionType } from '../types/database';
import styles from './CategoriesPage.module.css';

type EditingValue = {
  id: string;
  name: string;
};

export const CategoriesPage: React.FC = () => {
  const navigate = useNavigate();
  const { household, categories, subcategories, refreshData } = useHousehold();
  const [newExpenseCategory, setNewExpenseCategory] = useState('');
  const [newCategoryType, setNewCategoryType] = useState<Extract<TransactionType, 'expense' | 'income'>>('expense');
  const [newSubcategoryMap, setNewSubcategoryMap] = useState<Record<string, string>>({});
  const [newSubcategoryTypeMap, setNewSubcategoryTypeMap] = useState<Record<string, SpendingType>>({});
  const [newFoodCharacteristicMap, setNewFoodCharacteristicMap] = useState<Record<string, FoodCharacteristic>>({});
  const [editingCategory, setEditingCategory] = useState<EditingValue | null>(null);
  const [editingSubcategory, setEditingSubcategory] = useState<EditingValue | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const managedCategories = categories
    .filter(category => category.type === 'expense' || category.type === 'income')
    .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));

  const toggleCategory = (id: string) => {
    setExpandedCategories(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!household) return;

    const name = newExpenseCategory.trim();
    if (!name) return;

    setLoading(true);
    setSaveMessage(null);
    setSaveError(null);

    try {
      const { data, error } = await supabase
        .from('categories')
        .insert([{
          household_id: household.id,
          name,
          type: newCategoryType,
          sort_order: 100
        }])
        .select('id, name')
        .single();

      if (error) throw error;

      setNewExpenseCategory('');
      await refreshData();
      setSaveMessage(`Categoria ${newCategoryType === 'expense' ? 'di uscita' : 'di entrata'} "${data?.name || name}" salvata nel database.`);
    } catch (err) {
      console.error('Errore durante inserimento categoria:', err);
      setSaveError("Impossibile aggiungere la categoria. Assicurati che non esista gia'.");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteCategory = async (id: string, name: string) => {
    if (!household) return;

    if (!window.confirm(`Sei sicuro di voler eliminare la categoria "${name}"? Le transazioni associate potrebbero perdere il riferimento.`)) {
      return;
    }

    setLoading(true);
    setSaveMessage(null);
    setSaveError(null);

    try {
      const { error } = await supabase
        .from('categories')
        .delete()
        .eq('id', id)
        .eq('household_id', household.id);

      if (error) throw error;
      await refreshData();
      setSaveMessage(`Categoria "${name}" eliminata dal database.`);
    } catch (err) {
      console.error('Errore durante eliminazione categoria:', err);
      setSaveError('Impossibile eliminare la categoria. Potrebbe avere transazioni associate.');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateCategory = async (id: string) => {
    if (!household || editingCategory?.id !== id) return;

    const name = editingCategory.name.trim();
    if (!name) return;

    setLoading(true);
    setSaveMessage(null);
    setSaveError(null);

    try {
      const { error } = await supabase
        .from('categories')
        .update({ name })
        .eq('id', id)
        .eq('household_id', household.id);

      if (error) throw error;
      setEditingCategory(null);
      await refreshData();
      setSaveMessage(`Categoria "${name}" aggiornata nel database.`);
    } catch (err) {
      console.error('Errore durante modifica categoria:', err);
      setSaveError("Impossibile modificare la categoria. Assicurati che non esista gia'.");
    } finally {
      setLoading(false);
    }
  };

  const handleAddSubcategory = async (categoryId: string) => {
    if (!household) return;

    const name = newSubcategoryMap[categoryId]?.trim();
    if (!name) return;
    const spendingType = newSubcategoryTypeMap[categoryId] || 'variable';
    const category = categories.find(item => item.id === categoryId);
    const isFoodCategory = category?.name.trim().toLowerCase() === 'alimentari';
    const foodCharacteristic = isFoodCategory
      ? newFoodCharacteristicMap[categoryId] || 'necessary'
      : null;

    setLoading(true);
    setSaveMessage(null);
    setSaveError(null);

    try {
      const { data, error } = await supabase
        .from('subcategories')
        .insert([{
          household_id: household.id,
          category_id: categoryId,
          name,
          spending_type: spendingType,
          food_characteristic: foodCharacteristic,
          sort_order: 100
        }])
        .select('id, name')
        .single();

      if (error) throw error;

      setNewSubcategoryMap(prev => ({ ...prev, [categoryId]: '' }));
      setNewSubcategoryTypeMap(prev => ({ ...prev, [categoryId]: 'variable' }));
      setNewFoodCharacteristicMap(prev => ({ ...prev, [categoryId]: 'necessary' }));
      setExpandedCategories(prev => ({ ...prev, [categoryId]: true }));
      await refreshData();
      setSaveMessage(`Sottocategoria "${data?.name || name}" salvata nel database.`);
    } catch (err) {
      console.error('Errore durante inserimento sottocategoria:', err);
      setSaveError("Impossibile aggiungere la sottocategoria. Assicurati che non esista gia'.");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteSubcategory = async (id: string, name: string) => {
    if (!household) return;

    if (!window.confirm(`Sei sicuro di voler eliminare la sottocategoria "${name}"? Le transazioni associate potrebbero perdere il riferimento.`)) {
      return;
    }

    setLoading(true);
    setSaveMessage(null);
    setSaveError(null);

    try {
      const { error } = await supabase
        .from('subcategories')
        .delete()
        .eq('id', id)
        .eq('household_id', household.id);

      if (error) throw error;
      await refreshData();
      setSaveMessage(`Sottocategoria "${name}" eliminata dal database.`);
    } catch (err) {
      console.error('Errore durante eliminazione sottocategoria:', err);
      setSaveError('Impossibile eliminare la sottocategoria. Potrebbe avere transazioni associate.');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateSubcategory = async (id: string) => {
    if (!household || editingSubcategory?.id !== id) return;

    const name = editingSubcategory.name.trim();
    if (!name) return;

    setLoading(true);
    setSaveMessage(null);
    setSaveError(null);

    try {
      const { error } = await supabase
        .from('subcategories')
        .update({ name })
        .eq('id', id)
        .eq('household_id', household.id);

      if (error) throw error;
      setEditingSubcategory(null);
      await refreshData();
      setSaveMessage(`Sottocategoria "${name}" aggiornata nel database.`);
    } catch (err) {
      console.error('Errore durante modifica sottocategoria:', err);
      setSaveError("Impossibile modificare la sottocategoria. Assicurati che non esista gia'.");
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateSubcategoryType = async (id: string, spendingType: SpendingType) => {
    if (!household) return;

    setLoading(true);
    setSaveMessage(null);
    setSaveError(null);

    try {
      const { error } = await supabase
        .from('subcategories')
        .update({ spending_type: spendingType })
        .eq('id', id)
        .eq('household_id', household.id);

      if (error) throw error;
      await refreshData();
      setSaveMessage(`Tipo spesa aggiornato: ${getSpendingTypeLabel(spendingType)}.`);
    } catch (err) {
      console.error('Errore durante modifica tipo spesa:', err);
      setSaveError('Impossibile salvare il tipo spesa. Applica la migrazione Supabase se il campo non esiste ancora.');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateFoodCharacteristic = async (id: string, foodCharacteristic: FoodCharacteristic) => {
    if (!household) return;

    setLoading(true);
    setSaveMessage(null);
    setSaveError(null);

    try {
      const { error } = await supabase
        .from('subcategories')
        .update({ food_characteristic: foodCharacteristic })
        .eq('id', id)
        .eq('household_id', household.id);

      if (error) throw error;
      await refreshData();
      setSaveMessage(`Caratteristica alimentare aggiornata: ${getFoodCharacteristicLabel(foodCharacteristic)}.`);
    } catch (err) {
      console.error('Errore durante modifica caratteristica alimentare:', err);
      setSaveError('Impossibile salvare la caratteristica alimentare.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <Button variant="ghost" icon={<ArrowLeft size={18} />} onClick={() => navigate('/impostazioni')}>
            Indietro
          </Button>
          <div>
            <h1 className={styles.title}>Gestione Categorie</h1>
            <p className="text-muted">Gestisci le categorie per le tue entrate e uscite.</p>
            <p className="text-muted fs-sm">
              Salvate nel database: {managedCategories.length} categorie e {subcategories.length} sottocategorie.
            </p>
          </div>
        </div>
      </header>

      <div className={styles.grid}>
        <Card title="Categorie del nucleo">
          {saveMessage && <div className={`${styles.saveBanner} ${styles.success}`}>{saveMessage}</div>}
          {saveError && <div className={`${styles.saveBanner} ${styles.error}`}>{saveError}</div>}

          <div className={styles.categoryList}>
            {managedCategories.length === 0 ? (
              <div className="text-muted fs-sm text-center py-4">Nessuna categoria configurata</div>
            ) : (
              managedCategories.map(cat => {
                const isExpanded = expandedCategories[cat.id];
                const isFoodCategory = cat.name.trim().toLowerCase() === 'alimentari';
                const catSubcategories = subcategories
                  .filter(s => s.category_id === cat.id)
                  .sort((a, b) => a.name.localeCompare(b.name));

                return (
                  <div key={cat.id} className={styles.categoryContainer}>
                    <div
                      className={`${styles.categoryItem} ${isExpanded ? styles.categoryItemExpanded : ''}`}
                      onClick={() => toggleCategory(cat.id)}
                    >
                      <div className={styles.categoryNameContainer}>
                        {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                        {editingCategory?.id === cat.id ? (
                          <div className={styles.editInline} onClick={e => e.stopPropagation()}>
                            <input
                              className={styles.editInput}
                              value={editingCategory.name}
                              disabled={loading}
                              onChange={e => setEditingCategory({ id: cat.id, name: e.target.value })}
                              onKeyDown={e => {
                                if (e.key === 'Enter') void handleUpdateCategory(cat.id);
                                if (e.key === 'Escape') setEditingCategory(null);
                              }}
                              autoFocus
                            />
                            <button
                              type="button"
                              className={styles.confirmBtn}
                              onClick={() => handleUpdateCategory(cat.id)}
                              disabled={loading || !editingCategory.name.trim()}
                              title="Salva categoria"
                            >
                              <Check size={15} />
                            </button>
                            <button
                              type="button"
                              className={styles.cancelBtn}
                              onClick={() => setEditingCategory(null)}
                              disabled={loading}
                              title="Annulla modifica"
                            >
                              <X size={15} />
                            </button>
                          </div>
                        ) : (
                          <>
                            <span>{cat.name}</span>
                            <span className={styles.typeBadge}>{cat.type === 'expense' ? 'Uscita' : 'Entrata'}</span>
                            {catSubcategories.length > 0 && (
                              <span className={styles.badge}>{catSubcategories.length}</span>
                            )}
                          </>
                        )}
                      </div>
                      <div className={styles.rowActions}>
                        <button
                          className={styles.editBtn}
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingCategory({ id: cat.id, name: cat.name });
                          }}
                          title="Modifica categoria"
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          className={styles.deleteBtn}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteCategory(cat.id, cat.name);
                          }}
                          title="Elimina categoria"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className={styles.subcategoriesContainer}>
                        {catSubcategories.length === 0 ? (
                          <p className={styles.emptyText}>Nessuna sottocategoria</p>
                        ) : (
                          catSubcategories.map(sub => (
                            <div key={sub.id} className={styles.subcategoryItem}>
                              {editingSubcategory?.id === sub.id ? (
                                <div className={styles.editInline}>
                                  <input
                                    className={styles.editInput}
                                    value={editingSubcategory.name}
                                    disabled={loading}
                                    onChange={e => setEditingSubcategory({ id: sub.id, name: e.target.value })}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') void handleUpdateSubcategory(sub.id);
                                      if (e.key === 'Escape') setEditingSubcategory(null);
                                    }}
                                    autoFocus
                                  />
                                  <button
                                    type="button"
                                    className={styles.confirmBtn}
                                    onClick={() => handleUpdateSubcategory(sub.id)}
                                    disabled={loading || !editingSubcategory.name.trim()}
                                    title="Salva sottocategoria"
                                  >
                                    <Check size={14} />
                                  </button>
                                  <button
                                    type="button"
                                    className={styles.cancelBtn}
                                    onClick={() => setEditingSubcategory(null)}
                                    disabled={loading}
                                    title="Annulla modifica"
                                  >
                                    <X size={14} />
                                  </button>
                                </div>
                              ) : (
                                <div className={styles.subcategoryText}>
                                  <span>{sub.name}</span>
                                  <small>{getSpendingTypeLabel(sub.spending_type)}</small>
                                  {isFoodCategory && <small>{getFoodCharacteristicLabel(sub.food_characteristic)}</small>}
                                </div>
                              )}
                              <select
                                className={styles.spendingTypeSelect}
                                value={sub.spending_type || 'variable'}
                                onChange={event => handleUpdateSubcategoryType(sub.id, event.target.value as SpendingType)}
                                disabled={loading}
                                aria-label={`Tipo spesa per ${sub.name}`}
                              >
                                {spendingTypeOptions.map(option => (
                                  <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                              </select>
                              {isFoodCategory && (
                                <select
                                  className={styles.spendingTypeSelect}
                                  value={sub.food_characteristic || 'necessary'}
                                  onChange={event => handleUpdateFoodCharacteristic(sub.id, event.target.value as FoodCharacteristic)}
                                  disabled={loading}
                                  aria-label={`Caratteristica alimentare per ${sub.name}`}
                                >
                                  {foodCharacteristicOptions.map(option => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                  ))}
                                </select>
                              )}
                              <div className={styles.rowActions}>
                                <button
                                  className={styles.editBtnSmall}
                                  onClick={() => setEditingSubcategory({ id: sub.id, name: sub.name })}
                                  title="Modifica sottocategoria"
                                >
                                  <Pencil size={14} />
                                </button>
                                <button
                                  className={styles.deleteBtnSmall}
                                  onClick={() => handleDeleteSubcategory(sub.id, sub.name)}
                                  title="Elimina sottocategoria"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </div>
                          ))
                        )}

                        <div className={styles.addSubForm}>
                          <input
                            type="text"
                            placeholder="Nuova sottocategoria..."
                            value={newSubcategoryMap[cat.id] || ''}
                            onChange={e => setNewSubcategoryMap(prev => ({ ...prev, [cat.id]: e.target.value }))}
                            className={styles.inputSmall}
                            disabled={loading}
                          />
                          <select
                            className={styles.inputSmall}
                            value={newSubcategoryTypeMap[cat.id] || 'variable'}
                            onChange={event => setNewSubcategoryTypeMap(prev => ({ ...prev, [cat.id]: event.target.value as SpendingType }))}
                            disabled={loading}
                            aria-label="Tipo spesa nuova sottocategoria"
                          >
                            {spendingTypeOptions.map(option => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                          {isFoodCategory && (
                            <select
                              className={styles.inputSmall}
                              value={newFoodCharacteristicMap[cat.id] || 'necessary'}
                              onChange={event => setNewFoodCharacteristicMap(prev => ({ ...prev, [cat.id]: event.target.value as FoodCharacteristic }))}
                              disabled={loading}
                              aria-label="Caratteristica alimentare nuova sottocategoria"
                            >
                              {foodCharacteristicOptions.map(option => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                              ))}
                            </select>
                          )}
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => handleAddSubcategory(cat.id)}
                            disabled={loading || !(newSubcategoryMap[cat.id] || '').trim()}
                          >
                            <Plus size={16} />
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          <form onSubmit={handleAddCategory} className={styles.addForm}>
            <select
              value={newCategoryType}
              onChange={event => setNewCategoryType(event.target.value as Extract<TransactionType, 'expense' | 'income'>)}
              className={styles.input}
              disabled={loading}
              aria-label="Tipo nuova categoria"
            >
              <option value="expense">Uscita</option>
              <option value="income">Entrata</option>
            </select>
            <input
              type="text"
              placeholder="Nuova categoria..."
              value={newExpenseCategory}
              onChange={e => setNewExpenseCategory(e.target.value)}
              className={styles.input}
              disabled={loading}
            />
            <Button type="submit" size="sm" icon={<Plus size={16} />} disabled={loading || !newExpenseCategory.trim()}>
              Aggiungi
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
};
