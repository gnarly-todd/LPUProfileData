import type { Belt, LockRecord } from "../../data";

const GITHUB_PAGES_ORIGIN = "https://gnarly-todd.github.io";
const LPU_HOME = "https://lpubelts.com/";
const LPU_DATA =
  "https://raw.githubusercontent.com/Lockpickers-United/lpu-belt-explorer/main/src/data/data.json";
const PROFILE_ID_PATTERN = /^[A-Za-z0-9_-]{20,128}$/;
const BELTS = new Set<Belt>([
  "White",
  "Yellow",
  "Orange",
  "Green",
  "Blue",
  "Purple",
  "Brown",
  "Red",
  "Black",
  "Unranked",
]);

type LpuEntry = {
  id: string;
  belt: string;
  version?: string;
  lockingMechanisms?: string[];
  makeModels: { make?: string; model?: string }[];
};

type FirestoreField = {
  arrayValue?: { values?: { stringValue?: string }[] };
  booleanValue?: boolean;
  stringValue?: string;
};

let apiKeyPromise: Promise<string> | undefined;
let catalogPromise: Promise<LpuEntry[]> | undefined;

const corsHeaders = (origin: string | null) =>
  origin === GITHUB_PAGES_ORIGIN
    ? { "Access-Control-Allow-Origin": GITHUB_PAGES_ORIGIN, Vary: "Origin" }
    : {};

const json = (body: Record<string, unknown>, status: number, origin: string | null) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...corsHeaders(origin) },
  });

async function getText(url: string) {
  const response = await fetch(url, {
    headers: { "User-Agent": "todd-lock-analytics-profile-loader" },
  });
  if (!response.ok) throw new Error(`LPU request failed (${response.status}).`);
  return response.text();
}

async function getApiKey() {
  apiKeyPromise ??= (async () => {
    const home = await getText(LPU_HOME);
    const assetPath = home.match(/assets\/index-[A-Za-z0-9_-]+\.js/)?.[0];
    if (!assetPath) throw new Error("Could not locate the current LPU application asset.");
    const application = await getText(new URL(assetPath, LPU_HOME).toString());
    const apiKey = application.match(/AIza[0-9A-Za-z_-]{30,}/)?.[0];
    if (!apiKey) throw new Error("Could not locate the public LPU profile service.");
    return apiKey;
  })();
  return apiKeyPromise;
}

async function getCatalog() {
  catalogPromise ??= fetch(LPU_DATA, {
    headers: { "User-Agent": "todd-lock-analytics-profile-loader" },
  }).then(async (response) => {
    if (!response.ok) throw new Error(`LPU catalog request failed (${response.status}).`);
    return (await response.json()) as LpuEntry[];
  });
  return catalogPromise;
}

function firestoreStrings(field?: FirestoreField): string[] {
  return (field?.arrayValue?.values?.map((value) => value.stringValue).filter(Boolean) ??
    []) as string[];
}

function lockName(entry: LpuEntry) {
  return entry.makeModels
    .map(({ make, model }) => [make, model].filter(Boolean).join(" ").trim())
    .filter(Boolean)
    .join(" / ");
}

function normalizeBelt(sourceBelt: string): { belt: Belt; beltLevel?: LockRecord["beltLevel"] } {
  if (/^Black [1-5]$/.test(sourceBelt)) {
    return { belt: "Black", beltLevel: sourceBelt as LockRecord["beltLevel"] };
  }
  return { belt: BELTS.has(sourceBelt as Belt) ? (sourceBelt as Belt) : "Unranked" };
}

function parseProfileUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }

  if (url.protocol !== "https:" || !["lpubelts.com", "www.lpubelts.com"].includes(url.hostname)) {
    return null;
  }

  const match = url.hash.match(/^#\/profile\/([A-Za-z0-9_-]+)(?:\?(.*))?$/);
  if (!match || !PROFILE_ID_PATTERN.test(match[1])) return null;

  const hashParams = new URLSearchParams(match[2] || "");
  return { id: match[1], suppliedName: hashParams.get("name")?.trim() || null };
}

function newYorkTimestamp() {
  const date = new Date();
  const day = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York",
  }).format(date);
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone: "America/New_York",
  }).format(date);
  return `${day} · ${time}`;
}

export function OPTIONS(request: Request) {
  const origin = request.headers.get("origin");
  return new Response(null, {
    status: origin === GITHUB_PAGES_ORIGIN ? 204 : 403,
    headers: {
      ...corsHeaders(origin),
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Accept",
      "Access-Control-Max-Age": "86400",
    },
  });
}

export async function GET(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== GITHUB_PAGES_ORIGIN && origin !== new URL(request.url).origin) {
    return json({ message: "Origin not allowed." }, 403, origin);
  }

  const profileUrl = new URL(request.url).searchParams.get("url");
  const parsed = profileUrl ? parseProfileUrl(profileUrl) : null;
  if (!profileUrl || !parsed) {
    return json(
      { message: "Enter a full LPU profile link, such as https://lpubelts.com/#/profile/…" },
      400,
      origin,
    );
  }

  try {
    const [apiKey, catalog] = await Promise.all([getApiKey(), getCatalog()]);
    const profileResponse = await fetch(
      `https://firestore.googleapis.com/v1/projects/lpu-belt-explorer/databases/(default)/documents/lockcollections/${parsed.id}?key=${apiKey}`,
      { headers: { "User-Agent": "todd-lock-analytics-profile-loader" } },
    );

    if (profileResponse.status === 404) {
      return json({ message: "That LPU profile does not exist or is not public." }, 404, origin);
    }
    if (!profileResponse.ok)
      throw new Error(`LPU profile request failed (${profileResponse.status}).`);

    const profile = (await profileResponse.json()) as {
      fields?: Record<string, FirestoreField>;
    };
    const ownedIds = firestoreStrings(profile.fields?.own);
    const wishlistIds = firestoreStrings(profile.fields?.wishlist);
    const pickedIds = new Set(firestoreStrings(profile.fields?.picked));
    const ownedSet = new Set(ownedIds);
    const selectedIds = new Set([...ownedIds, ...wishlistIds]);
    const selectedEntries = catalog.filter((entry) => selectedIds.has(entry.id));

    if (selectedEntries.length !== selectedIds.size) {
      return json(
        { message: "The profile references locks missing from the current LPU catalog." },
        409,
        origin,
      );
    }

    const locks: LockRecord[] = selectedEntries.map((entry) => {
      const normalized = normalizeBelt(entry.belt);
      return {
        id: entry.id,
        name: lockName(entry),
        ...(entry.version ? { version: entry.version } : {}),
        mechanisms: entry.lockingMechanisms ?? [],
        ...normalized,
        status: ownedSet.has(entry.id) ? "Owned" : "Wishlist",
        picked: pickedIds.has(entry.id),
      };
    });
    const anonymous = profile.fields?.privacyAnonymous?.booleanValue === true;
    const storedName = profile.fields?.displayName?.stringValue?.trim();
    const displayName = anonymous
      ? "Anonymous LPU profile"
      : storedName || parsed.suppliedName || "LPU profile";
    const canonicalUrl = `https://lpubelts.com/#/profile/${parsed.id}?name=${encodeURIComponent(displayName)}`;

    return json(
      {
        profile: {
          id: parsed.id,
          name: displayName,
          url: canonicalUrl,
          locks,
          refreshedAt: newYorkTimestamp(),
        },
      },
      200,
      origin,
    );
  } catch (error) {
    console.error("LPU profile loading failed", error);
    apiKeyPromise = undefined;
    return json({ message: "LPU profile data is temporarily unavailable." }, 502, origin);
  }
}
