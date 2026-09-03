import { readFile, writeFile } from "node:fs/promises";

const PROFILE_ID = "84dULJFIN4bHIC1LxCiuvBCSqT43";
const LPU_HOME = "https://lpubelts.com/";
const LPU_DATA =
  "https://raw.githubusercontent.com/Lockpickers-United/lpu-belt-explorer/main/src/data/data.json";
const LPU_LEADERBOARD = "https://explore.lpubelts.com/data/leaderboardData.json";
const DATA_FILE = new URL("../app/data.ts", import.meta.url);
const WISHLIST_OWNERS_FILE = new URL("../app/wishlist-owners.ts", import.meta.url);

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

function hasPublicDisplayName(value) {
  const name = value?.trim();
  return Boolean(name) && name.toLowerCase() !== "no display name";
}

function lockName(entry) {
  return entry.makeModels
    .map(({ make, model }) => [make, model].filter(Boolean).join(" ").trim())
    .filter(Boolean)
    .join(" / ");
}

function normalizedBelt(belt) {
  return /^Black [1-5]$/.test(belt) ? "Black" : belt;
}

function trustedMediaUrl(entry, domain) {
  return (entry.media ?? [])
    .map((item) => item.fullUrl)
    .find((value) => {
      try {
        const url = new URL(value);
        return (
          url.protocol === "https:" &&
          (url.hostname === domain || url.hostname.endsWith(`.${domain}`))
        );
      } catch {
        return false;
      }
    });
}

function resourceLinks(entry) {
  const lockWiki = trustedMediaUrl(entry, "lockwiki.com");
  const cataLocks = trustedMediaUrl(entry, "catalocks.eu");
  return {
    lpu: `https://lpubelts.com/locks/${entry.id}.html`,
    ...(lockWiki ? { lockWiki } : {}),
    ...(cataLocks ? { cataLocks } : {}),
  };
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

const catalog = selectedEntries.map((entry) => {
  const belt = normalizedBelt(entry.belt);

  return {
    id: entry.id,
    name: lockName(entry),
    ...(entry.version ? { version: entry.version } : {}),
    mechanisms: entry.lockingMechanisms ?? [],
    belt,
    ...(belt !== entry.belt ? { beltLevel: entry.belt } : {}),
    resourceLinks: resourceLinks(entry),
  };
});

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

const refreshedDate = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "America/New_York",
}).format(new Date());
const refreshedTime = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
  timeZone: "America/New_York",
}).format(new Date());
const refreshedOn = `${refreshedDate} · ${refreshedTime}`;

source = source.slice(0, start) + generated + source.slice(end);
source = source.replace(
  /export const profileSnapshotDate = "[^"]+";/,
  `export const profileSnapshotDate = "${refreshedOn}";`,
);
await writeFile(DATA_FILE, source);

const leaderboard = await getJson(LPU_LEADERBOARD);
const publicProfiles = (leaderboard.data ?? []).filter(
  (entry) => entry.id && hasPublicDisplayName(entry.displayName),
);
const publicProfileNames = new Map(publicProfiles.map((entry) => [entry.id, entry.displayName]));
const firestorePrefix = "projects/lpu-belt-explorer/databases/(default)/documents/lockcollections/";
const profileChunks = [];
for (let index = 0; index < publicProfiles.length; index += 100) {
  profileChunks.push(publicProfiles.slice(index, index + 100));
}

const ownersByLock = new Map(allEntries.map((entry) => [entry.id, []]));
const ownersById = new Map();
for (let index = 0; index < profileChunks.length; index += 8) {
  const batch = profileChunks.slice(index, index + 8);
  const batchResults = await Promise.all(
    batch.map(async (profiles) => {
      const response = await fetch(
        `https://firestore.googleapis.com/v1/projects/lpu-belt-explorer/databases/(default)/documents:batchGet?key=${apiKey}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "user-agent": "todd-lock-analytics-refresh/1.0",
          },
          body: JSON.stringify({
            documents: profiles.map((entry) => `${firestorePrefix}${entry.id}`),
            mask: { fieldPaths: ["displayName", "own", "privacyAnonymous"] },
          }),
        },
      );
      if (!response.ok) {
        throw new Error(`Public profile batch request failed (${response.status}).`);
      }
      return response.json();
    }),
  );

  batchResults.flat().forEach((result) => {
    const document = result.found;
    if (!document || document.fields?.privacyAnonymous?.booleanValue === true) return;

    const id = document.name.split("/").at(-1);
    const name =
      document.fields?.displayName?.stringValue?.trim() || publicProfileNames.get(id)?.trim();
    if (!id || !hasPublicDisplayName(name)) return;

    ownersById.set(id, {
      id,
      name,
    });

    firestoreStrings(document.fields?.own).forEach((lockId) => {
      const owners = ownersByLock.get(lockId);
      if (!owners) return;
      owners.push(id);
    });
  });
}

const publicOwners = [...ownersById.values()].sort((a, b) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
);
const ownerIndexById = new Map(publicOwners.map((owner, index) => [owner.id, index]));
const ownerIndexesByLock = Object.fromEntries(
  [...ownersByLock.entries()]
    .filter(([, owners]) => owners.length)
    .map(([lockId, owners]) => [
      lockId,
      owners
        .map((id) => ownerIndexById.get(id))
        .filter((index) => index !== undefined)
        .sort((a, b) => a - b),
    ]),
);

const wishlistOwnersSource = `export type PublicLockOwner = {
  id: string;
  name: string;
};

export const wishlistOwnersUpdatedAt = ${JSON.stringify(refreshedOn)};
export const publicProfileCount = ${publicProfiles.length};
export const publicOwners: PublicLockOwner[] = ${JSON.stringify(publicOwners, null, 2)};
export const ownerIndexesByLock: Record<string, number[]> = ${JSON.stringify(ownerIndexesByLock, null, 2)};
`;

await writeFile(WISHLIST_OWNERS_FILE, wishlistOwnersSource);

console.log(
  `Refreshed ${selectedEntries.length} locks: ${ownedIds.length} owned, ` +
    `${wishlistIds.length} wishlist, ${pickedIds.length} picked; indexed ` +
    `${publicProfiles.length} public profiles for wishlist matching.`,
);
