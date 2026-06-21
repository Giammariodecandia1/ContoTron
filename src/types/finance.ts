import type { Category, Subcategory } from './database';

export interface AccountBalance {
  accountId: string;
  accountName: string;
  initialBalance: number;
  incomes: number;
  expenses: number;
  transfersIn: number;
  transfersOut: number;
  calculatedBalance: number;
}

export interface MonthlyOverview {
  year: number;
  month: number;
  totalIncome: number;
  totalExpense: number;
  totalPlannedExpense: number;
  totalPredictedExpense: number;
  remainingBudget: number;
  dailyAverage: number;
}

export interface CategoryBudgetRow {
  category: Category;
  subcategories: Subcategory[];
  plannedAmount: number;
  actualAmount: number;
  committedAmount: number;
  predictedAmount: number;
  delta: number;
  status: 'ok' | 'warning' | 'danger' | 'review';
}

export interface ForecastResult {
  value: number;
  reason: string;
}

export interface AlertItem {
  id: string;
  type: 'danger' | 'warning' | 'info';
  title: string;
  message: string;
  actionLink?: string;
  actionText?: string;
}

export interface DashboardData {
  totalBalance: number;
  accountBalances: AccountBalance[];
  monthlyOverview: MonthlyOverview;
  alerts: AlertItem[];
}
