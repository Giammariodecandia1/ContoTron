import React, { useState } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { ArrowLeft, Check, ChevronDown, ChevronRight, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useHousehold } from '../hooks';
import { supabase } from '../lib/supabaseClient';
import styles from './CategoriesPage.module.css';

type EditingValue = {
  id: string;
  name: string;
};

export const CategoriesPage: React.FC = () => {
  const navigate = useNavigate();
  const { household, categories, subcategories, refreshData } = useHousehold();
  const [newExpenseCategory, setNewExpenseCategory] = useState('');
  const [newSubcategoryMap, setNewSubcategoryMap] = useState<Record<string, string>>({});
  const [editingCategory, setEditingCategory] = useState<EditingValue | null>(null);
  const [editingSubcategory, setEditingSubcategory] = useState<EditingValue | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const expenseCategories = categories
    .filter(c => c.type === 'expense')
    .sort((a, b) => a.name.localeCompare(b.name));

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
          type: 'expense',
          sort_order: 100
        }])
        .select('id, name')
        .single();

      if (error) throw error;

      setNewExpenseCategory('');
      await refreshData();
      setSaveMessage(`Categoria "${data?.name || name}" salvata nel database.`);
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
          sort_order: 100
        }])
        .select('id, name')
        .single();

      if (error) throw error;

      setNewSubcategoryMap(prev => ({ ...prev, [categoryId]: '' }));
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
              Salvate nel database: {expenseCategories.length} categorie e {subcategories.length} sottocategorie.
            </p>
          </div>
        </div>
      </header>

      <div className={styles.grid}>
        <Card title="Le tue Categorie">
          {saveMessage && <div className={`${styles.saveBanner} ${styles.success}`}>{saveMessage}</div>}
          {saveError && <div className={`${styles.saveBanner} ${styles.error}`}>{saveError}</div>}

          <div className={styles.categoryList}>
            {expenseCategories.length === 0 ? (
              <div className="text-muted fs-sm text-center py-4">Nessuna categoria configurata</div>
            ) : (
              expenseCategories.map(cat => {
                const isExpanded = expandedCategories[cat.id];
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
                                <span>{sub.name}</span>
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
