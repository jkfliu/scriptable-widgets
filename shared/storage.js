// Thin wrappers over Scriptable's FileManager and Keychain, shared by widgets.
// They use Scriptable globals at call time, so the tests stand those in.

function localPath(name) {
  const fm = FileManager.local();
  return fm.joinPath(fm.documentsDirectory(), name);
}

// The parsed JSON in a local documents file, or {} if it's missing, malformed or null.
function readJsonFile(name) {
  try {
    return JSON.parse(FileManager.local().readString(localPath(name))) ?? {};
  } catch (e) {
    return {};
  }
}

const writeJsonFile = (name, value) => FileManager.local().writeString(localPath(name), JSON.stringify(value));

const keychainHas = (key) => Keychain.contains(key);
const keychainGet = (key) => (Keychain.contains(key) ? Keychain.get(key) : null);
const keychainSet = (key, value) => Keychain.set(key, value);
function keychainRemove(key) {
  if (Keychain.contains(key)) Keychain.remove(key);
}

module.exports = {
  readJsonFile, writeJsonFile, keychainHas, keychainGet, keychainSet, keychainRemove,
};
