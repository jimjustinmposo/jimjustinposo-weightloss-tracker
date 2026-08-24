import type { ActivityLevel, Gender, GoalType } from './types';

/** Standard activity multipliers used to derive TDEE from BMR. */
export const ACTIVITY_FACTORS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  athlete: 1.9,
};

/** Approximate energy stored in 1 kg of body fat. */
const KCAL_PER_KG = 7700;

export function calcBmi(weightKg: number, heightCm: number): number {
  const hMeters = heightCm / 100;
  if (!(hMeters > 0)) return 0;
  return weightKg / (hMeters * hMeters);
}

export function bmiCategory(bmiValue: number): string {
  if (bmiValue < 18.5) return 'Underweight';
  if (bmiValue < 25) return 'Normal weight';
  if (bmiValue < 30) return 'Overweight';
  return 'Obese';
}

/** Mifflin-St Jeor basal metabolic rate. */
export function calcBmr(weightKg: number, heightCm: number, age: number, gender: Gender): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  if (gender === 'male') return base + 5;
  if (gender === 'female') return base - 161;
  return base - 78; // midpoint for non-binary/other
}

/**
 * Estimate calories burned by walking `steps`, based on the walker's height
 * (stride length ≈ height × 0.414) and body weight (PACS cost of walking).
 */
export function stepCalories(steps: number, weightKg: number, heightCm: number): number {
  const strideMeters = ((heightCm || 170) * 0.414) / 100;
  const km = (steps * strideMeters) / 1000;
  return km * (weightKg || 75) * 1.036;
}

export type Targets = {
  bmr: number;
  tdee: number;
  bmi: number;
  bmi_category: string;
  calorie_target: number;
  protein_target: number;
  carb_target: number;
  fat_target: number;
  weekly_rate_kg: number;
};

export type TargetInput = {
  weightKg: number;
  heightCm: number;
  age: number;
  gender: Gender;
  activityLevel: ActivityLevel;
  goalType: GoalType;
  weeklyGoalKg: number;
};

/**
 * Derive daily calorie + macro targets from a user profile.
 *  - BMR via Mifflin-St Jeor, TDEE via activity factor
 *  - daily deficit/surplus = weeklyGoalKg × 7700 ÷ 7 (capped at ±1.5 kg/wk)
 *  - calorie floor 1200 (female) / 1500 (male|other)
 *  - protein g/kg: lose 2.0 · gain 1.8 · maintain 1.6
 *  - fat ≈ 27% of calories, carbs fill the remainder
 */
export function computeTargets(input: TargetInput): Targets {
  const bmrValue = calcBmr(input.weightKg, input.heightCm, input.age, input.gender);
  const tdee = bmrValue * ACTIVITY_FACTORS[input.activityLevel];

  const signedWeekly =
    input.goalType === 'maintain'
      ? 0
      : Math.min(Math.abs(input.weeklyGoalKg || 0), 1.5) * (input.goalType === 'lose' ? -1 : 1);
  const dailyDelta = (Math.abs(signedWeekly) * KCAL_PER_KG) / 7;

  const floor = input.gender === 'female' ? 1200 : 1500;
  const rawCalories = tdee + (signedWeekly < 0 ? -dailyDelta : dailyDelta);
  const calorieTarget = Math.round(Math.max(rawCalories, floor) / 10) * 10;

  const proteinPerKg = input.goalType === 'lose' ? 2.0 : input.goalType === 'gain' ? 1.8 : 1.6;
  const proteinTarget = Math.max(40, Math.round((proteinPerKg * input.weightKg) / 5) * 5);
  const fatTarget = Math.max(30, Math.round(((calorieTarget * 0.27) / 9) / 5) * 5);
  const carbTarget = Math.max(
    30,
    Math.round(((calorieTarget - proteinTarget * 4 - fatTarget * 9) / 4) / 5) * 5
  );

  const bmiValue = calcBmi(input.weightKg, input.heightCm);
  return {
    bmr: Math.round(bmrValue),
    tdee: Math.round(tdee),
    bmi: Math.round(bmiValue * 10) / 10,
    bmi_category: bmiCategory(bmiValue),
    calorie_target: calorieTarget,
    protein_target: proteinTarget,
    carb_target: carbTarget,
    fat_target: fatTarget,
    weekly_rate_kg: Math.round(signedWeekly * 100) / 100,
  };
}
