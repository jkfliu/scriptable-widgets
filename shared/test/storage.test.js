const { test, describe, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  readJsonFile, writeJsonFile, keychainHas, keychainGet, keychainSet, keychainRemove,
} = require('../storage.js');

// In-memory stand-ins for Scriptable's FileManager and Keychain globals.
let files;
let keys;
const saved = { FileManager: globalThis.FileManager, Keychain: globalThis.Keychain };

beforeEach(() => {
  files = new Map();
  keys = new Map();
  const fm = {
    documentsDirectory: () => '/docs',
    joinPath: (a, b) => `${a}/${b}`,
    readString: (p) => {
      if (!files.has(p)) throw new Error(`no file ${p}`);
      return files.get(p);
    },
    writeString: (p, s) => files.set(p, s),
  };
  globalThis.FileManager = { local: () => fm };
  globalThis.Keychain = {
    contains: (k) => keys.has(k),
    get: (k) => {
      if (!keys.has(k)) throw new Error(`no key ${k}`);
      return keys.get(k);
    },
    set: (k, v) => keys.set(k, v),
    remove: (k) => keys.delete(k),
  };
});

after(() => Object.assign(globalThis, saved));

describe('readJsonFile and writeJsonFile', () => {
  test('round-trips a value through a file in the local documents folder', () => {
    writeJsonFile('cache.json', { a: 1, b: [2] });
    assert.equal(files.get('/docs/cache.json'), '{"a":1,"b":[2]}');
    assert.deepEqual(readJsonFile('cache.json'), { a: 1, b: [2] });
  });

  test('a missing file reads as {}', () => {
    assert.deepEqual(readJsonFile('missing.json'), {});
  });

  test('malformed JSON or a null value reads as {}', () => {
    files.set('/docs/bad.json', '{ not json');
    assert.deepEqual(readJsonFile('bad.json'), {});
    files.set('/docs/null.json', 'null');
    assert.deepEqual(readJsonFile('null.json'), {});
  });
});

describe('Keychain helpers', () => {
  test('set, has, get and remove a key', () => {
    assert.equal(keychainHas('k'), false);
    keychainSet('k', 'secret');
    assert.equal(keychainHas('k'), true);
    assert.equal(keychainGet('k'), 'secret');
    keychainRemove('k');
    assert.equal(keychainHas('k'), false);
  });

  test('get returns null for a missing key instead of throwing', () => {
    assert.equal(keychainGet('missing'), null);
  });

  test('remove of a missing key does nothing', () => {
    assert.doesNotThrow(() => keychainRemove('missing'));
  });
});
