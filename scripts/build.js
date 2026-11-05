#!/usr/bin/env node
// Builds widgets into single-file Scriptable scripts in dist/.
// Each bundle is: Scriptable header, the shared modules its widget.json lists, src/core.js, then
// src/widget.js, with CommonJS lines stripped and VERSION (and UPDATE_REPO, if set) filled in.
// Plain file concatenation: no bundler.
// Usage: node scripts/build.js [widget]   (no argument builds every widget)

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

const SCRIPTABLE_HEADER = '// Variables used by Scriptable.';
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const REPO_PATTERN = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const ICON_PATTERN = /^[a-z0-9-]+$/;
const OUTPUT_PATTERN = /^[^/\\]+\.js$/;

const EXPORTS = /^module\.exports = \{[\s\S]*?\};\n?/m;
// A top-level `const { ... } = require('./x.js');`, possibly spread over several lines.
const REQUIRES = /^const \{[^}]*\} = require\('[^']*'\);\n?/gm;
const REQUIRE_CORE = /^const \{[^}]*\} = require\('\.\/core\.js'\);\n?/m;
const VERSION_LINE = /^const VERSION = '[^']*';$/m;
const REPO_LINE = /^const UPDATE_REPO = '[^']*';$/m;
const WIDGET_LINE = /^const UPDATE_WIDGET = '[^']*';$/m;
const SCRIPT_LINE = /^const UPDATE_SCRIPT = '[^']*';$/m;
// Shared modules a file requires: './x.js' from another shared module, '../../../shared/x.js' from a widget.
const SHARED_REQUIRE = /require\('\.\/([^']+)\.js'\)/g;
const WIDGET_SHARED_REQUIRE = /require\('\.\.\/\.\.\/\.\.\/shared\/([^']+)\.js'\)/g;

// Parses and checks a widget.json. Throws with a clear message on anything malformed.
function readConfig(text) {
  let config;
  try {
    config = JSON.parse(text);
  } catch (e) {
    throw new Error(`build: widget.json is not valid JSON: ${e.message}`);
  }
  for (const key of ['name', 'output', 'version']) {
    if (typeof config?.[key] !== 'string' || !config[key]) throw new Error(`build: widget.json needs "${key}"`);
  }
  if (!Array.isArray(config.shared)) throw new Error('build: widget.json needs a "shared" list');
  if (!OUTPUT_PATTERN.test(config.output) || config.output === '.js') {
    throw new Error(`build: bad output filename ${config.output}`);
  }
  return config;
}

// Throws rather than silently leaving CommonJS in the bundle, which Scriptable can't run.
function strip(source, pattern, what) {
  if (!pattern.test(source)) throw new Error(`build: expected ${what} to strip`);
  return source.replace(pattern, '');
}

function setLine(source, pattern, line, what) {
  if (!pattern.test(source)) throw new Error(`build: expected a ${what} line in widget.js`);
  return source.replace(pattern, line);
}

const stripRequires = (source) => source.replace(REQUIRES, '');

function header({ icon } = {}) {
  if (!ICON_PATTERN.test(icon?.color ?? '') || !ICON_PATTERN.test(icon?.glyph ?? '')) {
    throw new Error('build: widget.json needs an icon with a color and glyph');
  }
  return [
    SCRIPTABLE_HEADER,
    '// These must be at the very top of the file. Do not edit.',
    `// icon-color: ${icon.color}; icon-glyph: ${icon.glyph};`,
  ].join('\n');
}

// config: a parsed widget.json. folder: the widget's folder under widgets/.
// shared: [{ name, source }] in the order listed. core, widget: sources.
function bundle({ config, folder, shared, core, widget }) {
  if (!VERSION_PATTERN.test(config.version ?? '')) throw new Error(`build: bad version ${config.version}`);
  if (config.updateRepo !== undefined && (!REPO_PATTERN.test(config.updateRepo) || config.updateRepo.includes('..'))) {
    throw new Error(`build: bad update repo ${config.updateRepo}`);
  }
  const parts = shared.map(({ name, source }) =>
    stripRequires(strip(source, EXPORTS, `module.exports in shared/${name}.js`)).trim(),
  );
  parts.push(stripRequires(strip(core, EXPORTS, 'module.exports in core.js')).trim());

  let main = strip(widget, REQUIRE_CORE, "require('./core.js') in widget.js");
  main = stripRequires(main).trim();
  main = setLine(main, VERSION_LINE, `const VERSION = '${config.version}';`, 'VERSION');
  if (config.updateRepo !== undefined) {
    main = setLine(main, REPO_LINE, `const UPDATE_REPO = '${config.updateRepo}';`, 'UPDATE_REPO');
    if (!NAME_PATTERN.test(folder ?? '')) throw new Error(`build: bad widget folder ${folder}`);
    main = setLine(main, WIDGET_LINE, `const UPDATE_WIDGET = '${folder}';`, 'UPDATE_WIDGET');
    main = setLine(main, SCRIPT_LINE, `const UPDATE_SCRIPT = '${config.output}';`, 'UPDATE_SCRIPT');
  }
  return `${[header(config), ...parts, main].join('\n\n')}\n`;
}

// Widget folder names under widgets/ that have a widget.json, sorted.
function listWidgets(root = ROOT) {
  const dir = path.join(root, 'widgets');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(dir, d.name, 'widget.json')))
    .map((d) => d.name)
    .sort();
}

const requiredNames = (source, pattern) => [...source.matchAll(pattern)].map((m) => m[1]);

// The bundle is one scope, so every shared module a file uses must be in it, and before its users.
// Otherwise the bundle would still parse but fail with a ReferenceError on the phone.
function checkSharedRequires(name, listed, shared, widgetSources) {
  shared.forEach((mod, i) => {
    for (const dep of requiredNames(mod.source, SHARED_REQUIRE)) {
      if (!listed.slice(0, i).includes(dep)) {
        throw new Error(`build: shared/${mod.name}.js requires ${dep}, which ${name}'s widget.json must list before ${mod.name}`);
      }
    }
  });
  for (const source of widgetSources) {
    for (const dep of requiredNames(source, WIDGET_SHARED_REQUIRE)) {
      if (!listed.includes(dep)) throw new Error(`build: ${name} requires shared module ${dep}, which is not listed in its widget.json`);
    }
  }
}

// { output, source } for one widget.
function buildWidget(name, root = ROOT) {
  if (!NAME_PATTERN.test(name)) throw new Error(`build: bad widget name ${name}`);
  const dir = path.join(root, 'widgets', name);
  if (!fs.existsSync(path.join(dir, 'widget.json'))) throw new Error(`build: no widget called ${name}`);
  const read = (file) => fs.readFileSync(file, 'utf8');
  const config = readConfig(read(path.join(dir, 'widget.json')));
  const shared = config.shared.map((mod) => {
    if (!NAME_PATTERN.test(mod)) throw new Error(`build: bad shared module name ${mod}`);
    const file = path.join(root, 'shared', `${mod}.js`);
    if (!fs.existsSync(file)) throw new Error(`build: ${name} lists shared module ${mod}, which doesn't exist`);
    return { name: mod, source: read(file) };
  });
  const core = read(path.join(dir, 'src', 'core.js'));
  const widget = read(path.join(dir, 'src', 'widget.js'));
  checkSharedRequires(name, config.shared, shared, [core, widget]);
  const source = bundle({ config, folder: name, shared, core, widget });
  return { output: config.output, source };
}

function main(args) {
  const names = args.length ? args : listWidgets();
  fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
  for (const name of names) {
    const { output, source } = buildWidget(name);
    fs.writeFileSync(path.join(ROOT, 'dist', output), source);
    console.log(`built dist/${output}`);
  }
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

module.exports = { bundle, buildWidget, listWidgets, readConfig };
