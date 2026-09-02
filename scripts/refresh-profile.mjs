import { readFile, writeFile } from "node:fs/promises";

const PROFILE_ID = "84dULJFIN4bHIC1LxCiuvBCSqT43";
const LPU_HOME = "https://lpubelts.com/";
const LPU_DATA =
  "https://raw.githubusercontent.com/Lockpickers-United/lpu-belt-explorer/main/src/data/data.json";
const DATA_FILE = new URL("../app/data.ts", import.meta.url);

async function getText(url) {
  const response = await fetch(url, {
    headers: { "user-agent": "todd-lock-analytics-refresh/1.0" },
  });
  if (!response.ok) throw new Error(`Request failed (${response.status}): ${url}`);
  return response.text();
}

async function getJson(url) {
  return JSON.parse(await getText(url));
}

function firestoreStrings(field) {
  return field?.arrayValue?.values?.map((value) => value.stringValue).filter(Boolean) ?? [];
}

function lockName(entry) {
  return entry.makeModels
    .map(({ make, model }) => [make, model].filter(Boolean).join(" ").trim())
    .filter(Boolean)
    .join(" / ");
}

const home = await getText(LPU_HOME);
const assetPath = home.match(/assets\/index-[A-Za-z0-9_-]+\.js/)?.[0];
if (!assetPath) throw new Error("Could not locate the current LPU application asset.");

const application = await getText(new URL(assetPath, LPU_HOME));
const apiKey = application.match(/AIza[0-9A-Za-z_-]{30,}/)?.[0];
if (!apiKey) throw new Error("Could not locate the public LPU Firebase API key.");

const profileUrl =
  `https://firestore.googleapis.com/v1/projects/lpu-belt-explorer/databases/(default)/documents/` +
  `lockcollections/${PROFILE_ID}?key=${apiKey}`;
const [profile, allEntries] = await Promise.all([getJson(profileUrl), getJson(LPU_DATA)]);

const ownedIds = firestoreStrings(profile.fields?.own);
const wishlistIds = firestoreStrings(profile.fields?.wishlist);
const pickedIds = firestoreStrings(profile.fields?.picked);
const selectedIds = new Set([...ownedIds, ...wishlistIds]);
const selectedEntries = allEntries.filter((entry) => selectedIds.has(entry.id));

if (ownedIds.length + wishlistIds.length !== selectedIds.size) {
  throw new Error("Owned and wishlist profile data overlap; refusing to publish ambiguous data.");
}
if (selectedEntries.length !== selectedIds.size) {
  throw new Error(
    `LPU catalog mismatch: found ${selectedEntries.length} of ${selectedIds.size} selected locks.`,
  );
}
if (pickedIds.some((id) => !ownedIds.includes(id))) {
  throw new Error("A picked lock is not marked owned; refusing to publish inconsistent data.");
}

const catalog = selectedEntries.map((entry) => ({
  id: entry.id,
  name: lockName(entry),
  ...(entry.version ? { version: entry.version } : {}),
  mechanisms: entry.lockingMechanisms ?? [],
  belt: entry.belt,
}));

let source = await readFile(DATA_FILE, "utf8");
const start = source.indexOf("const lockCatalog:");
const end = source.indexOf("export const ownedLocks");
if (start < 0 || end < 0 || end <= start) {
  throw new Error("Could not find the generated profile-data section in app/data.ts.");
}

const generated = `const lockCatalog: Omit<LockRecord, "status" | "picked">[] = ${JSON.stringify(catalog, null, 2)};

const ownedLockIds = new Set(${JSON.stringify(ownedIds, null, 2)});
const pickedLockIds = new Set(${JSON.stringify(pickedIds, null, 2)});

export const locks: LockRecord[] = lockCatalog.map((lock) => ({
  ...lock,
  status: ownedLockIds.has(lock.id) ? "Owned" : "Wishlist",
  picked: pickedLockIds.has(lock.id),
}));

`;

const refreshedOn = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "America/New_York",
}).format(new Date());

source = source.slice(0, start) + generated + source.slice(end);
source = source.replace(
  /export const profileSnapshotDate = "[^"]+";/,
  `export const profileSnapshotDate = "${refreshedOn}";`,
);
await writeFile(DATA_FILE, source);

console.log(
  `Refreshed ${selectedEntries.length} locks: ${ownedIds.length} owned, ` +
    `${wishlistIds.length} wishlist, ${pickedIds.length} picked.`,
);
