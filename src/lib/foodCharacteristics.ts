import type { FoodCharacteristic } from '../types/database';

export const foodCharacteristicLabels: Record<FoodCharacteristic, string> = {
  necessary: 'Necessaria',
  necessary_indulgence: 'Voluttuaria necessaria',
  nonessential_misc: 'Vario non utile',
};

export const foodCharacteristicOptions = Object.entries(foodCharacteristicLabels).map(([value, label]) => ({
  value: value as FoodCharacteristic,
  label,
}));

export const getFoodCharacteristicLabel = (value?: string | null) => (
  value ? foodCharacteristicLabels[value as FoodCharacteristic] || value : 'Non definita'
);
