import {
  Advert,
  AdminCmsContent,
  CmsProfileOrigin,
  CmsProfileRecord,
  CmsProfileStatus,
  Image,
  Profile,
  ProfilePatch,
  PublicCmsContent,
} from '../types';

export class CmsApiError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number, code = 'cms_api_error') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers || {});
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  if (path.startsWith('/api/admin/')) headers.set('x-admin-request', '1');

  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers,
      credentials: 'include',
      cache: 'no-store',
    });
  } catch {
    throw new CmsApiError('The website admin API is unavailable. Deploy the Pages Functions or run the Pages dev server.', 0, 'api_unavailable');
  }

  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new CmsApiError(
      String(payload.message || payload.error || `Request failed (${response.status})`),
      response.status,
      String(payload.error || 'cms_api_error'),
    );
  }
  return payload as T;
}

export interface CmsHealth {
  ok: boolean;
  databaseConfigured: boolean;
  authConfigured: boolean;
}

export interface AdminSession {
  authenticated: boolean;
  username?: string;
  config?: AdminCmsContent['config'];
}

export interface ScrapeResult {
  sourceType: 'coomer_profile' | 'coomer_post' | 'webpage' | 'direct_media';
  sourceUrl: string;
  pagesFetched: number;
  draftProfile: Profile;
  warnings: string[];
}

export const getCmsHealth = () => api<CmsHealth>('/api/health');
export const getPublicCmsContent = () => api<PublicCmsContent>('/api/public/content');
export const getAdminSession = () => api<AdminSession>('/api/admin/session');
export const loginAdmin = (username: string, password: string) => api<AdminSession>('/api/admin/login', {
  method: 'POST',
  body: JSON.stringify({ username, password }),
});
export const logoutAdmin = () => api<{ ok: boolean }>('/api/admin/logout', { method: 'POST', body: '{}' });
export const getAdminContent = () => api<AdminCmsContent>('/api/admin/content');
export const saveCmsProfileRecord = (record: CmsProfileRecord) => api<{ record: CmsProfileRecord }>(`/api/admin/profiles/${encodeURIComponent(record.id)}`, {
  method: 'PUT',
  body: JSON.stringify(record),
});
export const permanentlyDeleteCmsProfileRecord = (id: string) => api<{ ok: boolean }>(`/api/admin/profiles/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const saveAdvert = (advert: Advert) => api<{ advert: Advert }>(`/api/admin/adverts/${encodeURIComponent(advert.id)}`, {
  method: 'PUT',
  body: JSON.stringify(advert),
});
export const deleteAdvert = (id: string) => api<{ ok: boolean }>(`/api/admin/adverts/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const scrapeProfileUrl = (input: {
  url?: string;
  urls?: string[];
  maxItems: number;
  maxPages: number;
  rightsConfirmed: boolean;
}) => api<ScrapeResult>('/api/admin/scrape', { method: 'POST', body: JSON.stringify(input) });

export const BULK_SCRAPE_MAX_PROFILES = 25;

// Parse the bulk-scraper textarea: one profile URL per line (commas also
// accepted), whitespace trimmed, duplicates removed in source order, and the
// batch capped so a single run cannot overwhelm the source or the admin.
export function parseBulkProfileUrls(text: string, max = BULK_SCRAPE_MAX_PROFILES): {
  urls: string[];
  duplicates: number;
  overflow: number;
} {
  const raw = String(text || '').split(/[\n,]+/).map(item => item.trim()).filter(Boolean);
  const seen = new Set<string>();
  const unique: string[] = [];
  let duplicates = 0;
  for (const url of raw) {
    if (seen.has(url)) { duplicates += 1; continue; }
    seen.add(url);
    unique.push(url);
  }
  const cap = Math.max(1, max);
  return {
    urls: unique.slice(0, cap),
    duplicates,
    overflow: Math.max(0, unique.length - cap),
  };
}
export const exportAdminCms = () => api<AdminCmsContent>('/api/admin/export');

export function slugifyProfileId(value: string): string {
  return value
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export function normalizeTags(value: string | string[]): string[] {
  const raw = Array.isArray(value) ? value : value.split(',');
  return [...new Set(raw.map(tag => tag.trim().toLowerCase().replace(/^#/, '')).filter(Boolean))].slice(0, 12);
}

export function makeMediaId(profileId: string, existing: Image[]): string {
  const used = new Set(existing.map(item => item.id));
  let index = existing.length + 1;
  let id = `${profileId || 'profile'}-${String(index).padStart(3, '0')}`;
  while (used.has(id)) {
    index += 1;
    id = `${profileId || 'profile'}-${String(index).padStart(3, '0')}`;
  }
  return id;
}

function cloneProfile(profile: Profile): Profile {
  return {
    ...profile,
    tags: [...(profile.tags || [])],
    stats: { ...(profile.stats || { posts: 0, likes: 0, views: 0, followers: 0 }) },
    images: (profile.images || []).map(image => ({ ...image })),
  };
}

export function applyProfileRecord(base: Profile | undefined, record: CmsProfileRecord): Profile | null {
  if (record.origin === 'cms') return record.profile ? cloneProfile(record.profile) : null;
  if (!base) return null;

  const profile = cloneProfile(base);
  if (record.patch) {
    Object.assign(profile, record.patch);
    if (record.patch.stats) profile.stats = { ...record.patch.stats };
    if (record.patch.tags) profile.tags = [...record.patch.tags];
  }

  const removed = new Set(record.removedMediaIds || []);
  const byId = new Map<string, Image>();
  for (const image of profile.images) {
    if (removed.has(image.id)) continue;
    const patch = record.mediaPatches?.[image.id];
    byId.set(image.id, patch ? { ...image, ...patch, id: image.id } : { ...image });
  }
  for (const image of record.addedMedia || []) byId.set(image.id, { ...image });

  if (record.mediaOrder?.length) {
    const ordered: Image[] = [];
    for (const id of record.mediaOrder) {
      const image = byId.get(id);
      if (image) {
        ordered.push(image);
        byId.delete(id);
      }
    }
    profile.images = [...ordered, ...byId.values()];
  } else {
    profile.images = [...byId.values()];
  }

  profile.id = record.id;
  return profile;
}

export function mergePublicProfiles(baseProfiles: Profile[], records: CmsProfileRecord[]): Profile[] {
  const byId = new Map(baseProfiles.map(profile => [profile.id, cloneProfile(profile)]));
  for (const record of records) {
    if (record.status === 'draft') continue;
    if (record.status === 'hidden' || record.status === 'deleted') {
      byId.delete(record.id);
      continue;
    }
    const applied = applyProfileRecord(baseProfiles.find(profile => profile.id === record.id), record);
    if (applied) byId.set(record.id, applied);
  }
  return [...byId.values()].filter(profile => profile.isVisible !== false);
}

export interface AdminProfileEntry {
  profile: Profile;
  original?: Profile;
  record?: CmsProfileRecord;
  origin: CmsProfileOrigin;
  status: CmsProfileStatus;
}

export function mergeAdminProfiles(baseProfiles: Profile[], records: CmsProfileRecord[]): AdminProfileEntry[] {
  const baseById = new Map(baseProfiles.map(profile => [profile.id, profile]));
  const entries = new Map<string, AdminProfileEntry>();

  for (const profile of baseProfiles) {
    entries.set(profile.id, {
      profile: cloneProfile(profile),
      original: profile,
      origin: 'builtin',
      status: profile.isVisible === false ? 'hidden' : 'published',
    });
  }

  for (const record of records) {
    const base = baseById.get(record.id);
    const applied = applyProfileRecord(base, record);
    if (!applied) continue;
    entries.set(record.id, {
      profile: applied,
      original: base,
      record,
      origin: record.origin,
      status: record.status,
    });
  }

  return [...entries.values()].sort((a, b) => a.profile.name.localeCompare(b.profile.name));
}

const scalarPatch = (profile: Profile): ProfilePatch => ({
  name: profile.name,
  handle: profile.handle,
  bio: profile.bio,
  avatarUrl: profile.avatarUrl,
  heroUrl: profile.heroUrl,
  tags: [...profile.tags],
  category: profile.category,
  stats: { ...profile.stats },
  isVerified: profile.isVerified,
  isVisible: profile.isVisible,
  pricePerMonth: profile.pricePerMonth,
  access_mode: profile.access_mode,
});

export function buildCmsProfileRecord(input: {
  original?: Profile;
  edited: Profile;
  status: CmsProfileStatus;
  origin: CmsProfileOrigin;
}): CmsProfileRecord {
  const edited = cloneProfile(input.edited);
  edited.id = slugifyProfileId(edited.id);
  edited.tags = normalizeTags(edited.tags);

  if (input.origin === 'cms' || !input.original) {
    return { id: edited.id, status: input.status, origin: 'cms', profile: edited };
  }

  const originalById = new Map(input.original.images.map(image => [image.id, image]));
  const editedIds = new Set(edited.images.map(image => image.id));
  const removedMediaIds = input.original.images.filter(image => !editedIds.has(image.id)).map(image => image.id);
  const addedMedia = edited.images.filter(image => !originalById.has(image.id));
  const mediaPatches: Record<string, Partial<Omit<Image, 'id'>>> = {};

  for (const image of edited.images) {
    const original = originalById.get(image.id);
    if (!original) continue;
    if (JSON.stringify(original) !== JSON.stringify(image)) {
      const { id: _id, ...patch } = image;
      mediaPatches[image.id] = patch;
    }
  }

  const originalOrder = input.original.images.map(image => image.id);
  const editedOrder = edited.images.map(image => image.id);
  const orderChanged = JSON.stringify(originalOrder) !== JSON.stringify(editedOrder);

  return {
    id: edited.id,
    status: input.status,
    origin: 'builtin',
    patch: scalarPatch(edited),
    ...(addedMedia.length ? { addedMedia } : {}),
    ...(removedMediaIds.length ? { removedMediaIds } : {}),
    ...(Object.keys(mediaPatches).length ? { mediaPatches } : {}),
    ...(orderChanged ? { mediaOrder: editedOrder } : {}),
  };
}

export function isAdvertLive(advert: Advert, now = new Date()): boolean {
  if (advert.status !== 'active') return false;
  if (advert.startsAt && new Date(advert.startsAt).getTime() > now.getTime()) return false;
  if (advert.endsAt && new Date(advert.endsAt).getTime() < now.getTime()) return false;
  return true;
}

export function emptyProfile(): Profile {
  return {
    id: '',
    name: '',
    handle: '',
    bio: '',
    avatarUrl: '',
    heroUrl: '',
    tags: [],
    category: 'Creator',
    images: [],
    stats: { posts: 0, likes: 0, views: 0, followers: 0 },
    isVerified: false,
    isVisible: true,
    pricePerMonth: 0,
    access_mode: 'cached_preview',
  };
}

export function emptyAdvert(): Advert {
  return {
    id: `advert-${Date.now().toString(36)}`,
    title: '',
    kind: 'managed',
    placement: 'home_top',
    status: 'draft',
    priority: 50,
    headline: '',
    description: '',
    imageUrl: '',
    videoUrl: '',
    destinationUrl: '',
    ctaLabel: 'Visit sponsor',
    scriptUrl: '',
    code: '',
  };
}

export function downloadJson(filename: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
