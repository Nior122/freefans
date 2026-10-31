import test from 'node:test';
import assert from 'node:assert/strict';

import type { Advert, CmsProfileRecord, Image, Profile } from '../types';
import {
  applyProfileRecord,
  buildCmsProfileRecord,
  isAdvertLive,
  mergeAdminProfiles,
  mergePublicProfiles,
  slugifyProfileId,
} from '../services/cms';
import {
  sanitizePublicProfileRecord,
  type D1DatabaseLike,
  type D1PreparedStatementLike,
  type SiteCmsEnv,
} from '../functions/_lib/siteCms';
import { assertPublicHttpUrl, scrapeProfileSource, ScrapeError } from '../functions/_lib/scraper';
import { onRequest as handleProfileRequest } from '../functions/profile/[id].ts';
import { onRequest as handleApiRequest } from '../functions/api/[[path]].ts';

function media(id: string, patch: Partial<Image> = {}): Image {
  return {
    id,
    url: `https://example.com/${id}.jpg`,
    thumbnailUrl: `https://example.com/${id}.jpg`,
    caption: `Caption ${id}`,
    width: 800,
    height: 1000,
    isLocked: true,
    isVisible: true,
    mediaType: 'image',
    ...patch,
  };
}

function profile(id: string, patch: Partial<Profile> = {}): Profile {
  return {
    id,
    name: 'Test Creator',
    handle: '@testcreator',
    bio: 'A synthetic profile used only for website CMS tests.',
    avatarUrl: 'https://example.com/avatar.jpg',
    heroUrl: 'https://example.com/hero.jpg',
    tags: ['test'],
    category: 'Creator',
    images: [media(`${id}-001`), media(`${id}-002`)],
    stats: { posts: 2, likes: 0, views: 0, followers: 0 },
    isVerified: false,
    isVisible: true,
    pricePerMonth: 0,
    access_mode: 'cached_preview',
    ...patch,
  };
}

test('website CMS built-in overlays preserve edits without copying unchanged media', () => {
  const original = profile('builtin-one');
  const edited = structuredClone(original);
  edited.name = 'Renamed Creator';
  edited.images[0] = { ...edited.images[0], caption: 'Updated caption' };
  edited.images = [media('builtin-one-003'), edited.images[0]];

  const record = buildCmsProfileRecord({
    original,
    edited,
    status: 'published',
    origin: 'builtin',
  });

  assert.equal(record.origin, 'builtin');
  assert.equal(record.profile, undefined);
  assert.equal(record.patch?.name, 'Renamed Creator');
  assert.deepEqual(record.addedMedia?.map(item => item.id), ['builtin-one-003']);
  assert.deepEqual(record.removedMediaIds, ['builtin-one-002']);
  assert.equal(record.mediaPatches?.['builtin-one-001']?.caption, 'Updated caption');
  assert.deepEqual(record.mediaOrder, ['builtin-one-003', 'builtin-one-001']);

  const applied = applyProfileRecord(original, record);
  assert.equal(applied?.name, 'Renamed Creator');
  assert.deepEqual(applied?.images.map(item => item.id), ['builtin-one-003', 'builtin-one-001']);
  assert.equal(applied?.images[1]?.caption, 'Updated caption');
});

test('website CMS public and admin merges respect profile status', () => {
  const base = [profile('base-one'), profile('base-two', { name: 'Second Creator' })];
  const hiddenMarker: CmsProfileRecord = { id: 'base-one', status: 'hidden', origin: 'builtin' };
  const draftRecord: CmsProfileRecord = {
    id: 'base-two',
    status: 'draft',
    origin: 'builtin',
    patch: { name: 'Draft-only name' },
  };
  const cmsProfile = profile('cms-one', { name: 'CMS Creator' });
  const cmsRecord: CmsProfileRecord = {
    id: 'cms-one',
    status: 'published',
    origin: 'cms',
    profile: cmsProfile,
  };

  const publicProfiles = mergePublicProfiles(base, [hiddenMarker, draftRecord, cmsRecord]);
  assert.deepEqual(publicProfiles.map(item => item.id).sort(), ['base-two', 'cms-one']);
  assert.equal(publicProfiles.find(item => item.id === 'base-two')?.name, 'Second Creator');

  const adminProfiles = mergeAdminProfiles(base, [hiddenMarker, draftRecord, cmsRecord]);
  assert.equal(adminProfiles.find(item => item.profile.id === 'base-one')?.status, 'hidden');
  assert.equal(adminProfiles.find(item => item.profile.id === 'base-two')?.profile.name, 'Draft-only name');
  assert.equal(adminProfiles.find(item => item.profile.id === 'cms-one')?.origin, 'cms');

  assert.equal(sanitizePublicProfileRecord(draftRecord), null);
  assert.deepEqual(sanitizePublicProfileRecord(hiddenMarker), {
    id: 'base-one',
    status: 'hidden',
    origin: 'builtin',
    updatedAt: undefined,
  });
  assert.equal(slugifyProfileId('@Example Creator!'), 'example-creator');
});

test('website CMS advert schedule uses status and start/end dates', () => {
  const base: Advert = {
    id: 'test-advert',
    title: 'Test advert',
    kind: 'managed',
    placement: 'home_top',
    status: 'active',
    priority: 50,
  };
  const now = new Date('2026-10-31T12:00:00.000Z');
  assert.equal(isAdvertLive(base, now), true);
  assert.equal(isAdvertLive({ ...base, status: 'disabled' }, now), false);
  assert.equal(isAdvertLive({ ...base, startsAt: '2026-11-01T00:00:00.000Z' }, now), false);
  assert.equal(isAdvertLive({ ...base, endsAt: '2026-10-30T00:00:00.000Z' }, now), false);
  assert.equal(isAdvertLive({
    ...base,
    startsAt: '2026-10-01T00:00:00.000Z',
    endsAt: '2026-11-01T00:00:00.000Z',
  }, now), true);
});

test('website CMS scraper rejects unsafe URLs and normalizes direct Coomer media', async () => {
  for (const unsafe of [
    'http://127.0.0.1/private.jpg',
    'http://localhost/private.jpg',
    'https://user:pass@example.com/private.jpg',
    'https://example.com:8443/private.jpg',
    'file:///etc/passwd',
  ]) {
    assert.throws(() => assertPublicHttpUrl(unsafe), ScrapeError);
  }
  assert.equal(assertPublicHttpUrl('https://example.com/photo.jpg').hostname, 'example.com');

  const result = await scrapeProfileSource({
    urls: [
      'https://img.coomer.st/data/ab/cd/example.jpg',
      'https://example.com/video.mp4',
    ],
    maxItems: 10,
    maxPages: 1,
  }, {});

  assert.equal(result.sourceType, 'webpage');
  assert.equal(result.draftProfile.images.length, 2);
  assert.equal(result.draftProfile.images[0]?.url, 'https://img.coomer.st/thumbnail/data/ab/cd/example.jpg');
  assert.equal(result.draftProfile.images[0]?.sourceUrl, 'https://img.coomer.st/data/ab/cd/example.jpg');
  assert.equal(result.draftProfile.images[1]?.mediaType, 'video');
  assert.deepEqual(result.draftProfile.images.map(item => item.id), [
    `${result.draftProfile.id}-001`,
    `${result.draftProfile.id}-002`,
  ]);
});

test('website CMS scraper uses the Coomer API for post media, videos, name and bio', async () => {
  const originalFetch = globalThis.fetch;
  const acceptHeaders: string[] = [];
  const imagePath = `/ab/cd/${'a'.repeat(64)}.jpg`;
  const inlinePath = `/12/34/${'b'.repeat(64)}.png`;
  globalThis.fetch = (async (input: unknown, init?: { headers?: Record<string, string> }) => {
    const url = String(input);
    acceptHeaders.push(init?.headers?.accept || '');
    if (url.includes('/api/v1/onlyfans/user/testcreator/profile')) {
      return new Response(JSON.stringify({ name: 'Test Creator', post_count: 1234 }), { headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('/api/v1/onlyfans/user/testcreator/posts')) {
      return new Response(JSON.stringify([
        { id: '1', title: 'First post', published: '2025-01-02T03:04:05', tags: ['Cosplay'], file: { name: 'a.jpg', path: imagePath }, attachments: [] },
        {
          id: '2', title: 'Video post', published: '2025-01-01T03:04:05',
          content: `<p>hi</p><img src="https://coomer.st${inlinePath}">`,
          file: {},
          attachments: [{ name: 'v.mp4', path: '/de/f0/video.mp4' }, { name: 'a.zip', path: '/de/f0/archive.zip' }],
        },
      ]), { headers: { 'content-type': 'application/json' } });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  try {
    const result = await scrapeProfileSource({ url: 'https://coomer.st/onlyfans/user/testcreator', maxItems: 50, maxPages: 2 }, {});
    assert.equal(result.sourceType, 'coomer_profile');
    assert.equal(result.draftProfile.name, 'Test Creator');
    assert.ok(result.draftProfile.bio.includes('1,234 posts'), `bio should use the API post count: ${result.draftProfile.bio}`);
    assert.ok(acceptHeaders.length >= 2 && acceptHeaders.every(header => header === 'text/css'), 'Coomer API calls must send Accept: text/css');
    // Post file image, attachment video (zip skipped), inline content image.
    assert.deepEqual(result.draftProfile.images.map(item => item.mediaType), ['image', 'video', 'image']);
    assert.equal(result.draftProfile.images[0]?.url, `https://img.coomer.st/thumbnail/data${imagePath}`);
    assert.equal(result.draftProfile.images[0]?.sourceUrl, `https://img.coomer.st/data${imagePath}`);
    assert.equal(result.draftProfile.images[1]?.url, 'https://img.coomer.st/data/de/f0/video.mp4');
    assert.equal(result.draftProfile.images[0]?.caption, 'First post');
    assert.ok(result.draftProfile.tags.includes('cosplay'));
    assert.equal(result.draftProfile.avatarUrl, 'https://img.coomer.st/icons/onlyfans/testcreator');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('website CMS scraper uses the Coomer API single-post shape', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    if (url.includes('/profile')) {
      return new Response(JSON.stringify({ name: 'Poster Creator', post_count: 10 }), { headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('/post/999')) {
      return new Response(JSON.stringify({
        post: { id: '999', title: 'Solo post', published: '2025-02-01T00:00:00', file: { name: 'v.mp4', path: '/aa/bb/clip.mp4' } },
        attachments: [{ name: 'p.jpg', path: '/aa/bb/photo.jpg' }],
        previews: [],
      }), { headers: { 'content-type': 'application/json' } });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  try {
    const result = await scrapeProfileSource({ url: 'https://coomer.party/onlyfans/user/poster/post/999', maxItems: 10, maxPages: 1 }, {});
    assert.equal(result.sourceType, 'coomer_post');
    assert.equal(result.draftProfile.name, 'Poster Creator');
    assert.deepEqual(result.draftProfile.images.map(item => item.mediaType), ['video', 'image']);
    assert.equal(result.pagesFetched, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('website CMS scraper falls back to webpage extraction when the Coomer API fails', async () => {
  const originalFetch = globalThis.fetch;
  const html = `<!doctype html><html><head>
    <meta property="og:title" content="Fallback Creator">
    <meta property="og:description" content="Real bio about this creator and her cosplay shoots | Coomer">
    <meta property="og:image" content="https://img.coomer.st/icons/onlyfans/fallback">
    </head><body>
    <img src="https://img.coomer.st/thumbnail/data/ab/cd/poster.jpg" alt="Post poster">
    </body></html>`;
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    if (url.includes('/api/v1/')) return new Response('blocked', { status: 500 });
    return new Response(html, { headers: { 'content-type': 'text/html' } });
  }) as typeof fetch;
  try {
    const result = await scrapeProfileSource({ url: 'https://coomer.st/onlyfans/user/fallback', maxItems: 10, maxPages: 2 }, {});
    assert.ok(result.warnings.some(warning => warning.includes('falling back to webpage extraction')));
    assert.equal(result.draftProfile.name, 'Fallback Creator');
    assert.ok(result.draftProfile.bio.startsWith('Real bio about this creator'), `bio should keep the cleaned description: ${result.draftProfile.bio}`);
    assert.ok(result.draftProfile.images.some(item => item.url === 'https://img.coomer.st/thumbnail/data/ab/cd/poster.jpg'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

interface ProfileRow extends Record<string, unknown> {
  id: string;
  status: CmsProfileRecord['status'];
  origin: CmsProfileRecord['origin'];
  record_json: string;
  created_at: string;
  updated_at: string;
}

interface AdvertRow extends Record<string, unknown> {
  id: string;
  status: Advert['status'];
  kind: Advert['kind'];
  placement: Advert['placement'];
  priority: number;
  starts_at: string | null;
  ends_at: string | null;
  advert_json: string;
  created_at: string;
  updated_at: string;
}

class FakeStatement implements D1PreparedStatementLike {
  values: unknown[] = [];

  constructor(private readonly db: FakeD1, private readonly sql: string) {}

  bind(...values: unknown[]): D1PreparedStatementLike {
    this.values = values;
    return this;
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    if (this.sql.includes('FROM cms_login_attempts')) {
      return { count: this.db.loginAttempts.filter(item => item.success === 0).length } as T;
    }
    if (this.sql.includes('FROM cms_profiles') && this.sql.includes('WHERE id=?')) {
      return (this.db.profiles.get(String(this.values[0])) || null) as T | null;
    }
    return null;
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    if (this.sql.includes('FROM cms_profiles')) return { results: [...this.db.profiles.values()] as T[] };
    if (this.sql.includes('FROM cms_adverts')) return { results: [...this.db.adverts.values()] as T[] };
    return { results: [] };
  }

  async run(): Promise<{ meta?: { changes?: number } }> {
    if (this.sql.includes('INSERT INTO cms_login_attempts')) {
      this.db.loginAttempts.push({
        ipHash: String(this.values[0]),
        username: String(this.values[1]),
        success: Number(this.values[2]),
      });
      return { meta: { changes: 1 } };
    }
    if (this.sql.includes('INSERT INTO cms_profiles')) {
      const [id, status, origin, recordJson] = this.values.map(String);
      this.db.profiles.set(id, {
        id,
        status: status as ProfileRow['status'],
        origin: origin as ProfileRow['origin'],
        record_json: recordJson,
        created_at: '2026-10-31T00:00:00.000Z',
        updated_at: '2026-10-31T00:00:00.000Z',
      });
      return { meta: { changes: 1 } };
    }
    if (this.sql.includes('INSERT INTO cms_adverts')) {
      const [id, status, kind, placement, priority, startsAt, endsAt, advertJson] = this.values;
      this.db.adverts.set(String(id), {
        id: String(id),
        status: status as AdvertRow['status'],
        kind: kind as AdvertRow['kind'],
        placement: placement as AdvertRow['placement'],
        priority: Number(priority),
        starts_at: startsAt ? String(startsAt) : null,
        ends_at: endsAt ? String(endsAt) : null,
        advert_json: String(advertJson),
        created_at: '2026-10-31T00:00:00.000Z',
        updated_at: '2026-10-31T00:00:00.000Z',
      });
      return { meta: { changes: 1 } };
    }
    return { meta: { changes: 0 } };
  }
}

class FakeD1 implements D1DatabaseLike {
  profiles = new Map<string, ProfileRow>();
  adverts = new Map<string, AdvertRow>();
  loginAttempts: Array<{ ipHash: string; username: string; success: number }> = [];

  prepare(sql: string): D1PreparedStatementLike {
    return new FakeStatement(this, sql);
  }

  async batch(): Promise<unknown[]> {
    return [];
  }
}

function testEnv(db: FakeD1): SiteCmsEnv {
  return {
    SITE_DB: db,
    ADMIN_USERNAME: 'local-admin',
    ADMIN_PASSWORD: 'local-test-password-123',
    ADMIN_SESSION_SECRET: 'local-test-session-secret-32-chars-minimum',
    SITE_URL: 'http://127.0.0.1:8788',
  };
}

async function apiRequest(
  env: SiteCmsEnv,
  path: string,
  init: RequestInit = {},
  cookie = '',
): Promise<{ status: number; body: any; headers: Headers }> {
  const headers = new Headers(init.headers || {});
  headers.set('x-admin-request', '1');
  if (cookie) headers.set('cookie', cookie);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const response = await handleApiRequest({
    env,
    request: new Request(`http://127.0.0.1:8788${path}`, { ...init, headers }),
  } as any);
  return { status: response.status, body: await response.json(), headers: response.headers };
}

test('website CMS API returns JSON auth errors and publishes synthetic D1 content', async () => {
  const db = new FakeD1();
  const env = testEnv(db);

  const wrong = await apiRequest(env, '/api/admin/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'local-admin', password: 'wrong' }),
  });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.body.error, 'invalid_credentials');

  const login = await apiRequest(env, '/api/admin/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'local-admin', password: 'local-test-password-123' }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie')?.split(';')[0] || '';
  assert.match(cookie, /^fansleak_admin_session=/);

  const cmsRecord: CmsProfileRecord = {
    id: 'testcreator',
    status: 'published',
    origin: 'cms',
    profile: profile('testcreator'),
  };
  const savedProfile = await apiRequest(env, '/api/admin/profiles/testcreator', {
    method: 'PUT',
    body: JSON.stringify(cmsRecord),
  }, cookie);
  assert.equal(savedProfile.status, 200);
  assert.equal(savedProfile.body.record.profile.name, 'Test Creator');

  const advert: Advert = {
    id: 'test-home-advert',
    title: 'Synthetic home advert',
    kind: 'managed',
    placement: 'home_top',
    status: 'active',
    priority: 1,
    headline: 'Synthetic sponsor',
    imageUrl: 'https://example.com/ad.jpg',
    destinationUrl: 'https://example.com/',
  };
  const savedAdvert = await apiRequest(env, '/api/admin/adverts/test-home-advert', {
    method: 'PUT',
    body: JSON.stringify(advert),
  }, cookie);
  assert.equal(savedAdvert.status, 200);

  const publicContent = await apiRequest(env, '/api/public/content');
  assert.equal(publicContent.status, 200);
  assert.deepEqual(publicContent.body.profileRecords.map((item: CmsProfileRecord) => item.id), ['testcreator']);
  assert.deepEqual(publicContent.body.adverts.map((item: Advert) => item.id), ['test-home-advert']);

  const scrape = await apiRequest(env, '/api/admin/scrape', {
    method: 'POST',
    body: JSON.stringify({
      urls: ['https://example.com/direct-photo.jpg', 'https://example.com/direct-video.mp4'],
      maxItems: 10,
      maxPages: 1,
      rightsConfirmed: true,
    }),
  }, cookie);
  assert.equal(scrape.status, 200);
  assert.deepEqual(scrape.body.draftProfile.images.map((item: Image) => item.mediaType), ['image', 'video']);
});

test('website CMS API preserves same-origin bundled media paths and rejects protocol-relative tricks', async () => {
  const db = new FakeD1();
  const env = testEnv(db);
  const login = await apiRequest(env, '/api/admin/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'local-admin', password: 'local-test-password-123' }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie')?.split(';')[0] || '';

  const relativeProfile = profile('relativecreator', {
    avatarUrl: '/media/relative/avatar.jpg',
    heroUrl: '/media/relative/hero.jpg',
    images: [media('relativecreator-001', {
      url: '/media/relative/photo.jpg',
      thumbnailUrl: '/media/relative/photo.jpg',
      sourceUrl: '/media/relative/photo-source.jpg',
    })],
    stats: { posts: 1, likes: 0, views: 0, followers: 0 },
  });
  const savedRelativeProfile = await apiRequest(env, '/api/admin/profiles/relativecreator', {
    method: 'PUT',
    body: JSON.stringify({ id: 'relativecreator', status: 'published', origin: 'cms', profile: relativeProfile }),
  }, cookie);
  assert.equal(savedRelativeProfile.status, 200, JSON.stringify(savedRelativeProfile.body));
  assert.equal(savedRelativeProfile.body.record.profile.avatarUrl, '/media/relative/avatar.jpg');
  assert.equal(savedRelativeProfile.body.record.profile.images[0].url, '/media/relative/photo.jpg');
  assert.equal(savedRelativeProfile.body.record.profile.images[0].sourceUrl, '/media/relative/photo-source.jpg');

  const builtinRecord: CmsProfileRecord = {
    id: 'ruri',
    status: 'published',
    origin: 'builtin',
    patch: {
      avatarUrl: '/media/ruri/avatar.jpg',
      heroUrl: '/media/ruri/hero.jpg',
    },
    mediaPatches: {
      'ruri-001': {
        url: '/media/ruri/ruri-001.jpg',
        thumbnailUrl: '/media/ruri/ruri-001.jpg',
        caption: 'Updated bundled media',
        sourceUrl: '/media/ruri/ruri-001-source.jpg',
      },
    },
    addedMedia: [media('ruri-999', {
      url: '/media/ruri/ruri-999.jpg',
      thumbnailUrl: '/media/ruri/ruri-999.jpg',
    })],
  };
  const savedBuiltin = await apiRequest(env, '/api/admin/profiles/ruri', {
    method: 'PUT',
    body: JSON.stringify(builtinRecord),
  }, cookie);
  assert.equal(savedBuiltin.status, 200, JSON.stringify(savedBuiltin.body));
  assert.equal(savedBuiltin.body.record.patch.avatarUrl, '/media/ruri/avatar.jpg');
  assert.equal(savedBuiltin.body.record.mediaPatches['ruri-001'].url, '/media/ruri/ruri-001.jpg');
  assert.equal(savedBuiltin.body.record.addedMedia[0].thumbnailUrl, '/media/ruri/ruri-999.jpg');

  const localAdvert = await apiRequest(env, '/api/admin/adverts/local-asset-advert', {
    method: 'PUT',
    body: JSON.stringify({
      id: 'local-asset-advert',
      title: 'Local asset advert',
      kind: 'managed',
      placement: 'sidebar',
      status: 'active',
      priority: 5,
      imageUrl: '/og-image.png',
      destinationUrl: '/profile/relativecreator/',
    }),
  }, cookie);
  assert.equal(localAdvert.status, 200, JSON.stringify(localAdvert.body));
  assert.equal(localAdvert.body.advert.imageUrl, '/og-image.png');
  assert.equal(localAdvert.body.advert.destinationUrl, '/profile/relativecreator/');

  for (const unsafeUrl of ['//evil.example/photo.jpg', '/\\evil.example/photo.jpg']) {
    const unsafeRecord = structuredClone(builtinRecord);
    unsafeRecord.mediaPatches = { 'ruri-001': { url: unsafeUrl } };
    const rejected = await apiRequest(env, '/api/admin/profiles/ruri', {
      method: 'PUT',
      body: JSON.stringify(unsafeRecord),
    }, cookie);
    assert.equal(rejected.status, 400, `${unsafeUrl}: ${JSON.stringify(rejected.body)}`);
  }
});

test('D1-only profile route fetches the canonical root shell instead of an empty /index.html redirect', async () => {
  const db = new FakeD1();
  const cmsProfile = profile('testcreator');
  db.profiles.set('testcreator', {
    id: 'testcreator',
    status: 'published',
    origin: 'cms',
    record_json: JSON.stringify({ id: 'testcreator', status: 'published', origin: 'cms', profile: cmsProfile }),
    created_at: '2026-10-31T00:00:00.000Z',
    updated_at: '2026-10-31T00:00:00.000Z',
  });

  const env: SiteCmsEnv = {
    ...testEnv(db),
    ASSETS: {
      async fetch(request: Request) {
        const path = new URL(request.url).pathname;
        if (path === '/index.html') return new Response(null, { status: 308, headers: { location: '/' } });
        if (path === '/') {
          return new Response(
            '<!doctype html><html><head><title>FansLeak</title><meta name="description" content="Home" /><link rel="canonical" href="http://127.0.0.1:8788/" /><meta property="og:image" content="https://example.com/og.jpg" /></head><body><div id="root"></div></body></html>',
            { headers: { 'content-type': 'text/html' } },
          );
        }
        if (path === '/404') return new Response('<h1>Missing</h1>', { status: 200, headers: { 'content-type': 'text/html' } });
        return new Response('<h1>Missing</h1>', { status: 404, headers: { 'content-type': 'text/html' } });
      },
    },
  };

  const response = await handleProfileRequest({
    env,
    params: { id: 'testcreator' },
    request: new Request('http://127.0.0.1:8788/profile/testcreator/'),
  } as any);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /<div id="root"><\/div>/);
  assert.match(html, /Test Creator \(@testcreator\) — FansLeak/);
  assert.match(html, /http:\/\/127\.0\.0\.1:8788\/profile\/testcreator\//);

  const row = db.profiles.get('testcreator');
  assert.ok(row);
  row.status = 'hidden';
  row.record_json = JSON.stringify({ ...JSON.parse(row.record_json), status: 'hidden' });
  const hidden = await handleProfileRequest({
    env,
    params: { id: 'testcreator' },
    request: new Request('http://127.0.0.1:8788/profile/testcreator/'),
  } as any);
  assert.equal(hidden.status, 404);
  assert.equal(hidden.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.match(await hidden.text(), /Missing/);
});
