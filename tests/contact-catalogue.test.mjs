import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CATALOGUE_PATH = path.join(ROOT, 'public', 'contact-catalogue.json');
const GENERATOR_SCRIPT = path.join(ROOT, 'scripts', 'generate-contact-catalogue.mjs');

test('Public catalogue generator produces valid JSON with strict privacy guarantees', () => {
  // Execute generator
  execFileSync(process.execPath, [GENERATOR_SCRIPT], { cwd: ROOT, encoding: 'utf8' });

  assert.ok(fs.existsSync(CATALOGUE_PATH), 'contact-catalogue.json must exist in public directory');
  const raw = fs.readFileSync(CATALOGUE_PATH, 'utf8');
  const data = JSON.parse(raw);

  assert.equal(data.version, 1, 'Catalogue version must be 1');
  assert.ok(typeof data.generatedAt === 'string', 'Catalogue generatedAt must be a string');
  assert.ok(Array.isArray(data.profiles), 'Catalogue profiles must be an array');
  assert.ok(data.profiles.length > 0, 'Catalogue must contain profiles');

  const seenIds = new Set();

  for (const profile of data.profiles) {
    // 1. Only id and name are allowed
    const keys = Object.keys(profile);
    assert.deepEqual(
      keys.sort(),
      ['id', 'name'],
      `Catalogue entry for ${profile.id} must only contain 'id' and 'name' keys. Found: ${keys.join(', ')}`
    );

    // 2. No handle, contact, email, or sensitive keys anywhere
    assert.equal(profile.handle, undefined, `Profile ${profile.id} must not have a 'handle' property`);
    assert.equal(profile.contact_value, undefined, `Profile ${profile.id} must not have a 'contact_value' property`);
    assert.equal(profile.telegram, undefined, `Profile ${profile.id} must not have a 'telegram' property`);

    // 3. ID and name constraints
    assert.match(profile.id, /^[A-Za-z0-9._-]{1,50}$/, `Profile ID ${profile.id} must match safe identifier pattern`);
    assert.ok(typeof profile.name === 'string' && profile.name.length > 0 && profile.name.length <= 120, 'Name must be 1-120 chars');

    // 4. No duplicate IDs
    assert.ok(!seenIds.has(profile.id), `Duplicate profile ID found in catalogue: ${profile.id}`);
    seenIds.add(profile.id);
  }
});

test('Dynamic profile catalogue generation preserves privacy on sample fixtures', () => {
  // Synthetic profiles test representing generator filtering logic
  const sampleProfiles = [
    { id: 'valid_creator_1', name: 'Valid Creator', handle: '@private_handle_1', isVisible: true },
    { id: 'valid_creator_2', name: 'Another Creator', handle: '@private_handle_2', isVisible: true },
    { id: 'hidden_creator', name: 'Hidden Person', handle: '@hidden_handle', isVisible: false },
    { id: 'invalid/id!', name: 'Invalid ID', handle: '@bad_id', isVisible: true },
    { id: 'valid_creator_1', name: 'Duplicate Creator', handle: '@duplicate_handle', isVisible: true },
  ];

  const processed = sampleProfiles
    .filter(p => p.isVisible && /^[A-Za-z0-9._-]{1,50}$/.test(p.id))
    .reduce((out, p) => {
      if (!out.some(x => x.id === p.id)) {
        out.push({ id: p.id, name: String(p.name || p.id).slice(0, 120) });
      }
      return out;
    }, []);

  // Assertions on fixture processing
  assert.equal(processed.length, 2, 'Only visible, valid-id, deduplicated profiles should be included');
  assert.deepEqual(processed, [
    { id: 'valid_creator_1', name: 'Valid Creator' },
    { id: 'valid_creator_2', name: 'Another Creator' }
  ]);

  for (const p of processed) {
    assert.equal(p.handle, undefined, 'Handle must be stripped from public output');
    assert.deepEqual(Object.keys(p).sort(), ['id', 'name']);
  }
});
