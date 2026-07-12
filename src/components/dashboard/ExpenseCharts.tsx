import React, { useMemo } from 'react';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Card } from '../ui/Card';

interface ExpenseChartsProps {
  transactions: Array<{
    type: string;
    amount: number;
    transaction_date: string;
    categories?: { name?: string | null } | null;
  }>;
  selectedYear: number;
}

const COLORS = ['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#14b8a6', '#f43f5e', '#6366f1'];

const formatTooltipCurrency = (value: unknown) => {
  const amount = Number(value ?? 0);
  return `${amount.toFixed(2)} €`;
};

export const ExpenseCharts: React.FC<ExpenseChartsProps> = ({ transactions, selectedYear }) => {
  const currentMonth = new Date().getMonth();

  // Dati per Grafico a Torta: Spese per categoria (Mese Corrente)
  const pieData = useMemo(() => {
    const categoryTotals: Record<string, number> = {};
    
    transactions.forEach(tx => {
      const txDate = new Date(tx.transaction_date);
      if (tx.type === 'expense' && txDate.getMonth() === currentMonth && txDate.getFullYear() === selectedYear) {
        const catName = tx.categories?.name || 'Altro';
        categoryTotals[catName] = (categoryTotals[catName] || 0) + tx.amount;
      }
    });

    return Object.entries(categoryTotals)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [transactions, currentMonth, selectedYear]);

  // Dati per Grafico a Barre: Andamento Spese Ultimi 6 Mesi
  const barData = useMemo(() => {
    const months: Record<string, number> = {};
    
    // Inizializza tutti i mesi dell'anno selezionato.
    for (let i = 0; i < 12; i++) {
      const d = new Date(selectedYear, i, 1);
      const monthLabel = d.toLocaleString('it-IT', { month: 'short' });
      months[monthLabel] = 0;
    }

    transactions.forEach(tx => {
      if (tx.type === 'expense') {
        const txDate = new Date(tx.transaction_date);
        if (txDate.getFullYear() === selectedYear) {
          const monthLabel = txDate.toLocaleString('it-IT', { month: 'short' });
          if (months[monthLabel] !== undefined) {
            months[monthLabel] += tx.amount;
          }
        }
      }
    });

    return Object.entries(months).map(([name, Spese]) => ({ name, Spese }));
  }, [transactions, selectedYear]);

  if (transactions.length === 0) return null;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem', marginTop: '1.5rem' }}>
      <Card title="Spese per Categoria (Questo mese)">
        {pieData.length > 0 ? (
          <div style={{ width: '100%', height: 250 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {pieData.map((_entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={formatTooltipCurrency} />
                <Legend layout="horizontal" verticalAlign="bottom" align="center" />
              </PieChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-muted fs-sm text-center py-4">Nessuna spesa registrata questo mese.</p>
        )}
      </Card>

      <Card title={`Andamento Spese (${selectedYear})`}>
        <div style={{ width: '100%', height: 250 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={barData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis fontSize={12} tickLine={false} axisLine={false} tickFormatter={(val) => `€${val}`} />
              <Tooltip formatter={formatTooltipCurrency} cursor={{ fill: 'var(--color-gray-50)' }} />
              <Bar dataKey="Spese" fill="var(--color-primary)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
};
