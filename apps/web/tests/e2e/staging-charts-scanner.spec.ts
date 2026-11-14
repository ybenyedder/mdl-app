import { expect, test } from '@playwright/test';

const DEMO_EMAIL = process.env.STAGING_LOGIN_EMAIL || 'president@mdl-demo.fr';
const DEMO_PASSWORD = process.env.MDL_DEMO_PASSWORD || 'MdlDemo2026!';

async function loginAsPresident(page: import('@playwright/test').Page) {
  await page.goto('/connexion', { waitUntil: 'networkidle' });
  await page.locator('input[type="email"], input[name="email"]').fill(DEMO_EMAIL);
  await page.locator('input[type="password"], input[name="password"]').fill(DEMO_PASSWORD);
  await Promise.all([
    page.waitForURL(/\/(dashboard|setup)/, { timeout: 15000 }),
    page.locator('button[type="submit"]').click()
  ]);
  await page.waitForLoadState('networkidle');
}

test.describe('Staging Volume : Graphiques Budget & Scanner Ed25519 Hors-ligne', () => {
  test('Budget SVG/WASM avec volume, dépassements, filtres, dark/light et mobile', async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const serverErrors: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(err.message));
    page.on('response', (res) => {
      if (res.status() >= 500) serverErrors.push(`${res.status()} ${res.url()}`);
    });

    await loginAsPresident(page);

    // 1. Mode sombre desktop sur /budget avec volume de projets et catégories
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/budget', { waitUntil: 'networkidle' });
    await page.evaluate(() => {
      localStorage.setItem('theme', 'dark');
      document.documentElement.classList.add('dark');
    });

    const barChart = page.locator('svg[aria-label="Graphique comparatif prévisionnel et réel par projet"]');
    await expect(barChart).toBeVisible({ timeout: 10000 });

    const projectBars = barChart.locator('g[data-project-idx]');
    const barCount = await projectBars.count();
    expect(barCount).toBeGreaterThanOrEqual(8);

    // Au moins un projet en dépassement budgétaire (#dc2626 / aria-label)
    const overBudgetGroup = barChart.locator('g[data-project-idx][aria-label*="dépassement budgétaire"]').first();
    await expect(overBudgetGroup).toBeVisible();
    await overBudgetGroup.click();

    const barLiveRegion = page.locator('[aria-live="polite"]').filter({ hasText: 'Prévu :' });
    await expect(barLiveRegion).toContainText('Écart +');

    // Donut multi-catégories (>= 6 tranches distinctes) + sélection via légende interactive
    const donutSlices = page.locator('[data-cat-slice]');
    const sliceCount = await donutSlices.count();
    expect(sliceCount).toBeGreaterThanOrEqual(6);
    await page.locator('[data-cat-legend="0"]').click();
    await expect(page.locator('[data-cat-legend="0"]')).toHaveAttribute('aria-pressed', 'true');

    // Changement d'exercice fiscal -> 2025-2026 puis retour 2026-2027
    await page.selectOption('#budget-fiscal-year', '2025-2026');
    await expect(page.getByText('Billetterie Bal de Promo 2026').first()).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(450);

    await page.selectOption('#budget-fiscal-year', '2026-2027');
    await expect(barChart).toBeVisible();
    await expect(overBudgetGroup).toBeVisible();
    await page.waitForTimeout(500);

    if (process.env.STAGING_SCREENSHOT_DIR) {
      await page.screenshot({ path: `${process.env.STAGING_SCREENSHOT_DIR}/staging-budget-dark.png` });
    }

    // Pas de débordement horizontal en mode clair desktop non plus
    await page.evaluate(() => {
      localStorage.setItem('theme', 'light');
      document.documentElement.classList.remove('dark');
    });
    await page.waitForTimeout(150);
    const desktopOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth
    );
    expect(desktopOverflow).toBe(false);
    if (process.env.STAGING_SCREENSHOT_DIR) {
      await page.screenshot({ path: `${process.env.STAGING_SCREENSHOT_DIR}/staging-budget-light.png` });
    }

    // Responsive mobile 390x844 (sur une navigation propre pour ne pas interrompre une transition)
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(200);
    const mobileOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth
    );
    expect(mobileOverflow).toBe(false);

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(serverErrors).toEqual([]);
  });

  test('Scanner Ed25519 WASM hors-ligne (20 billets valides, 1 doublon, 1 falsifié) + sync batch', async ({
    page,
    context
  }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const serverErrors: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(err.message));
    page.on('response', (res) => {
      if (res.status() >= 500) serverErrors.push(`${res.status()} ${res.url()}`);
    });

    await loginAsPresident(page);

    // Récupérer 20 billets valides non scannés MDL1.<payload>.<sig> tant qu'on est en ligne
    const ticketsPayload = await page.evaluate(async () => {
      const res = await fetch('/api/tickets?scope=all');
      if (!res.ok) throw new Error(`HTTP ${res.status} /api/tickets?scope=all`);
      return (await res.json()) as {
        tickets: Array<{
          qrCodeId: string;
          ed25519Token: string;
          paymentStatus: string;
          scannedAt: string | null;
        }>;
      };
    });

    const unscannedValid = ticketsPayload.tickets.filter(
      (t) => t.paymentStatus === 'paye' && !t.scannedAt && t.ed25519Token.startsWith('MDL1.')
    );
    expect(unscannedValid.length).toBeGreaterThanOrEqual(20);
    const batch20 = unscannedValid.slice(0, 20);

    // Charger /billetterie/scanner en ligne pour mettre en cache la clé publique Ed25519 et précharger WASM
    await page.goto('/billetterie/scanner', { waitUntil: 'networkidle' });
    await expect(page.getByText('Clé Ed25519 à jour')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('WASM Ed25519 prêt')).toBeVisible({ timeout: 10000 });

    // Couper le réseau et déclencher l'événement offline du navigateur
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await expect(page.getByText('Mode hors-ligne')).toBeVisible();

    const qrInput = page.locator('#manual-qr-input');
    const submitBtn = page.getByRole('button', { name: 'Vérifier ce QR' });

    // Scanner 20 billets Ed25519 à la suite hors-ligne (WASM + IndexedDB)
    for (let i = 0; i < batch20.length; i++) {
      await qrInput.fill(batch20[i].ed25519Token);
      await submitBtn.click();
      await expect(page.locator('[role="status"]')).toContainText('Validé hors-ligne (Ed25519 OK)');
      await expect(page.locator('[role="status"]')).toContainText(batch20[i].qrCodeId);
    }

    // Vérifier la file d'attente hors-ligne = 20 scans
    const queueBanner = page
      .locator('div.text-sm')
      .filter({ hasText: 'scan(s) en attente de synchronisation serveur' });
    await expect(queueBanner).toBeVisible();
    await expect(queueBanner).toContainText('20');
    if (process.env.STAGING_SCREENSHOT_DIR) {
      await page.screenshot({ path: `${process.env.STAGING_SCREENSHOT_DIR}/staging-scanner-offline-20.png` });
    }

    // Tester le blocage de doublon local IndexedDB hors-ligne
    await qrInput.fill(batch20[0].ed25519Token);
    await submitBtn.click();
    await expect(page.locator('[role="status"]')).toContainText('Déjà scanné sur cet appareil');

    // Tester le rejet d'un billet falsifié (altération de la signature Ed25519)
    const parts = batch20[0].ed25519Token.split('.');
    const sig = parts[2];
    const tamperedChar = sig[0] === 'A' ? 'B' : 'A';
    const tamperedQr = `${parts[0]}.${parts[1]}.${tamperedChar}${sig.slice(1)}`;
    await qrInput.fill(tamperedQr);
    await submitBtn.click();
    await expect(page.locator('[role="status"]')).toContainText('Billet invalide ou falsifié');

    // Reconnexion réseau -> synchronisation batch automatique ou manuelle des 20 billets
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));

    await expect(page.getByText('scan(s) en attente de synchronisation serveur')).toBeHidden({
      timeout: 15000
    });

    // Vérifier en base que le 1er billet du lot est bien marqué comme déjà scanné côté serveur
    const verifyRes = await page.evaluate(async (qrText) => {
      const res = await fetch('/api/tickets/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qrText })
      });
      return res.json() as Promise<{ ok: boolean; status: string }>;
    }, batch20[0].ed25519Token);
    expect(verifyRes.ok).toBe(false);
    expect(verifyRes.status).toBe('already_scanned');

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(serverErrors).toEqual([]);
  });
});
