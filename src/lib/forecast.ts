import { getMonthBoundaries, getDaysPassedInMonth } from './dates';
import type { ForecastResult } from '../types/finance';

/**
 * Previsione semplice e spiegabile per le categorie variabili.
 * Proietta la spesa attuale su tutto il mese in base ai giorni trascorsi.
 */
export function calculateDailyAverageForecast(
  actualSpend: number,
  currentDate: Date = new Date()
): ForecastResult {
  const daysPassed = getDaysPassedInMonth(currentDate);
  const totalDays = getMonthBoundaries(currentDate.getFullYear(), currentDate.getMonth() + 1).daysInMonth;
  
  if (daysPassed === 0) return { value: 0, reason: "Inizio mese" };
  
  const dailyAverage = actualSpend / daysPassed;
  const projected = dailyAverage * totalDays;
  
  return {
    value: Math.round(projected * 100) / 100,
    reason: `Proiezione basata su spesa media giornaliera di €${dailyAverage.toFixed(2)}`
  };
}

/**
 * Calcola la previsione di fine mese usando una logica mista tra spese fisse e variabili
 */
export function calculateEndOfMonthForecast(
  actualSpend: number,
  committedRemaining: number,
  variableProjected: number
): ForecastResult {
  const total = actualSpend + committedRemaining + variableProjected;
  
  return {
    value: Math.round(total * 100) / 100,
    reason: `Effettivo + ${committedRemaining.toFixed(2)} impegnati + stima di ${variableProjected.toFixed(2)} su spese variabili`
  };
}
