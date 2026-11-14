import { describe, expect, it } from 'vitest';
import { countdownLabel, daysUntil, formatEuros } from './format';
import { PROJECT_TEMPLATES } from './project-templates';

describe('shared formatting & project templates', () => {
  it('formats euros in French locale', () => {
    expect(formatEuros(1250)).toContain('12,50');
    expect(formatEuros(0)).toContain('0,00');
  });

  it('computes countdown labels J-x / Jour J / J+x', () => {
    const today = new Date();
    const todayIso = today.toISOString().slice(0, 10);
    expect(daysUntil(todayIso)).toBe(0);
    expect(countdownLabel(todayIso)).toBe('Jour J');

    const future = new Date(today.getTime() + 5 * 86_400_000).toISOString().slice(0, 10);
    expect(daysUntil(future)).toBe(5);
    expect(countdownLabel(future)).toBe('J-5');
    expect(countdownLabel(null)).toBe('Date à définir');
  });

  it('provides all 11 required MDL project templates with safety checklists', () => {
    expect(PROJECT_TEMPLATES).toHaveLength(11);
    for (const tpl of PROJECT_TEMPLATES) {
      expect(tpl.defaultTasks.length).toBeGreaterThanOrEqual(3);
      expect(tpl.safetyChecklist.length).toBeGreaterThanOrEqual(2);
    }
  });
});
