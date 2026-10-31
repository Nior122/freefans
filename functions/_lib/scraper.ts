import type { Image, MediaType, Profile } from '../../types';
import { clampInteger, siteCmsConfig, type SiteCmsEnv } from './siteCms';

export class ScrapeError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 422, code = 'scrape_failed') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface ScrapeInput {
  url?: unknown;
  urls?: unknown;
  maxItems?: unknown;
  maxPages?: unknown;
}

export interface ScrapeOutput {
  sourceType: 'coomer_profile' | 'coomer_post' | 'webpage' | 'direct_media';
  sourceUrl: string;
  pagesFetched: number;
  draftProfile: Profile;
  warnings: string[];
}

interface Candidate {
  url: string;
  thumbnailUrl: string;
  sourceUrl: string;
  mediaType: MediaType;
  caption: string;
  width: number;
  height: number;
  createdAt?: string;
}

interface PageData {
  finalUrl: URL;
  title: string;
  description: string;
  image: string;
  keywords: string[];
  publishedAt?: string;
  candidates: Candidate[];
  directMedia?: Candidate;
}

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bmp', 'svg']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'm4v', 'ogv']);
const MAX_HTML_BYTES = 6 * 1024 * 1024;

function isPrivateIp(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = ipv4.slice(1).map(Number);
    return a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 88 || b === 168)) ||
      (a === 198 && ((b >= 18 && b <= 19) || b === 51)) ||
      (a === 203 && b === 0) || a >= 224;
  }

  if (host.includes(':')) {
    return host === '::' || host === '::1' || host.startsWith('::ffff:') ||
      host.startsWith('fc') || host.startsWith('fd') ||
      /^fe[89ab]/.test(host) || host.startsWith('ff') || host.startsWith('2001:db8');
  }

  return false;
}

export function assertPublicHttpUrl(raw: string, base?: URL): URL {
  let url: URL;
  try {
    url = base ? new URL(raw, base) : new URL(raw);
  } catch {
    throw new ScrapeError(`Invalid URL: ${raw.slice(0, 120)}`, 400, 'invalid_url');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new ScrapeError('Only public http(s) URLs can be scraped.', 400, 'unsupported_url_protocol');
  }
  if (url.username || url.password) {
    throw new ScrapeError('URLs containing embedded credentials are not allowed.', 400, 'url_credentials_not_allowed');
  }
  if (url.port && !['80', '443'].includes(url.port)) {
    throw new ScrapeError('Only standard web ports 80 and 443 can be scraped.', 400, 'unsupported_url_port');
  }
  if (!url.hostname.includes('.') || isPrivateIp(url.hostname)) {
    throw new ScrapeError('Local, private, and reserved network URLs cannot be scraped.', 400, 'private_url_not_allowed');
  }
  return url;
}

async function readLimitedText(response: Response): Promise<string> {
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > MAX_HTML_BYTES) throw new ScrapeError('The source page is too large to scrape safely.', 413, 'source_too_large');
  if (!response.body) return '';

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_HTML_BYTES) {
      await reader.cancel();
      throw new ScrapeError('The source page is too large to scrape safely.', 413, 'source_too_large');
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

async function fetchPublic(initial: URL, env: SiteCmsEnv): Promise<{ finalUrl: URL; contentType: string; text: string }> {
  let current = initial;
  const userAgent = env.SCRAPER_USER_AGENT || 'Mozilla/5.0 FansLeakAdminImporter/1.0 (+https://fansleak.pages.dev/admin)';

  for (let redirect = 0; redirect <= 5; redirect += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let response: Response;
    try {
      response = await fetch(current.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'user-agent': userAgent,
          accept: 'text/html,application/xhtml+xml,image/*,video/*;q=0.8,*/*;q=0.5',
        },
      });
    } catch (error) {
      throw new ScrapeError(`Could not fetch the source URL: ${error instanceof Error ? error.message : 'network error'}`, 502, 'source_fetch_failed');
    } finally {
      clearTimeout(timeout);
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new ScrapeError('The source returned a redirect without a destination.', 502, 'source_redirect_failed');
      current = assertPublicHttpUrl(location, current);
      continue;
    }

    if (!response.ok) {
      throw new ScrapeError(`The source returned HTTP ${response.status}. Login, paywall, and bot-protected pages are not bypassed.`, 502, 'source_http_error');
    }

    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (contentType.startsWith('image/') || contentType.startsWith('video/')) {
      try { await response.body?.cancel(); } catch { /* already closed */ }
      return { finalUrl: current, contentType, text: '' };
    }

    return { finalUrl: current, contentType, text: await readLimitedText(response) };
  }

  throw new ScrapeError('The source redirected too many times.', 502, 'source_redirect_failed');
}

function decodeHtml(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([a-f0-9]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\\u0026/g, '&')
    .replace(/\\\//g, '/');
}

function stripTags(value: string): string {
  return decodeHtml(value.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function attr(tag: string, names: string[]): string {
  for (const name of names) {
    const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i')) || tag.match(new RegExp(`\\b${name}\\s*=\\s*([^\\s>]+)`, 'i'));
    if (match) return decodeHtml(match[2] || match[1] || '').trim();
  }
  return '';
}

function extensionOf(url: URL): string {
  const match = url.pathname.toLowerCase().match(/\.([a-z0-9]{2,5})$/);
  return match?.[1] || '';
}

function typeFromUrl(url: URL, fallback?: MediaType): MediaType | null {
  const ext = extensionOf(url);
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  return fallback || null;
}

function normaliseCoomer(url: URL): { original: URL; display: URL } {
  const original = new URL(url.toString());
  if (original.hostname === 'coomer.st' && original.pathname.startsWith('/data/')) original.hostname = 'img.coomer.st';
  if (original.hostname === 'img.coomer.st' && original.pathname.startsWith('/thumbnail/data/')) {
    original.pathname = original.pathname.replace('/thumbnail/data/', '/data/');
  }
  const display = new URL(original.toString());
  return { original, display };
}

function addCandidate(
  map: Map<string, Candidate>,
  raw: string,
  base: URL,
  options: { type?: MediaType; caption?: string; poster?: string; width?: number; height?: number; createdAt?: string } = {},
) {
  const cleaned = decodeHtml(String(raw || '').trim()).replace(/^\/\//, 'https://');
  if (!cleaned || cleaned.startsWith('data:') || cleaned.startsWith('blob:')) return;

  let parsed: URL;
  try { parsed = assertPublicHttpUrl(cleaned, base); } catch { return; }

  const mediaType = typeFromUrl(parsed, options.type);
  if (!mediaType) return;

  let { original, display } = normaliseCoomer(parsed);
  if (mediaType === 'image' && original.hostname === 'img.coomer.st' && original.pathname.startsWith('/data/')) {
    display = new URL(original.toString());
    display.pathname = display.pathname.replace('/data/', '/thumbnail/data/');
  }

  const poster = options.poster ? (() => {
    try { return assertPublicHttpUrl(options.poster, base).toString(); } catch { return ''; }
  })() : '';

  const key = display.toString();
  const width = Number(options.width) > 0 ? Number(options.width) : mediaType === 'video' ? 1080 : 800;
  const height = Number(options.height) > 0 ? Number(options.height) : mediaType === 'video' ? 1350 : 1000;
  if (width <= 2 && height <= 2) return;

  const existing = map.get(key);
  map.set(key, {
    url: display.toString(),
    thumbnailUrl: poster || display.toString(),
    sourceUrl: original.toString(),
    mediaType,
    caption: (options.caption || existing?.caption || '').slice(0, 140),
    width,
    height,
    createdAt: options.createdAt || existing?.createdAt,
  });
}

function bestSrcSet(value: string): string {
  const items = value.split(',').map(item => item.trim()).filter(Boolean).map(item => {
    const [url, descriptor = ''] = item.split(/\s+/);
    const width = descriptor.endsWith('w') ? Number(descriptor.slice(0, -1)) : 0;
    return { url, width };
  });
  items.sort((a, b) => b.width - a.width);
  return items[0]?.url || '';
}

function collectJsonLd(value: unknown, output: { names: string[]; descriptions: string[]; media: string[] }) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach(item => collectJsonLd(item, output));
    return;
  }
  const record = value as Record<string, unknown>;
  for (const [key, item] of Object.entries(record)) {
    const lower = key.toLowerCase();
    if (typeof item === 'string') {
      if (['name', 'headline', 'caption'].includes(lower)) output.names.push(item);
      if (lower === 'description') output.descriptions.push(item);
      if (['image', 'thumbnailurl', 'contenturl', 'embedurl'].includes(lower)) output.media.push(item);
    } else if (Array.isArray(item)) {
      item.forEach(child => {
        if (typeof child === 'string' && ['image', 'thumbnailurl', 'contenturl', 'embedurl'].includes(lower)) output.media.push(child);
        else collectJsonLd(child, output);
      });
    } else {
      collectJsonLd(item, output);
    }
  }
}

function parsePage(html: string, finalUrl: URL, contentType: string): PageData {
  if (contentType.startsWith('image/') || contentType.startsWith('video/')) {
    const map = new Map<string, Candidate>();
    addCandidate(map, finalUrl.toString(), finalUrl, { type: contentType.startsWith('video/') ? 'video' : 'image' });
    return { finalUrl, title: '', description: '', image: '', keywords: [], candidates: [...map.values()], directMedia: [...map.values()][0] };
  }

  const meta = new Map<string, string>();
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    const key = (attr(tag, ['property', 'name']) || '').toLowerCase();
    const content = attr(tag, ['content']);
    if (key && content && !meta.has(key)) meta.set(key, content);
  }

  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '';
  const jsonLd = { names: [] as string[], descriptions: [] as string[], media: [] as string[] };
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { collectJsonLd(JSON.parse(decodeHtml(match[1])), jsonLd); } catch { /* malformed structured data is optional */ }
  }

  const publishedAt = meta.get('article:published_time') || meta.get('datepublished') || undefined;
  const map = new Map<string, Candidate>();
  const add = (raw: string, options?: Parameters<typeof addCandidate>[3]) => addCandidate(map, raw, finalUrl, { createdAt: publishedAt, ...options });

  for (const raw of jsonLd.media) add(raw);
  add(meta.get('og:image') || meta.get('twitter:image') || '', { type: 'image' });
  add(meta.get('og:video') || meta.get('og:video:url') || meta.get('twitter:player:stream') || '', {
    type: 'video',
    poster: meta.get('og:image') || meta.get('twitter:image') || '',
  });

  for (const match of html.matchAll(/<figure\b[\s\S]*?<\/figure>/gi)) {
    const block = match[0];
    const caption = stripTags(block.match(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/i)?.[1] || '');
    const mediaTag = block.match(/<(?:img|video|source)\b[^>]*>/i)?.[0];
    if (mediaTag) add(attr(mediaTag, ['src', 'data-src', 'data-original']) || bestSrcSet(attr(mediaTag, ['srcset', 'data-srcset'])), { caption });
  }

  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    add(attr(tag, ['src', 'data-src', 'data-original', 'data-lazy-src']) || bestSrcSet(attr(tag, ['srcset', 'data-srcset'])), {
      type: 'image',
      caption: attr(tag, ['alt', 'title', 'data-caption']),
      width: Number(attr(tag, ['width'])),
      height: Number(attr(tag, ['height'])),
    });
  }

  for (const match of html.matchAll(/<video\b[^>]*>[\s\S]*?<\/video>|<video\b[^>]*>/gi)) {
    const block = match[0];
    const opening = block.match(/<video\b[^>]*>/i)?.[0] || block;
    const poster = attr(opening, ['poster']);
    add(attr(opening, ['src', 'data-src']), {
      type: 'video',
      poster,
      caption: attr(opening, ['title', 'data-caption']),
      width: Number(attr(opening, ['width'])),
      height: Number(attr(opening, ['height'])),
    });
    for (const source of block.matchAll(/<source\b[^>]*>/gi)) {
      add(attr(source[0], ['src', 'data-src']), { type: 'video', poster });
    }
    if (poster) add(poster, { type: 'image' });
  }

  for (const match of html.matchAll(/<a\b[^>]*>/gi)) {
    add(attr(match[0], ['href']));
  }

  const rawMediaPattern = /((?:https?:)?\/\/[^\s"'<>]+|\/(?:thumbnail\/)?data\/[^\s"'<>]+)\.(?:jpe?g|png|webp|gif|avif|mp4|webm|mov|m4v)(?:\?[^\s"'<>]*)?/gi;
  for (const match of html.matchAll(rawMediaPattern)) add(match[0]);

  const title = stripTags(meta.get('og:title') || meta.get('twitter:title') || titleTag || jsonLd.names[0] || '');
  const description = stripTags(meta.get('description') || meta.get('og:description') || meta.get('twitter:description') || jsonLd.descriptions[0] || '');
  const keywords = (meta.get('keywords') || '').split(',').map(item => item.trim()).filter(Boolean);

  return {
    finalUrl,
    title,
    description,
    image: meta.get('og:image') || meta.get('twitter:image') || '',
    keywords,
    publishedAt,
    candidates: [...map.values()],
  };
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/^@+/, '').replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'creator';
}

function prettify(value: string): string {
  return value.replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\b\w/g, char => char.toUpperCase());
}

function titleName(rawTitle: string, username: string): string {
  let title = rawTitle
    .replace(/\s*[|\-–—]\s*(coomer|onlyfans|fansly).*$/i, '')
    .replace(/\s*\((?:onlyfans|fansly)\)\s*$/i, '')
    .trim();
  if (!title || /^(coomer|onlyfans|fansly)$/i.test(title)) title = prettify(username);
  return title.slice(0, 60) || 'Creator';
}

function coomerParts(url: URL): { service: string; username: string; postId?: string } | null {
  if (!['coomer.st', 'www.coomer.st'].includes(url.hostname.toLowerCase())) return null;
  const parts = url.pathname.split('/').filter(Boolean).map(part => {
    try { return decodeURIComponent(part); } catch { return part; }
  });
  if (parts.length < 3 || parts[1] !== 'user') return null;
  return { service: parts[0], username: parts[2], postId: parts[3] === 'post' ? parts[4] : undefined };
}

function uniqueCandidates(candidates: Candidate[]): Candidate[] {
  const byUrl = new Map<string, Candidate>();
  for (const item of candidates) if (!byUrl.has(item.url)) byUrl.set(item.url, item);
  return [...byUrl.values()];
}

export async function scrapeProfileSource(input: ScrapeInput, env: SiteCmsEnv): Promise<ScrapeOutput> {
  const config = siteCmsConfig(env);
  const maxItems = clampInteger(input.maxItems, config.scraperMaxItems, 1, config.scraperMaxItems);
  const maxPages = clampInteger(input.maxPages, config.scraperMaxPages, 1, config.scraperMaxPages);
  const rawUrls = [
    ...(typeof input.url === 'string' && input.url.trim() ? [input.url.trim()] : []),
    ...(Array.isArray(input.urls) ? input.urls.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map(item => item.trim()) : []),
  ].slice(0, 25);

  if (!rawUrls.length) throw new ScrapeError('Enter at least one public page or direct media URL.', 400, 'missing_url');

  const sourceUrls = rawUrls.map(raw => assertPublicHttpUrl(raw));
  const warnings: string[] = [];
  const pages: PageData[] = [];
  let pagesFetched = 0;
  let sourceType: ScrapeOutput['sourceType'] = 'webpage';
  const firstCoomer = sourceUrls.map(coomerParts).find(Boolean);
  if (firstCoomer) sourceType = firstCoomer.postId ? 'coomer_post' : 'coomer_profile';

  for (const sourceUrl of sourceUrls) {
    const directType = typeFromUrl(sourceUrl);
    if (directType) {
      const map = new Map<string, Candidate>();
      addCandidate(map, sourceUrl.toString(), sourceUrl, { type: directType });
      pages.push({ finalUrl: sourceUrl, title: '', description: '', image: '', keywords: [], candidates: [...map.values()], directMedia: [...map.values()][0] });
      if (sourceUrls.length === 1) sourceType = 'direct_media';
      continue;
    }

    const coomer = coomerParts(sourceUrl);
    if (coomer && !coomer.postId) {
      let known = new Set(pages.flatMap(page => page.candidates.map(item => item.url)));
      for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
        const pageUrl = new URL(sourceUrl.toString());
        if (pageIndex > 0) pageUrl.searchParams.set('o', String(pageIndex * 50));
        try {
          const fetched = await fetchPublic(assertPublicHttpUrl(pageUrl.toString()), env);
          pagesFetched += 1;
          const parsed = parsePage(fetched.text, fetched.finalUrl, fetched.contentType);
          const fresh = parsed.candidates.filter(item => !known.has(item.url));
          fresh.forEach(item => known.add(item.url));
          pages.push(parsed);
          if (!fresh.length) break;
          if (known.size >= maxItems) break;
        } catch (error) {
          if (pageIndex === 0) throw error;
          warnings.push(`Stopped Coomer pagination after page ${pageIndex}: ${error instanceof Error ? error.message : 'fetch failed'}`);
          break;
        }
      }
      continue;
    }

    const fetched = await fetchPublic(sourceUrl, env);
    pagesFetched += 1;
    pages.push(parsePage(fetched.text, fetched.finalUrl, fetched.contentType));
  }

  const allCandidates = uniqueCandidates(pages.flatMap(page => page.candidates));
  const selected = allCandidates.slice(0, maxItems);
  if (!selected.length) {
    throw new ScrapeError('No public image or video URLs were found. The page may require JavaScript, login, or a direct media URL.', 422, 'no_media_found');
  }
  if (allCandidates.length > selected.length) warnings.push(`Only the first ${selected.length} of ${allCandidates.length} media items were imported. Raise the item limit or scrape in batches.`);
  if (sourceType === 'webpage') warnings.push('Generic webpage extraction is best-effort. Review and deselect logos, advertisements, or unrelated media before publishing.');

  const firstPage = pages.find(page => page.title || page.description || page.image) || pages[0];
  const coomer = firstCoomer || null;
  const username = coomer?.username || slugify(firstPage.title || sourceUrls[0].hostname.replace(/^www\./, ''));
  const id = slugify(username);
  const name = titleName(firstPage.title, username);
  const firstImage = selected.find(item => item.mediaType === 'image');
  const avatarUrl = coomer
    ? `https://img.coomer.st/icons/${encodeURIComponent(coomer.service)}/${encodeURIComponent(coomer.username)}`
    : firstPage.image || firstImage?.url || selected[0].thumbnailUrl;
  const heroUrl = firstPage.image || firstImage?.url || avatarUrl;
  const genericBio = `${name} — exclusive creator previews, photos and videos 🔥 | Subscribe for the full experience ✨`;
  const bio = firstPage.description.length >= 10 && !/coomer|onlyfans leaks|download.*onlyfans/i.test(firstPage.description)
    ? firstPage.description.slice(0, 400)
    : genericBio;

  const hashtagText = `${firstPage.title} ${firstPage.description}`;
  const hashtags = [...hashtagText.matchAll(/#([a-z0-9_]+)/gi)].map(match => match[1].toLowerCase());
  const serviceTag = coomer?.service.toLowerCase() || '';
  const tags = [...new Set([...firstPage.keywords.map(item => item.toLowerCase()), ...hashtags, serviceTag, 'premium', 'exclusive'].filter(Boolean))].slice(0, 12);
  const category = coomer ? prettify(coomer.service).replace('Onlyfans', 'OnlyFans') : 'Creator';
  const now = Date.now();

  const images: Image[] = selected.map((item, index) => ({
    id: `${id}-${String(index + 1).padStart(3, '0')}`,
    url: item.url,
    thumbnailUrl: item.thumbnailUrl || item.url,
    caption: item.caption || (item.mediaType === 'video' ? 'Video preview ▶️' : 'Creator preview ✨'),
    width: item.width,
    height: item.height,
    isLocked: true,
    isVisible: true,
    mediaType: item.mediaType,
    sourceUrl: item.sourceUrl,
    createdAt: item.createdAt && !Number.isNaN(Date.parse(item.createdAt)) ? new Date(item.createdAt).toISOString() : new Date(now - index * 60000).toISOString(),
  }));

  const draftProfile: Profile = {
    id,
    name,
    handle: `@${username.replace(/^@+/, '')}`,
    bio,
    avatarUrl,
    heroUrl,
    tags,
    category,
    images,
    stats: { posts: images.length, likes: 0, views: 0, followers: 0 },
    isVerified: false,
    isVisible: true,
    pricePerMonth: 0,
    access_mode: 'cached_preview',
  };

  return {
    sourceType,
    sourceUrl: sourceUrls[0].toString(),
    pagesFetched,
    draftProfile,
    warnings,
  };
}
