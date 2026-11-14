import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

function sanitizeWinAnsi(text: string): string {
  return (text || '')
    .replaceAll('\u202f', ' ')
    .replaceAll('\u00a0', ' ')
    .replaceAll('€', 'EUR')
    .replaceAll('—', '-')
    .replaceAll('–', '-')
    .replaceAll('’', "'")
    .replaceAll('‘', "'")
    .replaceAll('“', '"')
    .replaceAll('”', '"')
    .replace(/[^\x20-\xFF\n]/g, ' ');
}

function wrapLines(text: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
  const clean = sanitizeWinAnsi(text);
  const paragraphs = clean.split('\n');
  const lines: string[] = [];
  for (const para of paragraphs) {
    const words = para.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      continue;
    }
    let current = words[0];
    for (let i = 1; i < words.length; i++) {
      const candidate = `${current} ${words[i]}`;
      if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
        current = candidate;
      } else {
        lines.push(current);
        current = words[i];
      }
    }
    lines.push(current);
  }
  return lines;
}

interface PdfWriter {
  doc: PDFDocument;
  page: PDFPage;
  font: PDFFont;
  bold: PDFFont;
  y: number;
  width: number;
  height: number;
}

async function createWriter(title: string, subtitle: string): Promise<PdfWriter> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([595.28, 841.89]); // A4
  const { width, height } = page.getSize();

  page.drawRectangle({ x: 0, y: height - 92, width, height: 92, color: rgb(0.24, 0.22, 0.72) });
  page.drawText(sanitizeWinAnsi(title), {
    x: 42,
    y: height - 42,
    size: 18,
    font: bold,
    color: rgb(1, 1, 1)
  });
  page.drawText(sanitizeWinAnsi(subtitle), {
    x: 42,
    y: height - 66,
    size: 10.5,
    font,
    color: rgb(0.88, 0.91, 1)
  });

  return { doc, page, font, bold, y: height - 122, width, height };
}

function ensureSpace(w: PdfWriter, needed = 28): void {
  if (w.y - needed < 56) {
    w.page = w.doc.addPage([595.28, 841.89]);
    w.y = w.height - 54;
  }
}

function drawHeading(w: PdfWriter, text: string): void {
  ensureSpace(w, 34);
  w.y -= 6;
  w.page.drawText(sanitizeWinAnsi(text), {
    x: 42,
    y: w.y,
    size: 13,
    font: w.bold,
    color: rgb(0.15, 0.16, 0.45)
  });
  w.y -= 8;
  w.page.drawLine({
    start: { x: 42, y: w.y },
    end: { x: w.width - 42, y: w.y },
    thickness: 0.8,
    color: rgb(0.85, 0.87, 0.94)
  });
  w.y -= 16;
}

function drawParagraph(w: PdfWriter, text: string, size = 10.5): void {
  const lines = wrapLines(text, w.font, size, w.width - 84);
  for (const line of lines) {
    ensureSpace(w, 16);
    if (line.length > 0) {
      w.page.drawText(line, { x: 42, y: w.y, size, font: w.font, color: rgb(0.12, 0.15, 0.22) });
    }
    w.y -= 15;
  }
  w.y -= 4;
}

function drawKeyValue(w: PdfWriter, label: string, value: string): void {
  ensureSpace(w, 18);
  w.page.drawText(sanitizeWinAnsi(`${label} : `), {
    x: 42,
    y: w.y,
    size: 10.5,
    font: w.bold,
    color: rgb(0.12, 0.15, 0.22)
  });
  const offset = w.bold.widthOfTextAtSize(sanitizeWinAnsi(`${label} : `), 10.5);
  w.page.drawText(sanitizeWinAnsi(value), {
    x: 42 + offset,
    y: w.y,
    size: 10.5,
    font: w.font,
    color: rgb(0.2, 0.24, 0.32)
  });
  w.y -= 16;
}

export async function generateConvocationPdf(input: {
  schoolName: string;
  mdlName: string;
  assemblyTitle: string;
  scheduledAt: string;
  location: string;
  description: string;
  quorumRequired: number;
}): Promise<Uint8Array> {
  const w = await createWriter(
    'CONVOCATION — ASSEMBLEE GENERALE',
    `${input.mdlName} • ${input.schoolName}`
  );
  drawHeading(w, 'Informations de la seance');
  drawKeyValue(w, 'Objet', input.assemblyTitle);
  drawKeyValue(w, 'Date et heure', input.scheduledAt);
  drawKeyValue(w, 'Lieu', input.location);
  drawKeyValue(w, 'Quorum requis', `${input.quorumRequired} adherents`);
  drawHeading(w, 'Ordre du jour');
  drawParagraph(w, input.description || '1. Bilan moral et financier\n2. Election du nouveau bureau\n3. Questions diverses');
  drawHeading(w, 'Modalites de participation');
  drawParagraph(
    w,
    'Tout adherent a jour de cotisation dispose d une voix. Le vote peut s effectuer en salle via QR code ou en ligne pendant la fenetre horaire ouverte.'
  );
  return w.doc.save();
}

export async function generateEmargementPdf(input: {
  schoolName: string;
  mdlName: string;
  assemblyTitle: string;
  scheduledAt: string;
  members: Array<{ fullName: string; classe: string; present: boolean }>;
}): Promise<Uint8Array> {
  const w = await createWriter(
    'FEUILLE D EMARGEMENT',
    `${input.mdlName} • ${input.assemblyTitle} (${input.scheduledAt})`
  );
  drawHeading(w, `Liste des adherents (${input.members.length})`);
  for (const m of input.members) {
    ensureSpace(w, 22);
    const status = m.present ? '[PRESENT]' : '[        ]';
    w.page.drawText(sanitizeWinAnsi(`${status}  ${m.fullName} (${m.classe})`), {
      x: 42,
      y: w.y,
      size: 10,
      font: w.font,
      color: rgb(0.1, 0.14, 0.2)
    });
    w.page.drawLine({
      start: { x: 400, y: w.y - 2 },
      end: { x: w.width - 42, y: w.y - 2 },
      thickness: 0.5,
      color: rgb(0.7, 0.74, 0.8)
    });
    w.y -= 20;
  }
  return w.doc.save();
}

export async function generatePvAgPdf(input: {
  schoolName: string;
  mdlName: string;
  assemblyTitle: string;
  scheduledAt: string;
  location: string;
  totalVoters: number;
  quorumRequired: number;
  blankVotes: number;
  candidates: Array<{ fullName: string; classe: string; positionTitle: string; votesCount: number }>;
}): Promise<Uint8Array> {
  const w = await createWriter(
    'PROCES-VERBAL D ASSEMBLEE GENERALE',
    `${input.mdlName} • ${input.schoolName} (Modele officiel Loi 1901)`
  );
  drawHeading(w, '1. Constat du quorum');
  drawKeyValue(w, 'Assemblee', input.assemblyTitle);
  drawKeyValue(w, 'Date et lieu', `${input.scheduledAt} - ${input.location}`);
  drawKeyValue(w, 'Votants enregistres', String(input.totalVoters));
  drawKeyValue(w, 'Quorum statutaire', String(input.quorumRequired));
  drawKeyValue(w, 'Quorum atteint', input.totalVoters >= input.quorumRequired ? 'OUI' : 'NON');

  drawHeading(w, '2. Resultats du scrutin');
  drawKeyValue(w, 'Bulletins blancs', String(input.blankVotes));
  const sorted = [...input.candidates].sort((a, b) => b.votesCount - a.votesCount);
  for (const c of sorted) {
    drawParagraph(w, `• ${c.fullName} (${c.classe}) — Poste : ${c.positionTitle} — ${c.votesCount} voix`);
  }

  drawHeading(w, '3. Proclamation et signatures');
  drawParagraph(
    w,
    'Les votes ont ete anonymises apres proclamation conformement au RGPD. Le present proces-verbal est arrete et signe pour valoir ce que de droit.'
  );
  ensureSpace(w, 60);
  w.y -= 10;
  w.page.drawText('Signature President(e) sortant(e) :', { x: 42, y: w.y, size: 10, font: w.bold });
  w.page.drawText('Signature Professeur referent :', { x: 320, y: w.y, size: 10, font: w.bold });
  return w.doc.save();
}

export async function generateBudgetReportPdf(input: {
  schoolName: string;
  mdlName: string;
  fiscalYear: string;
  totalRecettesCents: number;
  totalDepensesCents: number;
  entries: Array<{ entryDate: string; type: string; category: string; label: string; amountCents: number }>;
}): Promise<Uint8Array> {
  const w = await createWriter(
    'BILAN FINANCIER & JOURNAL DE TRESORERIE',
    `${input.mdlName} • ${input.schoolName} • Exercice ${input.fiscalYear}`
  );
  const solde = input.totalRecettesCents - input.totalDepensesCents;
  drawHeading(w, 'Synthese de l exercice');
  drawKeyValue(w, 'Total recettes', `${(input.totalRecettesCents / 100).toFixed(2)} EUR`);
  drawKeyValue(w, 'Total depenses', `${(input.totalDepensesCents / 100).toFixed(2)} EUR`);
  drawKeyValue(w, 'Solde net', `${(solde / 100).toFixed(2)} EUR`);

  drawHeading(w, `Detail des ecritures (${input.entries.length})`);
  for (const e of input.entries) {
    const sign = e.type === 'recette' ? '+' : '-';
    drawParagraph(
      w,
      `${e.entryDate} | ${e.type.toUpperCase()} | ${e.category} | ${e.label} : ${sign}${(e.amountCents / 100).toFixed(2)} EUR`,
      9.5
    );
  }
  return w.doc.save();
}

export async function generateParcoursupPdf(input: {
  schoolName: string;
  mdlName: string;
  studentName: string;
  classe: string;
  roleLabel: string;
  schoolYear: string;
  hoursTotal: number;
  projectsList: string[];
  skills: string[];
  summaryText: string;
}): Promise<Uint8Array> {
  const w = await createWriter(
    'ATTESTATION D ENGAGEMENT LYCEEN — PARCOURSUP',
    `${input.mdlName} • ${input.schoolName} • Annee ${input.schoolYear}`
  );
  drawHeading(w, 'Identite et mandat');
  drawKeyValue(w, 'Eleve', `${input.studentName} (${input.classe})`);
  drawKeyValue(w, 'Fonction exercee', input.roleLabel);
  drawKeyValue(w, 'Volume horaire estime', `${input.hoursTotal} heures`);

  drawHeading(w, 'Projets et realisations');
  if (input.projectsList.length === 0) {
    drawParagraph(w, 'Participation active aux reunions et activites de la Maison des Lyceens.');
  } else {
    for (const p of input.projectsList) {
      drawParagraph(w, `• ${p}`);
    }
  }

  drawHeading(w, 'Competences mobilisees');
  drawParagraph(w, input.skills.length ? input.skills.join(' • ') : 'Gestion de projet, travail en equipe, responsabilite associative.');

  drawHeading(w, 'Synthese redigee par l eleve');
  drawParagraph(w, input.summaryText || 'Engagement benevole au sein de la Maison des Lyceens.');

  ensureSpace(w, 60);
  w.y -= 10;
  w.page.drawText('Visa du Professeur referent / Chef d etablissement :', {
    x: 42,
    y: w.y,
    size: 10,
    font: w.bold
  });
  return w.doc.save();
}

export async function generateMeetingMinutesPdf(input: {
  schoolName: string;
  mdlName: string;
  title: string;
  scheduledAt: string;
  location: string;
  scope: string;
  agenda: Array<{ title: string; durationMin?: number; done?: boolean }>;
  attendees: Array<{ name: string; roleLabel: string; rsvpStatus: string; checkedIn: boolean }>;
  minutesText: string;
}): Promise<Uint8Array> {
  const w = await createWriter(
    'COMPTE-RENDU DE REUNION MDL',
    `${input.mdlName} • ${input.schoolName}`
  );
  drawHeading(w, input.title);
  drawKeyValue(w, 'Date et heure', new Date(input.scheduledAt).toLocaleString('fr-FR'));
  drawKeyValue(w, 'Lieu', input.location);
  drawKeyValue(w, 'Public', input.scope);

  drawHeading(w, `Participants (${input.attendees.length})`);
  if (input.attendees.length === 0) {
    drawParagraph(w, 'Aucune reponse enregistree.');
  } else {
    for (const a of input.attendees) {
      drawParagraph(
        w,
        `• ${a.name} (${a.roleLabel}) — Reponse : ${a.rsvpStatus}${a.checkedIn ? ' [Emarge]' : ''}`,
        10
      );
    }
  }

  drawHeading(w, `Ordre du jour (${input.agenda.length} point(s))`);
  if (input.agenda.length === 0) {
    drawParagraph(w, 'Aucun point specifique saisi.');
  } else {
    input.agenda.forEach((item, idx) => {
      const dur = item.durationMin ? ` (${item.durationMin} min)` : '';
      const mark = item.done ? '[Traite] ' : '';
      drawParagraph(w, `${idx + 1}. ${mark}${item.title}${dur}`, 10);
    });
  }

  drawHeading(w, 'Releve de decisions & compte-rendu');
  drawParagraph(w, input.minutesText || 'Compte-rendu en attente de redaction.');
  return w.doc.save();
}

export async function generateEstablishmentAccordPdf(input: {
  schoolName: string;
  mdlName: string;
  schoolYear: string;
  legalRepresentative: string;
  presidentName: string;
  bodyText: string;
}): Promise<Uint8Array> {
  const w = await createWriter(
    'DEMANDE D ACCORD DU CHEF D ETABLISSEMENT',
    `${input.mdlName} • ${input.schoolName} • Annee ${input.schoolYear}`
  );
  drawKeyValue(w, 'Destinataire', input.legalRepresentative || 'Monsieur / Madame le Proviseur');
  drawKeyValue(w, 'Association', `${input.mdlName} — ${input.schoolName}`);
  drawKeyValue(w, 'Signataire MDL', input.presidentName || 'Le bureau de la MDL');

  w.y -= 8;
  drawParagraph(w, input.bodyText, 10.5);

  ensureSpace(w, 80);
  w.y -= 16;
  w.page.drawText('Signature du President / de la Presidente :', {
    x: 42,
    y: w.y,
    size: 10,
    font: w.bold
  });
  w.page.drawText('Visa et accord du Chef d etablissement :', {
    x: 310,
    y: w.y,
    size: 10,
    font: w.bold
  });
  return w.doc.save();
}
