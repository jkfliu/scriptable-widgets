// Runs scripts/release.sh on a throwaway copy of the repo. RELEASE_TEST_CMD stands in for the
// full test suite, which would otherwise run these tests again inside the copy.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PASS = 'node -e "process.exit(0)"';
const FAIL = 'node -e "process.exit(1)"';

function copyRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-test-'));
  fs.cpSync(ROOT, dir, {
    recursive: true,
    filter: (src) => !/[/\\](\.git|node_modules)([/\\]|$)/.test(src.slice(ROOT.length)),
  });
  return dir;
}

function release(dir, args, testCmd = PASS) {
  const result = spawnSync('sh', ['scripts/release.sh', ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, RELEASE_TEST_CMD: testCmd },
  });
  return { code: result.status, out: result.stdout + result.stderr };
}

const readJson = (dir, rel) => JSON.parse(fs.readFileSync(path.join(dir, rel), 'utf8'));
const exists = (dir, rel) => fs.existsSync(path.join(dir, rel));

describe('release.sh refuses bad input, changing nothing', () => {
  const dir = copyRepo();
  const before = fs.readFileSync(path.join(dir, 'widgets/sg-haze/widget.json'), 'utf8');
  const unchanged = () => assert.equal(fs.readFileSync(path.join(dir, 'widgets/sg-haze/widget.json'), 'utf8'), before);

  test('needs a widget, a version and notes', () => {
    for (const args of [[], ['sg-haze'], ['sg-haze', '1.2.0']]) {
      const { code, out } = release(dir, args);
      assert.equal(code, 2, out);
      assert.match(out, /usage/);
    }
    unchanged();
  });

  test('an unknown widget', () => {
    const { code, out } = release(dir, ['nope', '1.0.0', 'Notes']);
    assert.notEqual(code, 0);
    assert.match(out, /nope/);
  });

  test('a malformed version', () => {
    for (const v of ['1.2', 'v1.2.0', '1.2.0-beta', "1.2.0'"]) {
      const { code, out } = release(dir, ['sg-haze', v, 'Notes']);
      assert.notEqual(code, 0, `${v}: ${out}`);
      assert.match(out, /x\.y\.z/);
    }
    unchanged();
  });

  test('a version that is not newer than the last release (1.10.0 vs 1.9.0 compares as numbers)', () => {
    const current = readJson(dir, 'widgets/sg-haze/version.json').version; // 1.1.0
    for (const v of [current, '1.0.9', '0.9.0']) {
      const { code, out } = release(dir, ['sg-haze', v, 'Notes']);
      assert.notEqual(code, 0, `${v}: ${out}`);
      assert.match(out, /not newer/);
    }
    unchanged();
  });

  test('stops when the tests fail, before changing any file', () => {
    const { code, out } = release(dir, ['sg-haze', '1.2.0', 'Notes'], FAIL);
    assert.notEqual(code, 0, out);
    unchanged();
    assert.equal(readJson(dir, 'widgets/sg-haze/version.json').version, '1.1.0');
  });
});

describe('release.sh on success', () => {
  test('sets the version, builds the widget, and writes version.json with the notes', () => {
    const dir = copyRepo();
    const { code, out } = release(dir, ['sg-haze', '1.10.0', 'Bigger chart']);
    assert.equal(code, 0, out);
    assert.equal(readJson(dir, 'widgets/sg-haze/widget.json').version, '1.10.0');
    assert.deepEqual(readJson(dir, 'widgets/sg-haze/version.json'), { version: '1.10.0', notes: 'Bigger chart' });
    assert.ok(fs.readFileSync(path.join(dir, 'dist/SG Haze.js'), 'utf8').includes("\nconst VERSION = '1.10.0';\n"));
    assert.match(out, /CHANGELOG/);
  });

  test('keeps the other fields of widget.json', () => {
    const dir = copyRepo();
    const before = readJson(dir, 'widgets/sg-haze/widget.json');
    release(dir, ['sg-haze', '1.2.0', 'Notes']);
    assert.deepEqual(readJson(dir, 'widgets/sg-haze/widget.json'), { ...before, version: '1.2.0' });
  });

  test('a first release, with no version.json yet', () => {
    const dir = copyRepo();
    fs.rmSync(path.join(dir, 'widgets/market-prices/version.json'), { force: true });
    const { code, out } = release(dir, ['market-prices', '1.0.0', 'First release.']);
    assert.equal(code, 0, out);
    assert.ok(exists(dir, 'widgets/market-prices/version.json'));
    assert.ok(fs.readFileSync(path.join(dir, 'dist/Market Prices.js'), 'utf8').includes("\nconst VERSION = '1.0.0';\n"));
  });

  test('only rebuilds the widget being released', () => {
    const dir = copyRepo();
    // An unreleased change to another widget must not reach its dist/ file.
    fs.appendFileSync(path.join(dir, 'widgets/market-prices/src/core.js'), '\n// unreleased change\n');
    const other = fs.readFileSync(path.join(dir, 'dist/Market Prices.js'), 'utf8');
    release(dir, ['sg-haze', '1.2.0', 'Notes']);
    assert.equal(fs.readFileSync(path.join(dir, 'dist/Market Prices.js'), 'utf8'), other);
  });

  test('notes with quotes and newlines are stored as written', () => {
    const dir = copyRepo();
    const notes = 'Fixes "stale" label\nand the chart\'s colours';
    assert.equal(release(dir, ['sg-haze', '1.2.0', notes]).code, 0);
    assert.equal(readJson(dir, 'widgets/sg-haze/version.json').notes, notes);
  });
});
