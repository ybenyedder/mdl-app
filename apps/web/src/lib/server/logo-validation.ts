/**
 * Validate optional school logo URLs before persisting them in settings.
 * Allows local paths (`/logo.svg`) and rejects direct HTTP endpoints that
 * explicitly respond with a non-image content type (e.g. search proxy HTML/text).
 */
export async function validateLogoUrlInput(
  rawUrl: string | null | undefined
): Promise<{ ok: true; value: string | null } | { ok: false; error: string }> {
  const trimmed = rawUrl?.trim() ?? '';
  if (!trimmed) {
    return { ok: true, value: null };
  }

  if (trimmed.startsWith('/')) {
    return { ok: true, value: trimmed };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      ok: false,
      error: 'URL de logo invalide. Utilise un lien direct https://... ou /logo.svg.'
    };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return {
      ok: false,
      error: 'Le logo doit utiliser https://, http:// ou un chemin local /logo.svg.'
    };
  }

  if (parsed.hostname === 'imgs.search.brave.com') {
    return {
      ok: false,
      error:
        'Les liens proxy Brave Search ne renvoient pas l’image directe. Utilise l’URL directe de l’image (.png, .jpg, .svg) ou laisse vide pour le logo MDL par défaut.'
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const res = await fetch(parsed.toString(), {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal
    });
    if (res.ok) {
      const contentType = (res.headers.get('content-type') || '').toLowerCase();
      if (contentType && !contentType.startsWith('image/')) {
        return {
          ok: false,
          error:
            'Cette URL ne renvoie pas une image directe (format reçu : ' +
            contentType.split(';')[0] +
            '). Colle le lien direct vers le fichier image ou laisse vide.'
        };
      }
    }
  } catch {
    // Offline / restricted network or test environment: do not block saving.
  } finally {
    clearTimeout(timer);
  }

  return { ok: true, value: trimmed };
}
