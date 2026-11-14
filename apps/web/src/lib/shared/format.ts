export function formatEuros(cents: number): string {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR'
  }).format((cents || 0) / 100);
}

export function formatDateFr(iso: string | null | undefined): string {
  if (!iso) return 'Non définie';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  }).format(d);
}

export function formatDateTimeFr(iso: string | null | undefined): string {
  if (!iso) return 'Non définie';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(d);
}

export function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) return null;
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startTarget = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
  return Math.round((startTarget - startToday) / 86_400_000);
}

export function countdownLabel(iso: string | null | undefined): string {
  const days = daysUntil(iso);
  if (days === null) return 'Date à définir';
  if (days > 0) return `J-${days}`;
  if (days === 0) return 'Jour J';
  return `J+${Math.abs(days)}`;
}
