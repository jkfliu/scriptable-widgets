const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { bundle, buildWidget, listWidgets, readConfig } = require('../scripts/build.js');
const { findSecrets } = require('../scripts/check-secrets.js');

const ROOT = path.join(__dirname, '..');

// Scriptable runs scripts with top-level await, so parse inside an async function.
const parses = (src) => new vm.Script(`(async () => {\n${src}\n})`);

// A throwaway repo layout: { 'widgets/a/widget.json': '...', ... } written under a temp folder.
function tempRepo(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'build-test-'));
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  return root;
}

const config = {
  name: 'Demo',
  output: 'Demo.js',
  version: '1.2.3',
  shared: [],
  icon: { color: 'blue', glyph: 'smog' },
};
const core = "const { fmt } = require('../../../shared/format.js');\n\nfunction a() { return fmt(1); }\n\nmodule.exports = {\n  a,\n};\n";
const widget = [
  '// Scriptable layer.',
  "const { a } = require('./core.js');",
  '',
  "const VERSION = 'dev';",
  '',
  'await a();',
  '',
].join('\n');
const format = "function fmt(x) { return String(x); }\n\nmodule.exports = { fmt };\n";
const clock = "const { fmt } = require('./format.js');\n\nfunction now() { return fmt(0); }\n\nmodule.exports = {\n  now,\n};\n";

describe('bundle', () => {
  const shared = [{ name: 'format', source: format }];
  const out = bundle({ config: { ...config, shared: ['format'] }, shared, core, widget });

  test('starts with the Scriptable icon header', () => {
    const lines = out.split('\n');
    assert.equal(lines[0], '// Variables used by Scriptable.');
    assert.equal(lines[1], '// These must be at the very top of the file. Do not edit.');
    assert.equal(lines[2], '// icon-color: blue; icon-glyph: smog;');
  });

  test('puts shared modules, then core, then the widget', () => {
    const order = ['function fmt', 'function a()', 'await a();'].map((s) => out.indexOf(s));
    assert.ok(order.every((i) => i > 0), 'all parts present');
    assert.deepEqual([...order].sort((x, y) => x - y), order);
  });

  test('strips module.exports and require lines, leaving no CommonJS', () => {
    assert.ok(!/\brequire\(|module\.exports/.test(out));
  });

  test('sets VERSION from the config', () => {
    assert.match(out, /^const VERSION = '1\.2\.3';$/m);
    assert.ok(!out.includes("'dev'"));
  });

  test('sets UPDATE_REPO only when the config has updateRepo', () => {
    const w = widget.replace("const VERSION = 'dev';", "const VERSION = 'dev';\nconst UPDATE_REPO = '';");
    const withRepo = bundle({ config: { ...config, updateRepo: 'jkfliu/demo' }, shared: [], core, widget: w });
    assert.match(withRepo, /^const UPDATE_REPO = 'jkfliu\/demo';$/m);
    assert.throws(() => bundle({ config: { ...config, updateRepo: 'jkfliu/demo' }, shared: [], core, widget }), /UPDATE_REPO/);
  });

  test('parses as JavaScript', () => {
    assert.doesNotThrow(() => parses(out));
  });

  test('with no shared modules: header, core, widget, separated by blank lines', () => {
    const plain = bundle({ config, shared: [], core: 'const x = 1;\n\nmodule.exports = { x };\n', widget: "const { x } = require('./core.js');\nconst VERSION = 'dev';\nawait x;\n" });
    assert.equal(
      plain,
      [
        '// Variables used by Scriptable.',
        '// These must be at the very top of the file. Do not edit.',
        '// icon-color: blue; icon-glyph: smog;',
        '',
        'const x = 1;',
        '',
        "const VERSION = '1.2.3';",
        'await x;',
        '',
      ].join('\n'),
    );
  });

  test('throws if core has no module.exports, or the widget no require of core.js or VERSION line', () => {
    assert.throws(() => bundle({ config, shared: [], core: 'function a() {}\n', widget }), /module\.exports/);
    assert.throws(() => bundle({ config, shared: [], core, widget: widget.replace(/^const \{ a \}.*\n/m, '') }), /require/);
    assert.throws(() => bundle({ config, shared: [], core, widget: widget.replace(/^const VERSION.*\n/m, '') }), /VERSION/);
  });

  test('throws on a malformed version, repo or icon, so nothing odd gets baked in', () => {
    for (const version of ['1.2', '1.10', "1.0.0'; evil()//", '', undefined]) {
      assert.throws(() => bundle({ config: { ...config, version }, shared: [], core, widget }), /version/);
    }
    for (const updateRepo of ['not a repo', 'a/b/c', '../x', "a/b'"]) {
      assert.throws(() => bundle({ config: { ...config, updateRepo }, shared: [], core, widget }), /repo/);
    }
    assert.throws(() => bundle({ config: { ...config, icon: { color: 'blue;', glyph: 'smog' } }, shared: [], core, widget }), /icon/);
    assert.throws(() => bundle({ config: { ...config, icon: undefined }, shared: [], core, widget }), /icon/);
  });
});

describe('readConfig', () => {
  test('requires name, output, version and a shared list', () => {
    const ok = { name: 'A', output: 'A.js', version: '1.0.0', shared: [], icon: { color: 'blue', glyph: 'smog' } };
    assert.deepEqual(readConfig(JSON.stringify(ok)), ok);
    for (const key of ['name', 'output', 'version', 'shared']) {
      const bad = { ...ok };
      delete bad[key];
      assert.throws(() => readConfig(JSON.stringify(bad)), new RegExp(key));
    }
  });

  test('rejects an output that is not a plain .js filename', () => {
    const base = { name: 'A', version: '1.0.0', shared: [], icon: { color: 'blue', glyph: 'smog' } };
    for (const output of ['../A.js', 'a/A.js', 'A.txt', '.js']) {
      assert.throws(() => readConfig(JSON.stringify({ ...base, output })), /output/);
    }
  });

  test('rejects malformed JSON with a clear error', () => {
    assert.throws(() => readConfig('{ not json'), /widget\.json/);
  });
});

describe('buildWidget and listWidgets on a temp repo', () => {
  const root = tempRepo({
    'shared/format.js': format,
    'shared/clock.js': clock,
    'widgets/one/widget.json': JSON.stringify({ ...config, name: 'One', output: 'One.js', shared: ['format'] }),
    'widgets/one/src/core.js': core,
    'widgets/one/src/widget.js': widget,
    'widgets/two/widget.json': JSON.stringify({ ...config, name: 'Two', output: 'Two.js', shared: [] }),
    'widgets/two/src/core.js': 'function b() {}\n\nmodule.exports = { b };\n',
    'widgets/two/src/widget.js': "const { b } = require('./core.js');\nconst VERSION = 'dev';\nb();\n",
    'widgets/bad/widget.json': JSON.stringify({ ...config, output: 'Bad.js', shared: ['missing'] }),
    'widgets/bad/src/core.js': core,
    'widgets/bad/src/widget.js': widget,
    'widgets/not-a-widget/README.md': 'no widget.json here',
  });

  test('listWidgets finds folders with a widget.json, sorted', () => {
    assert.deepEqual(listWidgets(root), ['bad', 'one', 'two']);
  });

  test('a bundle includes only the shared modules its widget lists', () => {
    const one = buildWidget('one', root);
    assert.equal(one.output, 'One.js');
    assert.ok(one.source.includes('function fmt'));
    assert.ok(!one.source.includes('function now'));
    const two = buildWidget('two', root);
    assert.ok(!two.source.includes('function fmt'));
    assert.ok(!two.source.includes('function now'));
  });

  test('throws on an unknown widget or an unknown shared module', () => {
    assert.throws(() => buildWidget('nope', root), /nope/);
    assert.throws(() => buildWidget('bad', root), /missing/);
  });

  test('rejects widget and shared names that would escape their folders', () => {
    assert.throws(() => buildWidget('../one', root), /widget name/);
    const evil = tempRepo({
      'widgets/e/widget.json': JSON.stringify({ ...config, shared: ['../widgets/e/src/core'] }),
      'widgets/e/src/core.js': core,
      'widgets/e/src/widget.js': widget,
    });
    assert.throws(() => buildWidget('e', evil), /shared module name/);
  });
});

describe('the real widgets', () => {
  const names = listWidgets(ROOT);

  test('there is at least one widget', () => {
    assert.ok(names.length > 0);
  });

  for (const name of names) {
    describe(name, () => {
      const built = buildWidget(name, ROOT);

      test('bundle is valid JavaScript', () => {
        assert.doesNotThrow(() => parses(built.source));
      });

      test('bundle has no leftover CommonJS', () => {
        assert.ok(!/\brequire\(|module\.exports/.test(built.source));
      });

      test('bundle contains no API key value or other secrets', () => {
        assert.deepEqual(findSecrets(built.source), []);
      });

      test('committed dist/ file matches a fresh build', () => {
        const file = path.join(ROOT, 'dist', built.output);
        assert.ok(fs.existsSync(file), `dist/${built.output} is missing: run npm run build`);
        assert.equal(fs.readFileSync(file, 'utf8'), built.source, `dist/${built.output} is stale: run npm run build`);
      });
    });
  }

  test('dist/ holds only the built widgets', () => {
    const expected = names.map((n) => buildWidget(n, ROOT).output).sort();
    assert.deepEqual(fs.readdirSync(path.join(ROOT, 'dist')).sort(), expected);
  });
});
