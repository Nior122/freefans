import { loadCmsProfileRecords, siteCmsConfig, type SiteCmsEnv } from './_lib/siteCms';

interface PagesContext {
  request: Request;
  env: SiteCmsEnv;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const { request, env } = context;
  let staticResponse: Response | null = null;
  try { staticResponse = env.ASSETS ? await env.ASSETS.fetch(request) : null; } catch { staticResponse = null; }
  if (!staticResponse?.ok || !siteCmsConfig(env).databaseConfigured) {
    return staticResponse || new Response('Sitemap unavailable', { status: 404 });
  }

  let xml = await staticResponse.text();
  const siteUrl = (env.SITE_URL || new URL(request.url).origin).replace(/\/+$/, '');

  try {
    const records = await loadCmsProfileRecords(env);
    for (const record of records) {
      const profilePath = `/profile/${record.id}/`;
      if (record.status === 'hidden' || record.status === 'deleted') {
        const pattern = new RegExp(`\\s*<url>\\s*<loc>[^<]*${escapeRegex(profilePath)}</loc>[\\s\\S]*?</url>`, 'g');
        xml = xml.replace(pattern, '');
        continue;
      }
      if (record.status !== 'published' || record.origin !== 'cms') continue;
      const loc = `${siteUrl}${profilePath}`;
      if (xml.includes(`<loc>${escapeXml(loc)}</loc>`)) continue;
      const lastmod = (record.updatedAt || new Date().toISOString()).slice(0, 10);
      xml = xml.replace('</urlset>', `  <url>\n    <loc>${escapeXml(loc)}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.6</priority>\n  </url>\n</urlset>`);
    }
  } catch {
    // The static sitemap remains valid if the optional CMS is unavailable.
  }

  return new Response(xml, {
    status: 200,
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'content-disposition': 'inline',
      'cache-control': 'public, max-age=300, stale-while-revalidate=600',
    },
  });
}
