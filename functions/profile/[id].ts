import { loadCmsProfileRecord, siteCmsConfig, type SiteCmsEnv } from '../_lib/siteCms';

interface PagesContext {
  request: Request;
  env: SiteCmsEnv;
  params?: { id?: string | string[] };
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function staticAsset(context: PagesContext, request: Request): Promise<Response | null> {
  if (!context.env.ASSETS) return null;
  try { return await context.env.ASSETS.fetch(request); } catch { return null; }
}

async function staticAssetText(context: PagesContext, request: Request, paths: string[], allowedStatuses: number[]): Promise<string> {
  for (const path of paths) {
    const response = await staticAsset(context, new Request(new URL(path, request.url), request));
    if (!response || !allowedStatuses.includes(response.status)) continue;
    const text = await response.text().catch(() => '');
    if (text.trim()) return text;
  }
  return '';
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const { request, env } = context;
  const rawId = Array.isArray(context.params?.id) ? context.params.id[0] : context.params?.id;
  const id = String(rawId || '').trim();
  const assetResponse = await staticAsset(context, request);

  let record = null;
  if (id && siteCmsConfig(env).databaseConfigured) {
    try { record = await loadCmsProfileRecord(env, id); } catch { record = null; }
  }

  if (record && (record.status === 'hidden' || record.status === 'deleted')) {
    // A direct request for canonical /404 is a 200 asset response in Pages;
    // accept it here while still returning a real 404 for the hidden profile.
    const notFoundHtml = await staticAssetText(context, request, ['/404', '/404.html'], [200, 404]);
    return new Response(notFoundHtml || 'Profile not found', {
      status: 404,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'private, no-store',
        'x-robots-tag': 'noindex, nofollow',
      },
    });
  }

  if (assetResponse && assetResponse.status !== 404) return assetResponse;

  if (record?.status === 'published' && record.origin === 'cms' && record.profile) {
    // Pages canonicalizes /index.html to /, often with an empty redirect body.
    // Fetch the canonical root shell first and never return an empty 200 page.
    const shellHtml = await staticAssetText(context, request, ['/', '/index.html'], [200]);
    if (shellHtml.includes('<div id="root"></div>')) {
      const profile = record.profile;
      const siteUrl = (env.SITE_URL || new URL(request.url).origin).replace(/\/+$/, '');
      const canonical = `${siteUrl}/profile/${encodeURIComponent(profile.id)}/`;
      const title = `${profile.name} (${profile.handle}) — FansLeak`;
      const description = profile.bio.slice(0, 180);
      const html = shellHtml
        .replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(title)}</title>`)
        .replace(/<meta\s+name=["']description["'][^>]*>/i, `<meta name="description" content="${escapeHtml(description)}" />`)
        .replace(/<link\s+rel=["']canonical["'][^>]*>/i, `<link rel="canonical" href="${escapeHtml(canonical)}" />`)
        .replace(/<meta\s+property=["']og:image["'][^>]*>/i, `<meta property="og:image" content="${escapeHtml(profile.heroUrl || profile.avatarUrl)}" />`);
      return new Response(html, {
        status: 200,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'public, max-age=0, must-revalidate',
          'x-robots-tag': 'index, follow',
        },
      });
    }
  }

  return assetResponse || new Response('Profile not found', { status: 404, headers: { 'x-robots-tag': 'noindex, nofollow' } });
}
