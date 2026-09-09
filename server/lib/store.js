// Simple JSON file persistence for linked accounts and cached data.
// Everything lives under data/ which is gitignored.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.resolve(here, "../../data");
const STORE_FILE = path.join(DATA_DIR, "store.json");

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function readStore() {
  ensureDir();
  try {
    return JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
  } catch {
    return { accounts: {} };
  }
}

export function writeStore(store) {
  ensureDir();
  const tmp = STORE_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, STORE_FILE);
}

export function getAccount(provider) {
  return readStore().accounts[provider] || null;
}

export function setAccount(provider, data) {
  const store = readStore();
  store.accounts[provider] = { ...data, linkedAt: new Date().toISOString() };
  writeStore(store);
  return store.accounts[provider];
}

export function removeAccount(provider) {
  const store = readStore();
  delete store.accounts[provider];
  writeStore(store);
}

// Disk cache with TTL, used for the large Sleeper player database.
export function readCache(name, maxAgeMs) {
  ensureDir();
  const file = path.join(DATA_DIR, name);
  try {
    const stat = fs.statSync(file);
    if (Date.now() - stat.mtimeMs > maxAgeMs) return null;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function writeCache(name, data) {
  ensureDir();
  const file = path.join(DATA_DIR, name);
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}
