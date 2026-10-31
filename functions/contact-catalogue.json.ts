import { loadCmsProfileRecords, siteCmsConfig, type SiteCmsEnv } from './_lib/siteCms';

interface PagesContext {
  request: Request;
  env: SiteCmsEnv;
}

interface CatalogueEntry { id: string; name: string }

export async function onRequest(context: PagesContext): Promise<Response> {
  const { request, env } = context;
  let staticResponse: Response | null = null;
  try { staticResponse = env.ASSETS ? await env.ASSETS.fetch(request) : null; } catch { staticResponse = null; }

  if (!siteCmsConfig(env).databaseConfigured) {
    return staticResponse || Response.json({ version: 1, generatedAt: new Date().toISOString(), profiles: [] });
  }

  let profiles: CatalogueEntry[] = [];
  if (staticResponse?.ok) {
    try {
      const payload = await staticResponse.clone().json() as { profiles?: unknown };
      if (Array.isArray(payload.profiles)) {
        profiles = payload.profiles.flatMap(item => {
          if (!item || typeof item !== 'object') return [];
          const record = item as Record<string, unknown>;
          return typeof record.id === 'string' && typeof record.name === 'string' ? [{ id: record.id, name: record.name }] : [];
        });
      }
    } catch {
      // A malformed static catalogue falls back to CMS-only entries below.
    }
  }

  const byId = new Map(profiles.map(profile => [profile.id, profile]));
  try {
    for (const record of await loadCmsProfileRecords(env)) {
      if (!/^[A-Za-z0-9._-]{1,50}$/.test(record.id)) continue;
      if (record.status === 'hidden' || record.status === 'deleted') {
        byId.delete(record.id);
        continue;
      }
      if (record.status !== 'published') continue;
      const name = record.profile?.name || record.patch?.name || byId.get(record.id)?.name;
      if (name) byId.set(record.id, { id: record.id, name: name.slice(0, 120) });
    }
  } catch {
    return staticResponse || Response.json({ version: 1, generatedAt: new Date().toISOString(), profiles });
  }

  return Response.json(
    { version: 1, generatedAt: new Date().toISOString(), profiles: [...byId.values()] },
    { headers: { 'cache-control': 'public, max-age=60, stale-while-revalidate=120' } },
  );
}
