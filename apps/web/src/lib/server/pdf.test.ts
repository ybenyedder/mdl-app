import { describe, expect, it } from 'vitest';
import {
  generateBudgetReportPdf,
  generateConvocationPdf,
  generateEmargementPdf,
  generateParcoursupPdf,
  generatePvAgPdf
} from './pdf';

describe('PDF generators (pdf-lib)', () => {
  it('generates valid PDF headers for all official MDL documents', async () => {
    const conv = await generateConvocationPdf({
      schoolName: 'Lycée Jean Moulin',
      mdlName: 'MDL Connect',
      assemblyTitle: 'AG Ordinaire 2026',
      scheduledAt: '2026-11-20 12:30',
      location: 'Amphithéâtre',
      description: 'Élection du bureau et vote du budget.',
      quorumRequired: 30
    });
    expect(Buffer.from(conv.slice(0, 5)).toString('ascii')).toBe('%PDF-');

    const emarg = await generateEmargementPdf({
      schoolName: 'Lycée Jean Moulin',
      mdlName: 'MDL Connect',
      assemblyTitle: 'AG Ordinaire 2026',
      scheduledAt: '2026-11-20',
      members: [{ fullName: 'Camille Dupont', classe: 'Tle G1', present: true }]
    });
    expect(Buffer.from(emarg.slice(0, 5)).toString('ascii')).toBe('%PDF-');

    const pv = await generatePvAgPdf({
      schoolName: 'Lycée Jean Moulin',
      mdlName: 'MDL Connect',
      assemblyTitle: 'AG Ordinaire 2026',
      scheduledAt: '2026-11-20',
      location: 'Amphithéâtre',
      totalVoters: 45,
      quorumRequired: 30,
      blankVotes: 2,
      candidates: [
        { fullName: 'Lucas Martin', classe: '1ère G3', positionTitle: 'Président', votesCount: 28 }
      ]
    });
    expect(Buffer.from(pv.slice(0, 5)).toString('ascii')).toBe('%PDF-');

    const budget = await generateBudgetReportPdf({
      schoolName: 'Lycée Jean Moulin',
      mdlName: 'MDL Connect',
      fiscalYear: '2026-2027',
      totalRecettesCents: 150000,
      totalDepensesCents: 45000,
      entries: [
        {
          entryDate: '2026-10-12',
          type: 'recette',
          category: 'Adhésions',
          label: 'Cotisations octobre',
          amountCents: 150000
        }
      ]
    });
    expect(Buffer.from(budget.slice(0, 5)).toString('ascii')).toBe('%PDF-');

    const parcoursup = await generateParcoursupPdf({
      schoolName: 'Lycée Jean Moulin',
      mdlName: 'MDL Connect',
      studentName: 'Camille Dupont',
      classe: 'Tle G1',
      roleLabel: 'Président / Admin',
      schoolYear: '2026-2027',
      hoursTotal: 42,
      projectsList: ['Bal de promo', 'Tournoi futsal'],
      skills: ['Gestion de budget', 'Coordination d’équipe'],
      summaryText: 'Coordination de 12 bénévoles pour le bal annuel.'
    });
    expect(Buffer.from(parcoursup.slice(0, 5)).toString('ascii')).toBe('%PDF-');
  });
});
