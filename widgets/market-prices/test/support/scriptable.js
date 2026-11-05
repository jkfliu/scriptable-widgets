// Stand-ins for the parts of Scriptable's API that widget.js uses, so the built bundle can run under
// Node in tests. Not a test file. Modelled on widgets/sg-haze/scripts/preview.js.

const vm = require('node:vm');

class Color {
  constructor(hex, alpha = 1) { this.hex = hex; this.alpha = alpha; }
  static dynamic(light, dark) { return { light, dark }; }
}

const Font = new Proxy({}, { get: (_, name) => (size) => ({ name: String(name), size }) });

class Size { constructor(width, height) { this.width = width; this.height = height; } }

class WidgetText {
  constructor(text) {
    this.kind = 'text';
    this.text = String(text);
    this.align = 'left';
    this.textOpacity = 1;
  }
  leftAlignText() { this.align = 'left'; }
  rightAlignText() { this.align = 'right'; }
  centerAlignText() { this.align = 'center'; }
}

class WidgetStack {
  constructor() {
    this.kind = 'stack';
    this.children = [];
    this.vertical = false;
    this.align = null;
    this.size = null;
    this.spacing = 0;
  }
  layoutVertically() { this.vertical = true; }
  layoutHorizontally() { this.vertical = false; }
  topAlignContent() { this.align = 'top'; }
  centerAlignContent() { this.align = 'center'; }
  bottomAlignContent() { this.align = 'bottom'; }
  setPadding(...p) { this.padding = p; }
  addStack() { return this.push(new WidgetStack()); }
  addText(text) { return this.push(new WidgetText(text)); }
  addSpacer(length) { return this.push({ kind: 'spacer', length: length ?? null }); }
  push(node) { this.children.push(node); return node; }
}

class ListWidget extends WidgetStack {
  constructor() { super(); this.kind = 'widget'; this.vertical = true; this.presented = null; }
  presentSmall() { this.presented = 'small'; }
  presentMedium() { this.presented = 'medium'; }
  presentLarge() { this.presented = 'large'; }
}

// All text nodes in a widget tree, depth first.
function texts(node) {
  if (!node) return [];
  if (node.kind === 'text') return [node];
  return (node.children ?? []).flatMap(texts);
}

// Runs the bundle once and reports what it did.
// responder(url, headers) returns { status, body } or throws to simulate a network failure.
// alertChoices: indexes to pick in successive Alerts (default: cancel, -1).
// textInputs: what the user types into successive text fields.
async function runBundle(source, {
  family = 'medium', parameter = null, now, responder, files = {}, keychain = {}, runsInWidget = true, alertChoices = [], textInputs = [],
} = {}) {
  const requests = [];
  const alerts = [];
  const presented = [];
  let widget = null;
  const choices = [...alertChoices];
  const inputs = [...textInputs];

  const RealDate = Date;
  class FixedDate extends RealDate {
    constructor(...a) { super(...(a.length ? a : [now])); }
    static now() { return now; }
  }
  class Request {
    constructor(url) { this.url = url; this.headers = {}; this.response = {}; this.timeoutInterval = null; }
    async loadString() {
      requests.push({ url: this.url, headers: { ...this.headers }, timeout: this.timeoutInterval });
      const { status, body } = await responder(this.url, this.headers);
      this.response.statusCode = status;
      return body;
    }
  }
  class Alert {
    constructor() { this.actions = []; this.textFields = []; alerts.push(this); }
    addAction(t) { this.actions.push(t); }
    addDestructiveAction(t) { this.actions.push(t); }
    addCancelAction(t) { this.cancel = t; }
    addTextField(p, v) { this.textFields.push(inputs.length ? inputs.shift() : v ?? ''); }
    addSecureTextField(p, v) { this.addTextField(p, v); }
    textFieldValue(i) { return this.textFields[i]; }
    async present() { return choices.length ? choices.shift() : -1; }
    async presentSheet() { return this.present(); }
    async presentAlert() { return this.present(); }
  }
  const fm = {
    documentsDirectory: () => '/documents',
    joinPath: (a, b) => `${a}/${b}`,
    fileExists: (p) => p in files,
    readString: (p) => { if (!(p in files)) throw new Error(`no file ${p}`); return files[p]; },
    writeString: (p, s) => { files[p] = s; },
  };
  const ListWidgetSpy = class extends ListWidget {
    presentSmall() { super.presentSmall(); presented.push(this); }
    presentMedium() { super.presentMedium(); presented.push(this); }
  };
  const quiet = { log() {}, warn() {}, error() {} };
  const sandbox = {
    console: quiet, Date: FixedDate, Request, Color, Font, Size, ListWidget: ListWidgetSpy, Alert,
    Keychain: {
      contains: (k) => k in keychain,
      get: (k) => { if (!(k in keychain)) throw new Error(`no key ${k}`); return keychain[k]; },
      set: (k, v) => { keychain[k] = v; },
      remove: (k) => { delete keychain[k]; },
    },
    FileManager: { local: () => fm, iCloud: () => fm },
    Script: { setWidget: (w) => { widget = w; }, complete() {} },
    args: { widgetParameter: parameter },
    config: { runsInWidget, runsInApp: !runsInWidget, widgetFamily: runsInWidget ? family : undefined },
  };
  vm.createContext(sandbox);
  await vm.runInContext(`(async () => {\n${source}\n})()`, sandbox, { filename: 'Market Prices.js' });
  return { widget, requests, files, keychain, alerts, presented };
}

module.exports = { runBundle, texts };
