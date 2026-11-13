import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMediaItems,
  extractHtmlThumbnails,
  fetchArtistEntries,
  isImagePath,
  mediaUrls,
  postsToEntries,
  toCaption,
} from '../scripts/fetch-coomer-media.mjs';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);

test('image detection accepts images and rejects video/empty paths', () => {
  assert.equal(isImagePath('/aa/bb/sha.jpg'), true);
  assert.equal(isImagePath('/aa/bb/sha.WEBP'), true);
  assert.equal(isImagePath('/aa/bb/sha.jpeg?x=1'), true);
  assert.equal(isImagePath('/aa/bb/sha.mp4'), false);
  assert.equal(isImagePath('/aa/bb/sha.webm'), false);
  assert.equal(isImagePath(''), false);
  assert.equal(isImagePath(null), false);
});

test('media URLs follow the {host}/thumbnail/data{path} convention', () => {
  assert.deepEqual(mediaUrls(`/${HASH_A}.jpg`), {
    url: `https://img.coomer.st/thumbnail/data/${HASH_A}.jpg`,
    thumbnailUrl: `https://img.coomer.st/thumbnail/data/${HASH_A}.jpg`,
  });
  assert.equal(mediaUrls(`${HASH_B}.png`).url, `https://img.coomer.st/thumbnail/data/${HASH_B}.png`);
});

test('captions are single-line, trimmed and capped at 140 characters', () => {
  assert.equal(toCaption(undefined, '  hello\n\nworld  '), 'hello world');
  assert.equal(toCaption('', 'fallback title'), 'fallback title');
  assert.equal(toCaption(null, undefined), '');
  assert.equal(toCaption('x'.repeat(300)).length, 140);
});

test('posts flatten to images only, skipping videos and keeping captions', () => {
  const posts = [
    {
      title: 'First post',
      published: '2024-11-14T23:28:06',
      file: { path: `/${HASH_A}.jpg` },
      attachments: [{ path: `/${HASH_B}.png` }, { path: `/${HASH_C}.mp4` }],
    },
    { content: 'Video only', file: { path: `/${HASH_C}.mp4` }, attachments: [] },
  ];
  const entries = postsToEntries(posts);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((entry) => entry.path), [`/${HASH_A}.jpg`, `/${HASH_B}.png`]);
  assert.equal(entries[0].caption, 'First post');
  assert.equal(entries[0].createdAt, '2024-11-14T23:28:06.000Z');
});

test('media items dedupe, number ids and stop at the limit', () => {
  const entries = [
    { path: `/${HASH_A}.jpg`, caption: 'one', createdAt: '2024-01-01T00:00:00.000Z' },
    { path: `/${HASH_A}.jpg`, caption: 'duplicate' },
    { path: `/${HASH_B}.jpg`, caption: '', createdAt: null },
    { path: `/${HASH_C}.jpg`, caption: 'three' },
  ];
  const items = buildMediaItems('demo', entries, 2);
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((item) => item.id), ['demo-001', 'demo-002']);
  assert.equal(items[0].caption, 'one');
  assert.equal(items[0].mediaType, 'image');
  assert.equal(items[0].isLocked, true);
  assert.equal(items[1].url, `https://img.coomer.st/thumbnail/data/${HASH_B}.jpg`);
});

test('HTML fallback extracts unique-ish thumbnail paths', () => {
  const html = `<img src="https://img.coomer.st/thumbnail/data/aa/bb/${HASH_A}.jpg">` +
    `<img src='https://img.coomer.st/thumbnail/data/cc/dd/${HASH_B}.png'>` +
    '<img src="https://img.coomer.st/data/ee/ff/video.mp4">';
  assert.deepEqual(extractHtmlThumbnails(html), [`/aa/bb/${HASH_A}.jpg`, `/cc/dd/${HASH_B}.png`]);
});

test('API crawl stops at the limit and ignores videos', async () => {
  const pages = {
    0: [
      { title: 'a', file: { path: `/${HASH_A}.jpg` }, attachments: [{ path: `/${HASH_B}.jpg` }] },
      { title: 'v', file: { path: `/${HASH_C}.mp4` }, attachments: [] },
    ],
  };
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const offset = Number(new URL(url).searchParams.get('o'));
    const body = pages[offset] || [];
    return { ok: true, status: 200, json: async () => body, text: async () => '' };
  };
  const entries = await fetchArtistEntries({ id: 'demo', limit: 2, fetchImpl });
  assert.equal(entries.length, 2);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /\/api\/v1\/onlyfans\/user\/demo\/posts\?o=0$/);
});

test('API failure falls back to the HTML listing', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('/api/v1/')) return { ok: false, status: 500, statusText: 'Internal', json: async () => ({}) };
    return {
      ok: true,
      status: 200,
      text: async () => `<img src="https://img.coomer.st/thumbnail/data/aa/bb/${HASH_A}.jpg">`,
      json: async () => ({}),
    };
  };
  const entries = await fetchArtistEntries({ id: 'demo', limit: 10, fetchImpl });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].path, `/aa/bb/${HASH_A}.jpg`);
});

test('API crawl continues past pages with fewer images than posts', async () => {
  // 50 posts with only 5 images total is a normal page for a video-heavy
  // creator: it must not be treated as the final page.
  const page0 = Array.from({ length: 50 }, (_, index) =>
    index < 5
      ? { title: `p${index}`, file: { path: `/${HASH_A.slice(0, 60)}${String(index).padStart(4, '0')}.jpg` } }
      : { title: `video ${index}`, file: { path: `/${HASH_B}.mp4` } }
  );
  const page1 = Array.from({ length: 50 }, (_, index) => ({
    title: `later ${index}`,
    file: { path: `/${'d'.repeat(60)}${String(index).padStart(4, '0')}.jpg` },
  }));
  const offsets = [];
  const fetchImpl = async (url) => {
    const offset = Number(new URL(url).searchParams.get('o'));
    offsets.push(offset);
    const body = offset === 0 ? page0 : offset === 50 ? page1 : [];
    return { ok: true, status: 200, json: async () => body, text: async () => '' };
  };
  const entries = await fetchArtistEntries({ id: 'demo', limit: 55, fetchImpl });
  assert.deepEqual(offsets, [0, 50]);
  assert.equal(entries.length, 55);
});
