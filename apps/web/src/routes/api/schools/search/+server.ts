import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export interface SchoolSearchHit {
  uai: string;
  name: string;
  city: string;
  postalCode: string;
  department: string;
  academy: string;
  address: string;
}

export const GET: RequestHandler = async ({ url }) => {
  const query = (url.searchParams.get('q') || '').trim();
  if (query.length < 2) {
    return json({ ok: true, results: [] satisfies SchoolSearchHit[], source: 'none' });
  }

  const tokens = query
    .replace(/["'\\;]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2)
    .slice(0, 5);

  if (tokens.length === 0) {
    return json({ ok: true, results: [] satisfies SchoolSearchHit[], source: 'none' });
  }

  const clauses = tokens.map(
    (t) =>
      `(search(nom_etablissement, "${t}") OR search(nom_commune, "${t}") OR search(code_postal, "${t}"))`
  );
  const where = `(${clauses.join(' AND ')}) AND (type_etablissement="Lycée" OR type_etablissement="EREA")`;

  const apiUrl = new URL(
    'https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/fr-en-annuaire-education/records'
  );
  apiUrl.searchParams.set('where', where);
  apiUrl.searchParams.set('limit', '10');
  apiUrl.searchParams.set(
    'select',
    'identifiant_de_l_etablissement,nom_etablissement,nom_commune,code_postal,libelle_departement,libelle_academie,adresse_1'
  );

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
    const res = await fetch(apiUrl.toString(), { signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) {
      return json({ ok: true, results: [] satisfies SchoolSearchHit[], source: 'unavailable' });
    }

    const payload = (await res.json()) as {
      results?: Array<{
        identifiant_de_l_etablissement?: string;
        nom_etablissement?: string;
        nom_commune?: string;
        code_postal?: string;
        libelle_departement?: string;
        libelle_academie?: string;
        adresse_1?: string;
      }>;
    };

    const hits: SchoolSearchHit[] = (payload.results ?? [])
      .filter((r) => r.nom_etablissement && r.nom_commune)
      .map((r) => ({
        uai: r.identifiant_de_l_etablissement || '',
        name: r.nom_etablissement || '',
        city: r.nom_commune || '',
        postalCode: r.code_postal || '',
        department: r.libelle_departement || '',
        academy: r.libelle_academie || '',
        address: r.adresse_1 || ''
      }));

    return json({ ok: true, results: hits, source: 'education.gouv.fr' });
  } catch {
    return json({ ok: true, results: [] satisfies SchoolSearchHit[], source: 'offline' });
  }
};
