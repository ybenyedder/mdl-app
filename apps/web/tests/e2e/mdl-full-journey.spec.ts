import { expect, test } from '@playwright/test';

// PNG 1x1 valide (magic bytes PNG + IHDR + IDAT + IEND) pour tester l'upload de justificatif chiffré AES-256-GCM
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

async function loginThroughUi(page: import('@playwright/test').Page, email: string, password: string) {
  await page.goto('/connexion');
  await page.locator('#login-email').fill(email);
  await page.locator('#login-password').fill(password);
  await Promise.all([
    page.waitForURL((url) => url.pathname.startsWith('/dashboard') || url.pathname === '/'),
    page.getByRole('button', { name: /se connecter/i }).click()
  ]);
}

test.describe('MDL Connect — Parcours E2E complet', () => {
  test('parcours public, inscription élève, validation adhésion, AG + vote + PV PDF, projets Kanban, budget + justificatif + export, sondage, billetterie Ed25519 hors-ligne + sync, passation, Parcoursup, RGPD et admin', async ({
    page,
    context
  }, testInfo) => {
    test.setTimeout(120_000);
    const suffix = `${testInfo.project.name}-${Date.now()}`.replace(/[^a-zA-Z0-9-]/g, '');
    const studentEmail = `eleve-${suffix}@mdl-demo.fr`;
    const studentPass = 'LyceeTest2026!';
    const isMobile = testInfo.project.name === 'mobile-android';

    // 1. Page d'accueil publique, manifest PWA, langue FR et /confidentialite
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    const healthRes = await page.request.get('/api/health');
    expect(healthRes.status()).toBe(200);
    expect(healthRes.headers()['cache-control']).toContain('no-store');
    const healthJson = await healthRes.json();
    expect(healthJson.ok).toBe(true);
    expect(healthJson.ticketPublicKeyHex).toMatch(/^[0-9a-f]{64}$/);

    await page.goto('/confidentialite');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // 2. Inscription d'un élève mineur (consentement RGPD + email responsable légal)
    await page.goto('/inscription');
    await page.locator('#reg-first-name').fill('Yanis');
    await page.locator('#reg-last-name').fill(`Durand${suffix.slice(-4)}`);
    await page.locator('#reg-classe').fill('1ère G3');
    await page.locator('#reg-email').fill(studentEmail);
    await page.locator('#reg-password').fill(studentPass);
    await page.locator('#reg-guardian-email').fill(`parent-${suffix}@exemple.fr`);
    await page.locator('input[type="checkbox"]').first().check();

    const [regRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/auth/register') && r.request().method() === 'POST'),
      page.getByRole('button', { name: /créer mon compte/i }).click()
    ]);
    expect(regRes.status()).toBe(201);

    // Vérifier la connexion immédiate en tant que nouvel élève puis déconnexion
    await page.waitForURL((url) => url.pathname.startsWith('/dashboard'));
    await expect(page.locator('h1')).toBeVisible();

    const logoutRes = await page.request.post('/api/auth/logout');
    expect(logoutRes.ok()).toBe(true);

    // 3. Connexion Présidente (bureau) -> Validation de l'adhésion de l'élève inscrit
    await loginThroughUi(page, 'president@mdl-demo.fr', 'MdlDemo2026!');
    await page.goto('/membres');
    await expect(page.getByRole('heading', { name: /annuaire bureau & adhérents/i })).toBeVisible();

    await page.locator('#member-search').fill(studentEmail);
    await expect(page.getByText(studentEmail)).toBeVisible();

    const validateBtn = page.getByRole('button', { name: /valider adhésion/i }).first();
    await expect(validateBtn).toBeVisible();
    const [patchMemberRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/members/') && r.request().method() === 'PATCH'),
      validateBtn.click()
    ]);
    expect(patchMemberRes.status()).toBe(200);

    // 4. Assemblée Générale complète : création -> candidatures -> émargement -> dépôt candidature -> vote -> clôture & anonymisation -> PV PDF
    await page.goto('/ag');
    await expect(page.getByRole('heading', { name: /assemblées générales/i })).toBeVisible();

    await page.getByRole('button', { name: /nouvelle ag/i }).click();
    await page.locator('#ag-title').fill(`AG E2E ${suffix}`);
    await page.locator('#ag-quorum').fill('1');
    await page.locator('#ag-location').fill('Amphithéâtre Jean Moulin');
    await page.locator('#ag-desc').fill('Ordre du jour automatisé E2E.');
    const [createAgRes] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/api/assemblies') && r.request().method() === 'POST'),
      page.getByRole('button', { name: /créer l’assemblée/i }).click()
    ]);
    expect(createAgRes.status()).toBe(201);
    const createdAgBody = await createAgRes.json();
    const agId = createdAgBody.assembly.id as number;

    // Émargement personnel (quorum = 1 -> atteint)
    await page.getByRole('button', { name: /signer ma présence/i }).click();
    await expect(page.getByText(/quorum atteint/i)).toBeVisible();

    // Ouvrir candidatures & déposer une candidature
    await page.getByRole('button', { name: /ouvrir les candidatures/i }).click();
    await page.getByRole('button', { name: /déposer ma candidature/i }).click();
    await page.locator('#cand-name').fill(`Candidat ${suffix}`);
    await page.locator('#cand-classe').fill('Tle G2');
    await page.locator('#cand-pos').fill('Président(e)');
    await page.locator('#cand-faith').fill('Améliorer le foyer et organiser la semaine des arts au lycée.');
    const [candRes] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes(`/api/assemblies/${agId}`) && r.request().method() === 'POST'
      ),
      page.getByRole('button', { name: /publier ma candidature/i }).click()
    ]);
    expect(candRes.status()).toBe(201);

    // Ouvrir le vote
    await page.getByRole('button', { name: /ouvrir le vote/i }).click();
    await expect(page.getByText(/sélectionnez votre choix/i)).toBeVisible();

    // Voter pour le candidat
    await page.locator('input[name="ag-vote-choice"]').first().check();
    const [voteRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes(`/api/assemblies/${agId}/vote`) && r.request().method() === 'POST'),
      page.getByRole('button', { name: /confirmer mon vote/i }).click()
    ]);
    expect(voteRes.status()).toBe(201);

    // Clôture & anonymisation des votes
    await page.getByRole('button', { name: /clôture & anonymisation des votes/i }).click();
    const [closeAgRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes(`/api/assemblies/${agId}`) && r.request().method() === 'PATCH'),
      page.getByRole('button', { name: /clôturer & anonymiser/i }).click()
    ]);
    expect(closeAgRes.status()).toBe(200);

    // Vérification téléchargement PV PDF valide (%PDF-)
    const pvPdfRes = await page.request.get(`/api/assemblies/${agId}/pdf?type=pv`);
    expect(pvPdfRes.status()).toBe(200);
    expect(pvPdfRes.headers()['content-type']).toContain('application/pdf');
    const pvBytes = await pvPdfRes.body();
    expect(pvBytes.subarray(0, 5).toString('ascii')).toBe('%PDF-');

    // 5. Projets + Kanban
    await page.goto('/projets');
    await expect(page.getByRole('heading', { name: /projets/i })).toBeVisible();
    await page.getByRole('button', { name: /nouveau projet/i }).click();
    await page.locator('#new-proj-title').fill(`Tournoi E2E ${suffix}`);
    await page.locator('#new-proj-budget').fill('320');
    await page.locator('#new-proj-desc').fill('Organisation tournoi inter-classes E2E.');
    const [projRes] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/api/projects') && r.request().method() === 'POST'),
      page.getByRole('button', { name: /créer le projet/i }).click()
    ]);
    expect(projRes.status()).toBe(201);
    const createdProject = await projRes.json();
    const projectId = createdProject.project.id as number;

    await page.goto(`/projets/${projectId}`);
    await expect(page.getByRole('heading', { name: new RegExp(`Tournoi E2E ${suffix}`) })).toBeVisible();
    await page.locator('#task-title-input').fill(`Réserver gymnase ${suffix}`);
    const [taskRes] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes(`/api/projects/${projectId}/tasks`) && r.request().method() === 'POST'
      ),
      page.getByRole('region', { name: 'Kanban des tâches' }).getByRole('button', { name: /^ajouter$/i }).click()
    ]);
    expect(taskRes.status()).toBe(201);
    await expect(page.getByRole('region', { name: 'Colonne À faire' }).getByText(`Réserver gymnase ${suffix}`)).toBeVisible();

    // 6. Budget + Upload justificatif PNG chiffré AES-256-GCM + Exports CSV & PDF
    await page.goto('/budget');
    await expect(page.getByRole('heading', { name: /trésorerie|budget/i })).toBeVisible();
    await page.getByRole('button', { name: /ajouter une écriture/i }).click();
    await page.locator('#entry-label').fill(`Facture matériel E2E ${suffix}`);
    await page.locator('#entry-category').fill('Événements');
    await page.locator('#entry-amount').fill('42.50');
    await page.locator('#entry-receipt-file').setInputFiles({
      name: 'justificatif-e2e.png',
      mimeType: 'image/png',
      buffer: Buffer.from(TINY_PNG_BASE64, 'base64')
    });
    const [budgetRes] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/api/budget') && r.request().method() === 'POST'),
      page.getByRole('button', { name: /enregistrer l’écriture/i }).click()
    ]);
    expect(budgetRes.status()).toBe(201);
    await expect(page.getByText(`Facture matériel E2E ${suffix}`).filter({ visible: true }).first()).toBeVisible();

    const csvRes = await page.request.get('/api/budget/export?format=csv');
    expect(csvRes.status()).toBe(200);
    expect(csvRes.headers()['content-type']).toContain('text/csv');
    const csvText = await csvRes.text();
    expect(csvText).toContain(`Facture matériel E2E ${suffix}`);

    const budgetPdfRes = await page.request.get('/api/budget/export?format=pdf');
    expect(budgetPdfRes.status()).toBe(200);
    expect((await budgetPdfRes.body()).subarray(0, 5).toString('ascii')).toBe('%PDF-');

    // 7. Sondages temps réel (création + vote)
    await page.goto('/sondages');
    await expect(page.getByRole('heading', { name: /sondages/i })).toBeVisible();
    await page.getByRole('button', { name: /créer en 30 s/i }).click();
    await page.locator('#poll-title').fill(`Thème bal E2E ${suffix}`);
    await page.locator('#poll-opt-0').fill('Années 90');
    await page.locator('#poll-opt-1').fill('Cinéma');
    const [pollCreateRes] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/api/polls') && r.request().method() === 'POST'),
      page.getByRole('button', { name: /publier le sondage/i }).click()
    ]);
    expect(pollCreateRes.status()).toBe(201);
    await expect(page.getByText(`Thème bal E2E ${suffix}`).first()).toBeVisible();
    await page.getByRole('button', { name: /années 90/i }).first().click();

    // 8. Billetterie + Ed25519 QR + Encaissement + Scanner Offline WASM + Sync
    await page.goto('/billetterie');
    await expect(page.getByRole('heading', { name: /billetterie/i })).toBeVisible();

    await page.getByRole('button', { name: /nouvel événement/i }).click();
    await page.locator('#ev-title').fill(`Concert E2E ${suffix}`);
    await page.locator('#ev-desc').fill('Soirée concert lycéen E2E.');
    await page.locator('#ev-date').fill('2027-05-20T20:00');
    await page.locator('#ev-location').fill('Salle polyvalente');
    await page.locator('#ev-cap').fill('150');
    await page.locator('#ev-p-full').fill('5');
    await page.locator('#ev-p-red').fill('3');
    await page.locator('#ev-p-pre').fill('4');
    const [evRes] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/api/events') && r.request().method() === 'POST'),
      page.getByRole('button', { name: /publier l'événement/i }).click()
    ]);
    expect(evRes.status()).toBe(201);

    // Acheter un billet sur l'événement créé (<article> contenant le h2)
    const evCard = page
      .getByRole('article')
      .filter({ has: page.getByRole('heading', { name: `Concert E2E ${suffix}` }) });
    await evCard.getByRole('button', { name: /réserver ma place/i }).click();
    await page.locator('#ticket-buyer-name').fill(`Spectateur ${suffix}`);
    await page.locator('#ticket-buyer-classe').fill('Tle G2');
    await page.locator('#ticket-buyer-email').fill(studentEmail);
    const [ticketRes] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/api/tickets') && r.request().method() === 'POST'),
      page.locator('button[form="buy-ticket-form"]').click()
    ]);
    expect(ticketRes.status()).toBe(201);
    const ticketPayload = await ticketRes.json();
    const ed25519Token = ticketPayload.ticket.ed25519Token as string;
    const qrCodeId = ticketPayload.ticket.qrCodeId as string;
    expect(ed25519Token).toMatch(/^MDL1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

    // Fermer la modal billet puis marquer payé dans le suivi admin
    await page.getByRole('button', { name: /voir tous mes billets/i }).click();
    await page.getByRole('tab', { name: /gestion & encaissements/i }).click();
    await page.locator('#admin-ticket-search').fill(qrCodeId);
    await page.getByRole('button', { name: /actualiser/i }).click();
    const [encaisserRes] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/api/tickets') && r.request().method() === 'PATCH'),
      page.getByRole('button', { name: /encaisser/i }).first().click()
    ]);
    expect(encaisserRes.status()).toBe(200);

    // Tester le scanner Ed25519 en mode HORS-LIGNE (WASM Rust + IndexedDB) puis synchronisation
    await page.goto('/billetterie/scanner');
    await expect(page.getByRole('heading', { name: /scanner d'entrée pwa/i })).toBeVisible();
    await expect(page.getByText(/clé ed25519 (à jour|en cache)/i)).toBeVisible();

    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));

    await page.locator('#manual-qr-input').fill(ed25519Token);
    await page.getByRole('button', { name: /vérifier ce qr/i }).click();
    await expect(page.getByText(/validé hors-ligne \(ed25519 ok\)/i).first()).toBeVisible();

    // Anti double-scan local immédiat hors-ligne
    await page.locator('#manual-qr-input').fill(ed25519Token);
    await page.getByRole('button', { name: /vérifier ce qr/i }).click();
    await expect(page.getByText(/déjà scanné sur cet appareil/i).first()).toBeVisible();

    // Retour en ligne et synchronisation serveur (auto-sync déclenchée sur l'événement 'online')
    const syncResPromise = page.waitForResponse(
      (r) => r.url().includes('/api/tickets/scan') && r.request().method() === 'POST'
    );
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    const syncRes = await syncResPromise;
    expect(syncRes.status()).toBe(200);
    await expect(page.getByText(/en attente de synchronisation/i)).toHaveCount(0);

    // 9. Passation, Parcoursup, Profil RGPD et Administration
    await page.goto('/passation');
    await expect(page.getByRole('heading', { name: /passation/i })).toBeVisible();

    await page.goto('/parcoursup');
    await expect(page.getByRole('heading', { name: /parcoursup/i })).toBeVisible();
    const parcoursupPutRes = await page.request.put('/api/parcoursup', {
      data: {
        hoursTotal: 45,
        summaryText: 'Engagement actif au bureau MDL pour les projets culturels et solidaires.',
        skills: ['Gestion de projet', 'Communication']
      }
    });
    expect(parcoursupPutRes.status()).toBe(200);
    const parcoursupPdfRes = await page.request.get('/api/parcoursup?format=pdf');
    expect(parcoursupPdfRes.status()).toBe(200);
    expect(parcoursupPdfRes.headers()['content-type']).toContain('application/pdf');
    expect((await parcoursupPdfRes.body()).subarray(0, 5).toString('ascii')).toBe('%PDF-');

    await page.goto('/profil');
    await expect(page.getByRole('heading', { name: /mon profil/i })).toBeVisible();
    const rgpdExportRes = await page.request.get('/api/rgpd/export');
    expect(rgpdExportRes.status()).toBe(200);
    const rgpdData = await rgpdExportRes.json();
    expect(rgpdData.profile.email).toBe('president@mdl-demo.fr');

    await page.goto('/admin/parametres');
    await expect(page.getByRole('heading', { name: /paramètres/i })).toBeVisible();
    await expect(page.getByText(/journal d'audit sha-256/i)).toBeVisible();

    if (isMobile) {
      // Vérifier l'absence de débordement horizontal sur mobile Android (Pixel 5)
      const hasOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2
      );
      expect(hasOverflow).toBe(false);
    }
  });
});
