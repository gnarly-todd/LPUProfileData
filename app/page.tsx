"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  Belt,
  LockRecord,
  beltColors,
  beltOrder,
  locks as defaultLocks,
  profileSnapshotDate,
  progression,
  statusBenchmarks as communityStatusBenchmarks,
} from "./data";
import {
  ownerIndexesByLock,
  publicOwners,
  publicProfileCount,
  wishlistOwnersUpdatedAt,
} from "./wishlist-owners";

const SOURCE_URL = "https://lpubelts.com/#/profile/84dULJFIN4bHIC1LxCiuvBCSqT43?name=todd";
const HOSTED_SITE_ORIGIN = "https://todd-lock-analytics.nicelife70117.chatgpt.site";
const LPU_STATS_URL = "https://lpubelts.com/#/stats";
const LPU_STATS_SNAPSHOT = "September 2, 2026";
const DEFAULT_PROFILE_ID = "84dULJFIN4bHIC1LxCiuvBCSqT43";
const SAVED_PROFILES_KEY = "todd-lock-analytics-profiles-v1";
const ACTIVE_PROFILE_KEY = "todd-lock-analytics-active-profile-v1";
const DEFAULT_PROFILE_OVERRIDE_KEY = "todd-lock-analytics-default-profile-v1";
const rankedBelts = beltOrder.filter((belt) => belt !== "Unranked");
const displayBelts: Belt[] = ["Unranked", ...rankedBelts];
const beltScore = Object.fromEntries(
  beltOrder.map((belt, index) => [belt, belt === "Unranked" ? -1 : index]),
) as Record<Belt, number>;
const beltLevelScore = (beltLevel?: string) => {
  const level = beltLevel?.match(/(\d+)$/)?.[1];
  return level ? Number(level) : 0;
};
const MULTI_MECHANISM_FILTER = "Multi-mechanism";
const formatNewYorkSnapshot = (date = new Date()) => {
  const snapshotDate = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York",
  }).format(date);
  const snapshotTime = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone: "America/New_York",
  }).format(date);

  return `${snapshotDate} · ${snapshotTime}`;
};
const bluePlusBelts = new Set<Belt>(["Blue", "Purple", "Brown", "Red", "Black"]);
const redAndBlackBelts = new Set<Belt>(["Red", "Black"]);
const lpuCatalog = { ranked: 852, all: 964, unranked: 112 };
const lpuMemberBelts = [
  {
    platform: "Discord",
    counts: [411, 769, 1449, 721, 350, 164, 112, 77, 191],
  },
  {
    platform: "Reddit",
    counts: [1315, 2343, 3222, 1222, 417, 177, 106, 74, 152],
  },
];
type LoadedProfile = {
  id: string;
  name: string;
  url: string;
  locks: LockRecord[];
  refreshedAt: string;
};

type SavedProfile = Pick<LoadedProfile, "id" | "name" | "url"> & { isDefault: boolean };

const defaultProfile: LoadedProfile = {
  id: DEFAULT_PROFILE_ID,
  name: "Todd",
  url: SOURCE_URL,
  locks: defaultLocks,
  refreshedAt: profileSnapshotDate,
};

const builtInDefaultProfile: SavedProfile = {
  id: defaultProfile.id,
  name: defaultProfile.name,
  url: defaultProfile.url,
  isDefault: true,
};

function isStoredProfile(value: unknown): value is Omit<SavedProfile, "isDefault"> {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SavedProfile>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.url === "string" &&
    isValidLpuProfileUrl(candidate.url)
  );
}

const brandFamilies = [
  "ASSA",
  "ABUS",
  "Master Lock",
  "Ruko",
  "Mul-T-Lock",
  "Schlage",
  "GOAL",
  "Burg Wächter",
  "Yale",
  "Lockwood",
  "Chubb",
  "FAB",
];

function deriveProfile(profile: LoadedProfile) {
  const locks = profile.locks;
  const ownedLocks = locks.filter((lock) => lock.status === "Owned");
  const wishlistLocks = locks.filter((lock) => lock.status === "Wishlist");
  const ownedBluePlus = ownedLocks.filter((lock) => bluePlusBelts.has(lock.belt)).length;
  const ownedRedAndBlack = ownedLocks.filter((lock) => redAndBlackBelts.has(lock.belt)).length;
  const ownedMultiMechanism = ownedLocks.filter((lock) => lock.mechanisms.length > 1).length;
  const ownedPicked = ownedLocks.filter((lock) => lock.picked).length;
  const ownedRanked = ownedLocks.filter((lock) => lock.belt !== "Unranked").length;
  const wishlistBluePlus = wishlistLocks.filter((lock) => bluePlusBelts.has(lock.belt)).length;
  const beltCounts = Object.fromEntries(
    beltOrder.map((belt) => [belt, ownedLocks.filter((lock) => lock.belt === belt).length]),
  ) as Record<Belt, number>;
  const mechanismCounts = Object.entries(
    ownedLocks.reduce<Record<string, number>>((counts, lock) => {
      lock.mechanisms.forEach((mechanism) => {
        counts[mechanism] = (counts[mechanism] ?? 0) + 1;
      });
      return counts;
    }, {}),
  )
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  const brandCounts = brandFamilies
    .map((label) => ({
      label,
      value: ownedLocks.filter((lock) => lock.name.includes(label)).length,
    }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  const mechanisms = [...new Set(locks.flatMap((lock) => lock.mechanisms))].sort((a, b) =>
    a.localeCompare(b),
  );
  const ownedRankedScores = ownedLocks
    .filter((lock) => lock.belt !== "Unranked")
    .map((lock) => beltScore[lock.belt])
    .sort((a, b) => a - b);
  const ownedMedian =
    beltOrder[ownedRankedScores[Math.floor(ownedRankedScores.length / 2)]] || "Unranked";
  const percentOfOwned = (value: number) =>
    ownedLocks.length ? ((value / ownedLocks.length) * 100).toFixed(1) : "0.0";
  const pickedByBelt = displayBelts.map((belt) => ({
    belt,
    owned: ownedLocks.filter((lock) => lock.belt === belt).length,
    picked: ownedLocks.filter((lock) => lock.belt === belt && lock.picked).length,
  }));
  const statusBenchmarks = communityStatusBenchmarks.map((item) => ({
    ...item,
    user:
      item.label === "Owned"
        ? ownedLocks.length
        : item.label === "Picked"
          ? ownedPicked
          : item.label === "Wishlist"
            ? wishlistLocks.length
            : 0,
  }));

  return {
    profile,
    locks,
    ownedLocks,
    wishlistLocks,
    ownedBluePlus,
    ownedRedAndBlack,
    ownedMultiMechanism,
    ownedPicked,
    ownedRanked,
    wishlistBluePlus,
    beltCounts,
    mechanismCounts,
    brandCounts,
    mechanisms,
    ownedMedian,
    percentOfOwned,
    pickedByBelt,
    statusBenchmarks,
  };
}

type ProfileAnalytics = ReturnType<typeof deriveProfile>;
const ProfileContext = createContext<ProfileAnalytics>(deriveProfile(defaultProfile));
const useProfileAnalytics = () => useContext(ProfileContext);

function isValidLpuProfileUrl(value: string) {
  try {
    const url = new URL(value.trim());
    return (
      url.protocol === "https:" &&
      ["lpubelts.com", "www.lpubelts.com"].includes(url.hostname) &&
      /^#\/profile\/[A-Za-z0-9_-]{20,128}(?:\?.*)?$/.test(url.hash)
    );
  } catch {
    return false;
  }
}

async function fetchLpuProfile(profileUrl: string): Promise<LoadedProfile> {
  const apiOrigin = window.location.hostname.endsWith("github.io") ? HOSTED_SITE_ORIGIN : "";
  const response = await fetch(
    `${apiOrigin}/api/lpu-profile?url=${encodeURIComponent(profileUrl)}`,
    { headers: { Accept: "application/json" } },
  );
  const result = (await response.json().catch(() => null)) as {
    profile?: LoadedProfile;
    message?: string;
  } | null;

  if (!response.ok || !result?.profile) {
    throw new Error(result?.message || "That LPU profile could not be loaded.");
  }
  return result.profile;
}

const iconPaths: Record<string, React.ReactNode> = {
  chart: (
    <>
      <path d="M4 19V9m6 10V5m6 14v-7m4 7H2" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </>
  ),
  moon: <path d="M20 15.2A8.5 8.5 0 0 1 8.8 4a8.5 8.5 0 1 0 11.2 11.2Z" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  arrow: (
    <>
      <path d="M5 12h14" />
      <path d="m14 7 5 5-5 5" />
    </>
  ),
  external: (
    <>
      <path d="M14 4h6v6" />
      <path d="m10 14 10-10" />
      <path d="M20 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </>
  ),
  shuffle: (
    <>
      <path d="M3 7h3c5 0 6 10 11 10h4" />
      <path d="m18 14 3 3-3 3" />
      <path d="M3 17h3c1.7 0 2.8-1.1 3.8-2.6M14.2 9.6C15.2 8.1 16.3 7 18 7h3" />
      <path d="m18 4 3 3-3 3" />
    </>
  ),
  lock: (
    <>
      <rect x="4" y="10" width="16" height="11" rx="3" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      <path d="M12 15v2" />
    </>
  ),
  spark: (
    <>
      <path d="m12 3 1.7 4.3L18 9l-4.3 1.7L12 15l-1.7-4.3L6 9l4.3-1.7Z" />
      <path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8Z" />
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 11a8 8 0 1 0-2.3 5.7" />
      <path d="M20 4v7h-7" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  chevron: <path d="m7 10 5 5 5-5" />,
  check: <path d="m5 12 4 4L19 6" />,
  edit: (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" />
    </>
  ),
};

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {iconPaths[name]}
    </svg>
  );
}

function BeltPill({
  belt,
  label,
  compact = false,
}: {
  belt: Belt;
  label?: string;
  compact?: boolean;
}) {
  const beltLabel = label ? `${label} Belt` : belt === "Unranked" ? "Unranked" : `${belt} Belt`;

  return (
    <span
      className={`belt-pill ${compact ? "compact" : ""}`}
      style={{ "--belt": beltColors[belt] } as React.CSSProperties}
    >
      <i />
      {beltLabel}
    </span>
  );
}

function SectionHeading({
  eyebrow,
  title,
  copy,
}: {
  eyebrow: string;
  title: string;
  copy: string;
}) {
  return (
    <div className="section-heading">
      <p className="eyebrow">{eyebrow}</p>
      <h2>{title}</h2>
      <p>{copy}</p>
    </div>
  );
}

function MetricCard({
  label,
  value,
  detail,
  tone,
  icon,
}: {
  label: string;
  value: string;
  detail: string;
  tone: string;
  icon: string;
}) {
  return (
    <article className="metric-card" style={{ "--tone": tone } as React.CSSProperties}>
      <div className="metric-icon">
        <Icon name={icon} />
      </div>
      <p>{label}</p>
      <strong>{value}</strong>
      <span>{detail}</span>
    </article>
  );
}

function CollectionSnapshot() {
  const {
    ownedLocks,
    ownedBluePlus,
    ownedRedAndBlack,
    ownedMultiMechanism,
    ownedPicked,
    percentOfOwned,
  } = useProfileAnalytics();
  const rings = [
    {
      label: "Blue Belt & above",
      value: Number(percentOfOwned(ownedBluePlus)),
      color: "#6ee7f2",
      radius: 92,
    },
    {
      label: "Red & Black Belts",
      value: Number(percentOfOwned(ownedRedAndBlack)),
      color: "#e65d72",
      radius: 72,
    },
    {
      label: "Multi-mechanism",
      value: Number(percentOfOwned(ownedMultiMechanism)),
      color: "#a875f2",
      radius: 52,
    },
    { label: "Picked", value: Number(percentOfOwned(ownedPicked)), color: "#66e6a2", radius: 36 },
  ];

  return (
    <article className="profile-snapshot">
      <div className="snapshot-heading">
        <div>
          <p className="eyebrow">Owned collection</p>
          <h2>Depth at a glance</h2>
        </div>
        <span>{ownedLocks.length} owned</span>
      </div>
      <div className="snapshot-visual">
        <svg
          viewBox="0 0 240 240"
          role="img"
          aria-label={`Owned collection: Blue Belt or above ${percentOfOwned(ownedBluePlus)} percent, Red or Black Belt ${percentOfOwned(ownedRedAndBlack)} percent, multiple locking mechanisms ${percentOfOwned(ownedMultiMechanism)} percent, and picked ${percentOfOwned(ownedPicked)} percent`}
        >
          {rings.map((ring) => {
            const circumference = 2 * Math.PI * ring.radius;
            return (
              <g key={ring.label} transform="rotate(-90 120 120)">
                <circle cx="120" cy="120" r={ring.radius} className="snapshot-track" />
                <circle
                  cx="120"
                  cy="120"
                  r={ring.radius}
                  className="snapshot-ring"
                  stroke={ring.color}
                  strokeDasharray={`${(ring.value / 100) * circumference} ${circumference}`}
                />
              </g>
            );
          })}
          <circle cx="120" cy="120" r="26" className="snapshot-center" />
          <text x="120" y="116" textAnchor="middle" className="snapshot-total">
            {ownedLocks.length}
          </text>
          <text x="120" y="134" textAnchor="middle" className="snapshot-caption">
            LOCKS
          </text>
        </svg>
        <div className="snapshot-legend">
          {rings.map((ring) => (
            <div key={ring.label}>
              <i style={{ background: ring.color }} />
              <span>{ring.label}</span>
              <strong>{ring.value}%</strong>
            </div>
          ))}
        </div>
      </div>
      <p className="snapshot-note">
        Percentages use the {ownedLocks.length} owned locks as the base. Picked locks are a subset
        of owned.
      </p>
    </article>
  );
}

function BeltChart({ onSelect }: { onSelect: (belt: Belt) => void }) {
  const { beltCounts, ownedLocks, ownedBluePlus, percentOfOwned } = useProfileAnalytics();
  const ownedBase = Math.max(1, ownedLocks.length);
  let cursor = 0;
  const gradient = displayBelts
    .map((belt) => {
      const start = cursor;
      cursor += (beltCounts[belt] / ownedBase) * 100;
      return `${beltColors[belt]} ${start.toFixed(2)}% ${cursor.toFixed(2)}%`;
    })
    .join(", ");

  return (
    <article className="panel belt-panel">
      <div className="panel-title">
        <div>
          <p className="eyebrow">LPU belt rankings</p>
          <h3>Belt distribution</h3>
        </div>
        <span className="panel-badge">{ownedLocks.length} owned</span>
      </div>
      <div className="belt-chart-layout">
        <div
          className="donut"
          role="img"
          aria-label="Belt distribution donut chart"
          style={{ background: `conic-gradient(${gradient})` }}
        >
          <div>
            <strong>{percentOfOwned(ownedBluePlus)}%</strong>
            <span>Blue & above</span>
          </div>
        </div>
        <div className="belt-legend">
          {displayBelts.map((belt) => (
            <button
              className={belt === "Unranked" ? "unranked-row" : undefined}
              key={belt}
              onClick={() => onSelect(belt)}
            >
              <i style={{ background: beltColors[belt] }} />
              <span>{belt}</span>
              <strong>{beltCounts[belt]}</strong>
              <small>{((beltCounts[belt] / ownedBase) * 100).toFixed(1)}%</small>
            </button>
          ))}
        </div>
      </div>
      <div className="stacked-belt" aria-hidden="true">
        {displayBelts.map((belt) => (
          <span
            key={belt}
            style={{
              width: `${(beltCounts[belt] / ownedBase) * 100}%`,
              background: beltColors[belt],
            }}
          />
        ))}
      </div>
      <p className="chart-note">
        {percentOfOwned(ownedBluePlus)}% of this owned collection is ranked Blue Belt or above.
      </p>
    </article>
  );
}

function BenchmarkChart() {
  const { profile, statusBenchmarks } = useProfileAnalytics();
  const max = Math.max(
    1,
    ...statusBenchmarks.flatMap((item) => [item.user, item.average, item.topTen]),
  );
  const axisStep = max / 4;
  return (
    <article className="panel benchmark-panel">
      <div className="panel-title">
        <div>
          <p className="eyebrow">Profile comparison</p>
          <h3>Collection status</h3>
        </div>
        <span className="panel-badge">LPU profile data</span>
      </div>
      <div className="chart-legend-inline">
        <span>
          <i className="user" />
          {profile.name}
        </span>
        <span>
          <i className="average" />
          Community avg.
        </span>
        <span>
          <i className="top" />
          Top 10 avg.
        </span>
      </div>
      <div className="benchmark-chart">
        <div className="benchmark-axis">
          <span>{Math.round(max)}</span>
          <span>{Math.round(axisStep * 3)}</span>
          <span>{Math.round(axisStep * 2)}</span>
          <span>{Math.round(axisStep)}</span>
          <span>0</span>
        </div>
        {statusBenchmarks.map((item) => (
          <div className="benchmark-group" key={item.label}>
            <div className="benchmark-bars">
              {[
                ["user", item.user],
                ["average", item.average],
                ["top", item.topTen],
              ].map(([kind, value]) => (
                <div
                  className={`benchmark-bar ${kind}`}
                  key={kind}
                  style={{ height: `${(Number(value) / max) * 100}%` }}
                  title={`${item.label}: ${value}`}
                >
                  <span>{value}</span>
                </div>
              ))}
            </div>
            <strong>{item.label}</strong>
          </div>
        ))}
      </div>
      <p className="chart-note">
        Owned and Wishlist are separate in this profile; Picked overlaps the Owned group. Benchmark
        values are read from the profile comparison.
      </p>
    </article>
  );
}

function PickingProgressChart() {
  const { pickedByBelt, ownedPicked, ownedLocks, percentOfOwned, profile } = useProfileAnalytics();
  const maxOwned = Math.max(1, ...pickedByBelt.map((item) => item.owned));

  return (
    <article className="panel community-panel">
      <div className="panel-title">
        <div>
          <p className="eyebrow">Owned versus picked</p>
          <h3>Picking progress by lock rank</h3>
        </div>
        <span className="panel-badge">{ownedPicked} picked</span>
      </div>
      <div className="progress-legend" aria-hidden="true">
        <span>
          <i className="owned" />
          Owned
        </span>
        <span>
          <i className="picked" />
          Picked
        </span>
      </div>
      <div className="pick-progress-chart">
        {pickedByBelt.map((item) => (
          <div className="pick-progress-row" key={item.belt}>
            <span style={{ color: beltColors[item.belt] }}>{item.belt}</span>
            <div className="pick-progress-track">
              <i className="owned" style={{ width: `${(item.owned / maxOwned) * 100}%` }} />
              <i className="picked" style={{ width: `${(item.picked / maxOwned) * 100}%` }} />
            </div>
            <strong>
              {item.picked}/{item.owned}
            </strong>
            <small>{item.owned ? Math.round((item.picked / item.owned) * 100) : 0}%</small>
          </div>
        ))}
      </div>
      <p className="chart-note">
        Picked is a subset of owned. {profile.name} has marked {ownedPicked} of {ownedLocks.length}
        owned locks as picked ({percentOfOwned(ownedPicked)}%).
      </p>
    </article>
  );
}

function MemberBeltContext() {
  return (
    <article className="panel community-panel">
      <div className="panel-title">
        <div>
          <p className="eyebrow">Community belt records</p>
          <h3>Where Blue Belt sits</h3>
        </div>
        <BeltPill belt="Blue" label="Blue reference" />
      </div>
      <div className="member-context-list">
        {lpuMemberBelts.map((group) => {
          const total = group.counts.reduce((sum, value) => sum + value, 0);
          const bluePlus = group.counts.slice(4).reduce((sum, value) => sum + value, 0);
          return (
            <div className="member-context-row" key={group.platform}>
              <div>
                <strong>{group.platform}</strong>
                <span>{total.toLocaleString()} belt records</span>
              </div>
              <div className="member-stack" aria-label={`${group.platform} belt distribution`}>
                {rankedBelts.map((belt, index) => (
                  <i
                    key={belt}
                    style={{
                      width: `${(group.counts[index] / total) * 100}%`,
                      background: beltColors[belt],
                    }}
                    title={`${belt}: ${group.counts[index].toLocaleString()}`}
                  />
                ))}
              </div>
              <p>
                <strong>{((bluePlus / total) * 100).toFixed(1)}%</strong> are Blue Belt or above
              </p>
            </div>
          );
        })}
      </div>
      <div className="member-belt-key">
        {rankedBelts.map((belt) => (
          <span key={belt}>
            <i style={{ background: beltColors[belt] }} />
            {belt}
          </span>
        ))}
      </div>
      <p className="chart-note">
        Member belt records describe people; collection ranks describe locks. This is community
        context, not a direct measure of collection difficulty.
      </p>
    </article>
  );
}

function RankedBars({
  title,
  eyebrow,
  data,
  onSelect,
}: {
  title: string;
  eyebrow: string;
  data: { label: string; value: number }[];
  onSelect?: (value: string) => void;
}) {
  const max = Math.max(1, ...data.map((item) => item.value));
  return (
    <article className="panel ranked-panel">
      <div className="panel-title">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h3>{title}</h3>
        </div>
        <span className="panel-badge">Owned only</span>
      </div>
      <div className="ranked-bars">
        {data.map((item, index) => (
          <button key={item.label} onClick={() => onSelect?.(item.label)} disabled={!onSelect}>
            <span className="rank-number">{String(index + 1).padStart(2, "0")}</span>
            <span className="rank-label">{item.label}</span>
            <span className="rank-track">
              <i style={{ width: `${(item.value / max) * 100}%` }} />
            </span>
            <strong>{item.value}</strong>
          </button>
        ))}
      </div>
      <p className="chart-note">
        Counts use owned locks only. A lock with multiple mechanism labels can appear in more than
        one row.
      </p>
    </article>
  );
}

function Heatmap() {
  const { mechanismCounts, ownedLocks } = useProfileAnalytics();
  const rows = mechanismCounts.slice(0, 8).map((mechanism) => ({
    mechanism: mechanism.label,
    values: displayBelts.map(
      (belt) =>
        ownedLocks.filter((lock) => lock.belt === belt && lock.mechanisms.includes(mechanism.label))
          .length,
    ),
  }));
  const max = Math.max(1, ...rows.flatMap((row) => row.values));

  return (
    <article className="panel heatmap-panel">
      <div className="panel-title">
        <div>
          <p className="eyebrow">Collection coverage</p>
          <h3>Locking mechanism × belt rank</h3>
        </div>
        <span className="panel-badge">{ownedLocks.length} owned</span>
      </div>
      <div className="heatmap-scroll">
        <div
          className="heatmap"
          style={{ gridTemplateColumns: `145px repeat(${displayBelts.length}, minmax(64px, 1fr))` }}
        >
          <span />
          {displayBelts.map((belt) => (
            <strong key={belt} style={{ color: beltColors[belt] }}>
              {belt}
            </strong>
          ))}
          {rows.flatMap((row) => [
            <label key={`${row.mechanism}-label`}>{row.mechanism}</label>,
            ...row.values.map((value, index) => (
              <span
                className="heat-cell"
                key={`${row.mechanism}-${displayBelts[index]}`}
                title={`${row.mechanism} · ${displayBelts[index]}: ${value}`}
                style={
                  {
                    "--cell": beltColors[displayBelts[index]],
                    "--opacity": value === 0 ? 0.05 : 0.2 + (value / max) * 0.8,
                  } as React.CSSProperties
                }
              >
                {value || ""}
              </span>
            )),
          ])}
        </div>
      </div>
      <div className="heatmap-insight">
        <Icon name="spark" />
        <p>
          <strong>Pin-tumbler is the most common locking mechanism.</strong> Disc detainer is the
          next most common, while Sidepins are concentrated in the higher belt ranks.
        </p>
      </div>
    </article>
  );
}

function Timeline() {
  const dayDiff = (a: string, b: string) =>
    Math.round(
      (new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000,
    );
  return (
    <article className="panel timeline-panel">
      <div className="panel-title">
        <div>
          <p className="eyebrow">Scorecard</p>
          <h3>Belt progression</h3>
        </div>
        <BeltPill belt="Blue" />
      </div>
      <div className="timeline">
        {progression.map((item, index) => (
          <div className="timeline-step" key={item.belt}>
            <div
              className="timeline-node"
              style={{ "--belt": beltColors[item.belt] } as React.CSSProperties}
            >
              <span>
                <Icon name="lock" size={17} />
              </span>
            </div>
            <div className="timeline-copy">
              <strong>{item.belt} Belt</strong>
              <time>
                {new Date(`${item.date}T00:00:00Z`).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  timeZone: "UTC",
                })}
              </time>
              {index > 0 && <small>+{dayDiff(progression[index - 1].date, item.date)} days</small>}
            </div>
          </div>
        ))}
      </div>
      <div className="timeline-summary">
        <strong>259 days</strong>
        <span>Yellow → Blue</span>
        <i />
        <strong>1 day</strong>
        <span>Green → Blue</span>
      </div>
    </article>
  );
}

function InsightCard({
  index,
  title,
  copy,
  stat,
}: {
  index: string;
  title: string;
  copy: string;
  stat: string;
}) {
  return (
    <article className="insight-card">
      <span>{index}</span>
      <div>
        <p className="eyebrow">Key finding</p>
        <h3>{title}</h3>
        <p>{copy}</p>
      </div>
      <strong>{stat}</strong>
    </article>
  );
}

export default function Home() {
  const [activeProfile, setActiveProfile] = useState(defaultProfile);
  const [defaultFinderProfile, setDefaultFinderProfile] = useState(defaultProfile);
  const [defaultFinderReady, setDefaultFinderReady] = useState(false);
  const analytics = useMemo(() => deriveProfile(activeProfile), [activeProfile]);
  const {
    profile,
    locks,
    ownedLocks,
    wishlistLocks,
    ownedBluePlus,
    ownedRedAndBlack,
    ownedMultiMechanism,
    ownedPicked,
    ownedRanked,
    wishlistBluePlus,
    beltCounts,
    mechanismCounts,
    brandCounts,
    mechanisms,
    ownedMedian,
    percentOfOwned,
  } = analytics;
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"All" | "Owned" | "Wishlist">("Owned");
  const [belt, setBelt] = useState<"All" | Belt>("All");
  const [mechanism, setMechanism] = useState("All");
  const [sort, setSort] = useState("belt-desc");
  const [visible, setVisible] = useState(24);
  const [surprise, setSurprise] = useState<LockRecord | null>(null);
  const [challengeRequest, setChallengeRequest] = useState(0);
  const [copied, setCopied] = useState(false);
  const [refreshState, setRefreshState] = useState<"idle" | "loading" | "queued" | "error">("idle");
  const [refreshMessage, setRefreshMessage] = useState("");
  const [displayedSnapshotDate, setDisplayedSnapshotDate] = useState(profileSnapshotDate);
  const [savedProfiles, setSavedProfiles] = useState<SavedProfile[]>([builtInDefaultProfile]);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [addProfileOpen, setAddProfileOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<SavedProfile | null>(null);
  const [profileUrlInput, setProfileUrlInput] = useState("");
  const [profileError, setProfileError] = useState("");
  const [profileLoading, setProfileLoading] = useState(false);
  const challengeRef = useRef<HTMLElement>(null);
  const profileMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let defaultSaved = builtInDefaultProfile;
    let stored: Omit<SavedProfile, "isDefault">[] = [];
    try {
      const defaultOverride = JSON.parse(
        window.localStorage.getItem(DEFAULT_PROFILE_OVERRIDE_KEY) || "null",
      ) as unknown;
      if (isStoredProfile(defaultOverride)) defaultSaved = { ...defaultOverride, isDefault: true };

      const storedValue = JSON.parse(
        window.localStorage.getItem(SAVED_PROFILES_KEY) || "[]",
      ) as unknown;
      if (Array.isArray(storedValue)) stored = storedValue.filter(isStoredProfile);
    } catch {
      stored = [];
    }
    const profiles = [
      defaultSaved,
      ...stored
        .filter(
          (item, index) =>
            item.id !== defaultSaved.id &&
            stored.findIndex((other) => other.id === item.id) === index,
        )
        .map((item) => ({ ...item, isDefault: false })),
    ];
    setSavedProfiles(profiles);

    if (defaultSaved.id === DEFAULT_PROFILE_ID) {
      setDefaultFinderProfile(defaultProfile);
      setDefaultFinderReady(true);
    } else {
      let cachedDefault: LoadedProfile | null = null;
      try {
        cachedDefault = JSON.parse(
          window.sessionStorage.getItem(`lpu-profile-${defaultSaved.id}`) || "null",
        ) as LoadedProfile | null;
      } catch {
        cachedDefault = null;
      }

      if (cachedDefault?.id === defaultSaved.id && Array.isArray(cachedDefault.locks)) {
        setDefaultFinderProfile(cachedDefault);
        setDefaultFinderReady(true);
      } else {
        setDefaultFinderReady(false);
        void fetchLpuProfile(defaultSaved.url)
          .then((loaded) => {
            setDefaultFinderProfile(loaded);
            setDefaultFinderReady(true);
            window.sessionStorage.setItem(`lpu-profile-${loaded.id}`, JSON.stringify(loaded));
          })
          .catch(() => setDefaultFinderReady(false));
      }
    }

    const storedActiveId = window.localStorage.getItem(ACTIVE_PROFILE_KEY);
    const selected = profiles.find((item) => item.id === storedActiveId) || defaultSaved;
    window.localStorage.setItem(ACTIVE_PROFILE_KEY, selected.id);
    if (selected.id === DEFAULT_PROFILE_ID) return;

    try {
      const cached = JSON.parse(
        window.sessionStorage.getItem(`lpu-profile-${selected.id}`) || "null",
      ) as LoadedProfile | null;
      if (cached?.id === selected.id && Array.isArray(cached.locks)) {
        setActiveProfile(cached);
        setDisplayedSnapshotDate(cached.refreshedAt);
        return;
      }
    } catch {
      // A malformed cache should simply be replaced by the public profile response.
    }

    setProfileLoading(true);
    void fetchLpuProfile(selected.url)
      .then((loaded) => {
        setActiveProfile(loaded);
        setDisplayedSnapshotDate(loaded.refreshedAt);
        window.sessionStorage.setItem(`lpu-profile-${loaded.id}`, JSON.stringify(loaded));
      })
      .catch((error: unknown) => {
        setProfileError(
          error instanceof Error ? error.message : "This profile could not be loaded.",
        );
        window.localStorage.setItem(ACTIVE_PROFILE_KEY, DEFAULT_PROFILE_ID);
      })
      .finally(() => setProfileLoading(false));
  }, []);

  useEffect(() => {
    if (!profileMenuOpen) return;
    const closeMenu = (event: MouseEvent) => {
      if (!profileMenuRef.current?.contains(event.target as Node)) setProfileMenuOpen(false);
    };
    window.addEventListener("mousedown", closeMenu);
    return () => window.removeEventListener("mousedown", closeMenu);
  }, [profileMenuOpen]);

  useEffect(() => {
    if (!addProfileOpen) return;
    const closeModal = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAddProfileOpen(false);
    };
    window.addEventListener("keydown", closeModal);
    return () => window.removeEventListener("keydown", closeModal);
  }, [addProfileOpen]);

  useEffect(() => {
    if (!surprise || challengeRequest === 0) return;

    const frame = window.requestAnimationFrame(() => {
      challengeRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      challengeRef.current?.focus({ preventScroll: true });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [challengeRequest, surprise]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const refreshResult = url.searchParams.get("refresh");
    if (!refreshResult) return;

    const runId = url.searchParams.get("run_id");
    let pollTimer: number | undefined;
    let cancelled = false;

    if (refreshResult === "queued" && runId && /^\d+$/.test(runId)) {
      setRefreshState("queued");
      setRefreshMessage("Profile refresh is running. This page will reload when it finishes.");

      const checkRefresh = async () => {
        try {
          const statusUrl = `${HOSTED_SITE_ORIGIN}/api/refresh-status?run_id=${runId}`;
          const response = await fetch(statusUrl, { headers: { Accept: "application/json" } });
          const result = (await response.json()) as {
            status?: string;
            conclusion?: string | null;
          };

          if (!response.ok) throw new Error("Unable to check refresh status.");
          if (result.status === "completed") {
            if (result.conclusion === "success") {
              setRefreshMessage("Refresh complete. Reloading the updated collection…");
              setDisplayedSnapshotDate(formatNewYorkSnapshot());
              window.setTimeout(() => window.location.reload(), 1200);
            } else {
              setRefreshState("error");
              setRefreshMessage("The profile refresh workflow did not complete successfully.");
            }
            return;
          }

          if (!cancelled) pollTimer = window.setTimeout(checkRefresh, 3000);
        } catch {
          if (!cancelled) pollTimer = window.setTimeout(checkRefresh, 5000);
        }
      };

      void checkRefresh();
    } else {
      setRefreshState("error");
      setRefreshMessage(
        refreshResult === "forbidden"
          ? "This refresh control is limited to the site owner."
          : "GitHub could not queue the refresh workflow. Try again shortly.",
      );
    }
    url.searchParams.delete("refresh");
    url.searchParams.delete("run_id");
    url.searchParams.delete("destination");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);

    return () => {
      cancelled = true;
      if (pollTimer) window.clearTimeout(pollTimer);
    };
  }, []);

  const filteredLocks = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const filtered = locks.filter((lock) => {
      const matchesQuery =
        !normalized ||
        `${lock.name} ${lock.version ?? ""} ${lock.mechanisms.join(" ")}`
          .toLowerCase()
          .includes(normalized);
      const matchesBelt = belt === "All" || lock.belt === belt;
      const matchesMechanism =
        mechanism === "All" ||
        (mechanism === MULTI_MECHANISM_FILTER
          ? lock.mechanisms.length > 1
          : lock.mechanisms.includes(mechanism));
      const matchesStatus = status === "All" || lock.status === status;
      return matchesQuery && matchesBelt && matchesMechanism && matchesStatus;
    });
    return [...filtered].sort((a, b) => {
      if (sort === "belt-desc") {
        return (
          beltScore[b.belt] - beltScore[a.belt] ||
          beltLevelScore(b.beltLevel) - beltLevelScore(a.beltLevel) ||
          a.name.localeCompare(b.name)
        );
      }
      if (sort === "belt-asc") {
        return (
          beltScore[a.belt] - beltScore[b.belt] ||
          beltLevelScore(a.beltLevel) - beltLevelScore(b.beltLevel) ||
          a.name.localeCompare(b.name)
        );
      }
      if (sort === "name-desc") return b.name.localeCompare(a.name);
      return a.name.localeCompare(b.name);
    });
  }, [locks, query, status, belt, mechanism, sort]);

  const jumpToExplorer = () =>
    document.getElementById("explorer")?.scrollIntoView({ behavior: "smooth" });
  const selectBelt = (selected: Belt) => {
    setStatus("Owned");
    setBelt(selected);
    setVisible(24);
    requestAnimationFrame(jumpToExplorer);
  };
  const selectMechanism = (selected: string) => {
    setStatus("Owned");
    setMechanism(selected);
    setVisible(24);
    requestAnimationFrame(jumpToExplorer);
  };
  const chooseSurprise = () => {
    const candidates = ownedLocks.filter((lock) =>
      ["Purple", "Brown", "Red", "Black"].includes(lock.belt),
    );
    if (!candidates.length) return;
    setSurprise(candidates[Math.floor(Math.random() * candidates.length)]);
    setChallengeRequest((request) => request + 1);
  };
  const exportCsv = () => {
    const rows = [
      ["Name", "Version", "Collection", "Picked", "Belt", "Mechanisms"],
      ...filteredLocks.map((lock) => [
        lock.name,
        lock.version ?? "",
        lock.status,
        lock.picked ? "Yes" : "No",
        lock.beltLevel ?? lock.belt,
        lock.mechanisms.join(" + "),
      ]),
    ];
    const csv = rows
      .map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${profile.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-locks-filtered.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const copySummary = async () => {
    const summary = `${profile.name}'s LPU profile tracks ${locks.length} locks: ${ownedLocks.length} owned and ${wishlistLocks.length} wishlist. Of the owned locks, ${ownedBluePlus} are ranked Blue Belt or above (${percentOfOwned(ownedBluePlus)}%), ${ownedRedAndBlack} are ranked Red or Black Belt, and ${ownedMultiMechanism} have multiple locking-mechanism labels. The median owned lock rank is ${ownedMedian} Belt.`;
    await navigator.clipboard.writeText(summary);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };
  const refreshProfile = async () => {
    setProfileMenuOpen(false);
    setRefreshState("loading");
    if (profile.id !== DEFAULT_PROFILE_ID) {
      setRefreshMessage(`Refreshing ${profile.name} from LPU…`);
      try {
        const loaded = await fetchLpuProfile(profile.url);
        window.sessionStorage.setItem(`lpu-profile-${loaded.id}`, JSON.stringify(loaded));
        window.location.reload();
      } catch (error) {
        setRefreshState("error");
        setRefreshMessage(
          error instanceof Error ? error.message : "This profile could not be refreshed.",
        );
      }
      return;
    }

    setRefreshMessage("Queuing the GitHub profile refresh…");
    try {
      const apiOrigin = window.location.hostname.endsWith("github.io") ? HOSTED_SITE_ORIGIN : "";
      const response = await fetch(`${apiOrigin}/api/refresh-profile`, {
        method: "POST",
        headers: { Accept: "application/json" },
      });
      const result = (await response.json().catch(() => null)) as {
        runId?: number;
        message?: string;
      } | null;
      if (!response.ok || !Number.isSafeInteger(result?.runId)) {
        throw new Error(result?.message || "GitHub could not queue the profile refresh.");
      }
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.set("refresh", "queued");
      nextUrl.searchParams.set("run_id", String(result?.runId));
      window.location.assign(nextUrl.toString());
    } catch (error) {
      setRefreshState("error");
      setRefreshMessage(
        error instanceof Error ? error.message : "The profile refresh could not start.",
      );
    }
  };

  const selectProfile = (selected: SavedProfile) => {
    window.localStorage.setItem(ACTIVE_PROFILE_KEY, selected.id);
    setProfileMenuOpen(false);
    window.location.reload();
  };

  const saveAddedProfiles = (profiles: SavedProfile[]) => {
    window.localStorage.setItem(
      SAVED_PROFILES_KEY,
      JSON.stringify(
        profiles.filter((item) => !item.isDefault).map(({ id, name, url }) => ({ id, name, url })),
      ),
    );
  };

  const removeProfile = (removed: SavedProfile) => {
    if (removed.isDefault) return;

    const remaining = savedProfiles.filter((item) => item.id !== removed.id);
    setSavedProfiles(remaining);
    saveAddedProfiles(remaining);
    window.sessionStorage.removeItem(`lpu-profile-${removed.id}`);

    if (profile.id === removed.id) {
      const defaultSlot = remaining.find((item) => item.isDefault) || builtInDefaultProfile;
      window.localStorage.setItem(ACTIVE_PROFILE_KEY, defaultSlot.id);
      setProfileMenuOpen(false);
      window.location.reload();
    }
  };

  const openProfileEditor = (selected: SavedProfile | null) => {
    setProfileMenuOpen(false);
    setProfileError("");
    setEditingProfile(selected);
    setProfileUrlInput(selected?.url || "");
    setAddProfileOpen(true);
  };

  const saveProfile = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setProfileError("");
    if (!isValidLpuProfileUrl(profileUrlInput)) {
      setProfileError(
        "Enter a complete LPU profile link, such as https://lpubelts.com/#/profile/…?name=…",
      );
      return;
    }

    setProfileLoading(true);
    try {
      const loaded = await fetchLpuProfile(profileUrlInput);
      const conflict = savedProfiles.find(
        (item) => item.id === loaded.id && item.id !== editingProfile?.id,
      );
      if (conflict && editingProfile) {
        throw new Error(`${loaded.name} is already in the profile list.`);
      }

      const activeId = window.localStorage.getItem(ACTIVE_PROFILE_KEY);
      let nextProfiles: SavedProfile[];
      let nextActiveId: string;

      if (editingProfile) {
        const replacement: SavedProfile = {
          id: loaded.id,
          name: loaded.name,
          url: loaded.url,
          isDefault: editingProfile.isDefault,
        };
        nextProfiles = savedProfiles.map((item) =>
          item.id === editingProfile.id ? replacement : item,
        );
        nextActiveId = activeId === editingProfile.id ? loaded.id : activeId || nextProfiles[0].id;

        if (editingProfile.isDefault) {
          if (loaded.id === DEFAULT_PROFILE_ID) {
            window.localStorage.removeItem(DEFAULT_PROFILE_OVERRIDE_KEY);
          } else {
            window.localStorage.setItem(
              DEFAULT_PROFILE_OVERRIDE_KEY,
              JSON.stringify({ id: loaded.id, name: loaded.name, url: loaded.url }),
            );
          }
        }
        if (editingProfile.id !== loaded.id) {
          window.sessionStorage.removeItem(`lpu-profile-${editingProfile.id}`);
        }
      } else if (conflict) {
        nextProfiles = savedProfiles.map((item) =>
          item.id === loaded.id ? { ...item, name: loaded.name, url: loaded.url } : item,
        );
        nextActiveId = loaded.id;
      } else {
        nextProfiles = [
          ...savedProfiles,
          { id: loaded.id, name: loaded.name, url: loaded.url, isDefault: false },
        ];
        nextActiveId = loaded.id;
      }

      saveAddedProfiles(nextProfiles);
      window.localStorage.setItem(ACTIVE_PROFILE_KEY, nextActiveId);
      window.sessionStorage.setItem(`lpu-profile-${loaded.id}`, JSON.stringify(loaded));
      window.location.reload();
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : "This profile could not be saved.");
      setProfileLoading(false);
    }
  };

  const refreshInProgress = refreshState === "loading" || refreshState === "queued";
  const defaultWishlistOwnerRows = useMemo(
    () =>
      defaultFinderProfile.locks
        .filter((lock) => lock.status === "Wishlist")
        .map((lock) => ({
          lockId: lock.id,
          lockName: lock.name,
          belt: lock.belt,
          beltLevel: lock.beltLevel,
          owners: (ownerIndexesByLock[lock.id] ?? [])
            .map((ownerIndex) => publicOwners[ownerIndex])
            .filter(Boolean),
        })),
    [defaultFinderProfile],
  );

  return (
    <ProfileContext.Provider value={analytics}>
      <main className={`site-shell theme-${theme}`}>
        <nav className="site-nav" aria-label="Primary navigation">
          <a className="brand" href="#top">
            <span>
              <Icon name="lock" size={17} />
            </span>
            <strong>{profile.name} / LPU</strong>
            <small>Collection overview</small>
          </a>
          <div className="nav-links">
            <a href="#overview">Overview</a>
            <a href="#analysis">Analysis</a>
            <a href="#community">Community</a>
            <a href="#explorer">Explorer</a>
            <a href="#wishlist-finder">Wishlist finder</a>
          </div>
          <div className="nav-actions">
            <a className="source-link" href={profile.url} target="_blank" rel="noreferrer">
              Source <Icon name="external" size={15} />
            </a>
            <div className="profile-menu-wrap" ref={profileMenuRef}>
              <button
                className={`profile-button ${profileMenuOpen ? "active" : ""} ${refreshInProgress ? "refreshing" : ""}`}
                type="button"
                onClick={() => !refreshInProgress && setProfileMenuOpen((open) => !open)}
                disabled={refreshInProgress}
                aria-expanded={profileMenuOpen}
                aria-haspopup="menu"
                aria-label={
                  refreshInProgress ? "Profile refresh in progress" : `${profile.name} profile menu`
                }
              >
                <Icon name={refreshInProgress ? "refresh" : "user"} size={15} />
                <span>{refreshInProgress ? "Refreshing…" : profile.name}</span>
                {!refreshInProgress && <Icon name="chevron" size={14} />}
              </button>
              {profileMenuOpen && (
                <div className="profile-menu" role="menu">
                  <button
                    type="button"
                    onClick={() => void refreshProfile()}
                    disabled={refreshState === "loading" || refreshState === "queued"}
                    role="menuitem"
                  >
                    <Icon name="refresh" size={16} />
                    <span>
                      <strong>Refresh profile</strong>
                      <small>Load the latest LPU data</small>
                    </span>
                  </button>
                  <button type="button" onClick={() => openProfileEditor(null)} role="menuitem">
                    <Icon name="plus" size={16} />
                    <span>
                      <strong>Add profile</strong>
                      <small>Use a public LPU profile link</small>
                    </span>
                  </button>
                  <div className="profile-menu-label">Profiles on this device</div>
                  {savedProfiles.map((item) => (
                    <div className="saved-profile-row" key={item.id}>
                      <button
                        type="button"
                        className="saved-profile"
                        onClick={() => selectProfile(item)}
                        role="menuitemradio"
                        aria-checked={profile.id === item.id}
                      >
                        <Icon name="user" size={16} />
                        <span>
                          <strong>{item.name}</strong>
                          <small>{item.isDefault ? "Default profile" : "Public profile"}</small>
                        </span>
                        {profile.id === item.id && <Icon name="check" size={16} />}
                      </button>
                      <div className="profile-row-actions">
                        <button
                          type="button"
                          className="edit-profile"
                          onClick={() => openProfileEditor(item)}
                          role="menuitem"
                          aria-label={`Edit ${item.name} profile`}
                          title={`Edit ${item.name}`}
                        >
                          <Icon name="edit" size={14} />
                        </button>
                        {!item.isDefault && (
                          <button
                            type="button"
                            className="remove-profile"
                            onClick={() => removeProfile(item)}
                            role="menuitem"
                            aria-label={`Remove ${item.name} profile`}
                            title={`Remove ${item.name}`}
                          >
                            ×
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <button
              className="icon-button"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
            >
              <Icon name={theme === "dark" ? "sun" : "moon"} />
            </button>
            <span className="sr-only" role="status" aria-live="polite">
              {refreshMessage}
            </span>
          </div>
        </nav>

        {addProfileOpen && (
          <div
            className="profile-modal-backdrop"
            role="presentation"
            onMouseDown={() => setAddProfileOpen(false)}
          >
            <section
              className="profile-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="profile-editor-title"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <button
                className="modal-close"
                type="button"
                onClick={() => setAddProfileOpen(false)}
                aria-label="Close"
              >
                ×
              </button>
              <p className="eyebrow">Profile switcher</p>
              <h2 id="profile-editor-title">
                {editingProfile ? `Edit ${editingProfile.name}` : "Add an LPU profile"}
              </h2>
              <p>
                {editingProfile
                  ? "Replace this saved entry with another public lpubelts.com profile. The page reloads after the change."
                  : "Paste the complete public profile link from lpubelts.com. The profile stays saved in this browser."}
              </p>
              <form onSubmit={saveProfile} noValidate>
                <label htmlFor="profile-url">LPU profile link</label>
                <input
                  id="profile-url"
                  type="url"
                  value={profileUrlInput}
                  onChange={(event) => {
                    setProfileUrlInput(event.target.value);
                    setProfileError("");
                  }}
                  placeholder="https://lpubelts.com/#/profile/…?name=…"
                  autoFocus
                  aria-invalid={Boolean(profileError)}
                  aria-describedby={profileError ? "profile-error" : "profile-help"}
                />
                <small id="profile-help">
                  Only public lpubelts.com profile links are accepted.
                </small>
                {profileError && (
                  <p className="profile-error" id="profile-error" role="alert">
                    {profileError}
                  </p>
                )}
                <div className="modal-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setAddProfileOpen(false)}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="primary-button" disabled={profileLoading}>
                    {profileLoading
                      ? "Loading profile…"
                      : editingProfile
                        ? "Save profile"
                        : "Add and view profile"}
                  </button>
                </div>
              </form>
            </section>
          </div>
        )}

        {profileLoading && !addProfileOpen && (
          <div className="profile-loading" role="status">
            <Icon name="refresh" /> Loading the selected LPU profile…
          </div>
        )}

        <header className="hero" id="top">
          <div className="hero-copy">
            <div className="status-chip">
              <i /> Daily profile refresh · {displayedSnapshotDate}
            </div>
            <p className="eyebrow">Lock Pickers United collection profile</p>
            <h1>
              A collection built for <em>depth, range,</em> and the next challenge.
            </h1>
            <p className="hero-lede">
              A summary of {profile.name}’s LPU profile: {ownedLocks.length} owned locks analyzed,
              with {wishlistLocks.length} wishlist locks tracked separately.
            </p>
            <div className="hero-actions">
              <button className="primary-button" onClick={jumpToExplorer}>
                Explore owned locks <Icon name="arrow" />
              </button>
              <button
                className="secondary-button"
                onClick={chooseSurprise}
                aria-controls="challenge-result"
              >
                <Icon name="shuffle" /> Find a challenge
              </button>
            </div>
            <div className="hero-meta">
              <div>
                <span>Current belt</span>
                {profile.id === DEFAULT_PROFILE_ID ? (
                  <BeltPill belt="Blue" />
                ) : (
                  <strong>Not published</strong>
                )}
              </div>
              <div>
                <span>Owned median</span>
                <BeltPill belt={ownedMedian} />
              </div>
              <div>
                <span>Wishlist</span>
                <strong>
                  {wishlistLocks.length} <small>tracked separately</small>
                </strong>
              </div>
            </div>
          </div>
          <CollectionSnapshot />
        </header>

        {surprise && (
          <aside
            className="surprise-card"
            id="challenge-result"
            ref={challengeRef}
            tabIndex={-1}
            aria-live="polite"
          >
            <div className="surprise-icon">
              <Icon name="spark" />
            </div>
            <div>
              <p className="eyebrow">Owned challenge draw</p>
              <h3>{surprise.name}</h3>
              <p>{surprise.version || surprise.mechanisms.join(" + ")}</p>
            </div>
            <BeltPill belt={surprise.belt} label={surprise.beltLevel} />
            <button onClick={chooseSurprise}>
              <Icon name="shuffle" /> Draw again
            </button>
            <button
              className="surprise-close"
              onClick={() => setSurprise(null)}
              aria-label="Close challenge"
            >
              ×
            </button>
          </aside>
        )}

        <section className="section overview-section" id="overview">
          <SectionHeading
            eyebrow="At a glance"
            title="The owned collection, quantified"
            copy={`Core belt-rank and locking-mechanism counts use the ${ownedLocks.length} locks ${profile.name} owns. Wishlist locks remain visible as a separate planning list.`}
          />
          <div className="metric-grid">
            <MetricCard
              label="Owned locks"
              value={String(ownedLocks.length)}
              detail={`${wishlistLocks.length} more on wishlist`}
              tone="#6ee7f2"
              icon="lock"
            />
            <MetricCard
              label="Blue or higher"
              value={String(ownedBluePlus)}
              detail={`${percentOfOwned(ownedBluePlus)}% of owned locks`}
              tone="#6482ff"
              icon="chart"
            />
            <MetricCard
              label="Red & Black Belts"
              value={String(ownedRedAndBlack)}
              detail={`${percentOfOwned(ownedRedAndBlack)}% of owned locks`}
              tone="#e65d72"
              icon="spark"
            />
            <MetricCard
              label="Multi-mechanism locks"
              value={String(ownedMultiMechanism)}
              detail={`${percentOfOwned(ownedMultiMechanism)}% of owned locks`}
              tone="#a875f2"
              icon="shuffle"
            />
          </div>
          <div className="insight-strip">
            <div>
              <span className="insight-number">01</span>
              <p>
                <strong>Blue Belt median.</strong> {ownedBluePlus} owned locks are ranked Blue Belt
                or above, and the median owned rank is {ownedMedian} Belt.
              </p>
            </div>
            <div>
              <span className="insight-number">02</span>
              <p>
                <strong>Broad range of locking mechanisms.</strong> {mechanismCounts.length} labels
                cover Pin-tumbler, Disc detainer, Dimple, Slider, Sidepins, Lever, and more.
              </p>
            </div>
            <button onClick={copySummary}>
              <Icon name="copy" /> {copied ? "Copied" : "Copy summary"}
            </button>
          </div>
        </section>

        <section className="section" id="analysis">
          <SectionHeading
            eyebrow="Owned-only analysis"
            title="Owned locks by belt rank and locking mechanism"
            copy="Belt, locking-mechanism, manufacturer, and matrix charts exclude wishlist locks. The collection-status chart remains a profile-level comparison."
          />
          <div className="dashboard-grid">
            <BeltChart onSelect={selectBelt} />
            <BenchmarkChart />
            <RankedBars
              eyebrow="Lock designs"
              title="Locking mechanisms"
              data={mechanismCounts.slice(0, 8)}
              onSelect={selectMechanism}
            />
            <RankedBars
              eyebrow="Manufacturers"
              title="Most common manufacturers"
              data={brandCounts.slice(0, 8)}
            />
            <Heatmap />
            {profile.id === DEFAULT_PROFILE_ID ? (
              <Timeline />
            ) : (
              <article className="panel timeline-panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Picker progression</p>
                    <h3>Belt-award timeline</h3>
                  </div>
                </div>
                <p className="profile-data-note">
                  The public LPU profile feed does not expose belt-award dates for this profile.
                </p>
              </article>
            )}
          </div>
        </section>

        <section className="section community-section" id="community">
          <SectionHeading
            eyebrow="LPU community context"
            title="Collection depth and picking progress in context"
            copy={`${profile.name}’s owned and picked counts are compared with the public LPU Stats dashboard. Member belt distributions are shown separately because a picker’s belt and a lock’s rank measure different things.`}
          />
          <div className="community-metrics">
            <article className="community-metric">
              <span>Ranked catalog coverage</span>
              <strong>{((ownedRanked / lpuCatalog.ranked) * 100).toFixed(1)}%</strong>
              <p>
                {ownedRanked} owned ranked entries out of {lpuCatalog.ranked} ranked LPU locks
              </p>
            </article>
            <article className="community-metric">
              <span>Owned versus average</span>
              <strong>{(ownedLocks.length / 14).toFixed(1)}×</strong>
              <p>{ownedLocks.length} owned compared with the LPU collection average of 14</p>
            </article>
            <article className="community-metric">
              <span>Picked versus average</span>
              <strong>{(ownedPicked / 11).toFixed(1)}×</strong>
              <p>{ownedPicked} picked, matching the LPU collection average of 11</p>
            </article>
            <article className="community-metric">
              <span>Wishlist versus average</span>
              <strong>{(wishlistLocks.length / 8).toFixed(1)}×</strong>
              <p>{wishlistLocks.length} wishlist entries compared with the LPU average of 8</p>
            </article>
          </div>
          <div className="community-grid">
            <PickingProgressChart />
            <MemberBeltContext />
          </div>
          <div className="community-source-note">
            <p>
              LPU catalog snapshot: {lpuCatalog.all} total locks, including {lpuCatalog.ranked}{" "}
              ranked and {lpuCatalog.unranked} unranked. Community figures viewed{" "}
              {LPU_STATS_SNAPSHOT}.
            </p>
            <a href={LPU_STATS_URL} target="_blank" rel="noreferrer">
              Open LPU Stats <Icon name="external" size={15} />
            </a>
          </div>
        </section>

        <section className="section findings-section">
          <SectionHeading
            eyebrow="Interpretation"
            title="What the owned data says"
            copy="The owned collection is concentrated at Blue Belt and above, while the separate wishlist includes even more higher-ranked locks."
          />
          <div className="findings-grid">
            <InsightCard
              index="01"
              title="Higher-ranked owned locks"
              copy={`${ownedBluePlus} owned locks are ranked Blue Belt or above, including ${beltCounts.Black} Black Belt locks.`}
              stat={`${ownedBluePlus} locks`}
            />
            <InsightCard
              index="02"
              title="Pin-tumbler foundation"
              copy={`${mechanismCounts[0]?.label ?? "No locking mechanism"} is the most common locking-mechanism label in the owned collection.`}
              stat={`${mechanismCounts[0]?.value ?? 0} locks`}
            />
            <InsightCard
              index="03"
              title="Higher-ranked wishlist locks"
              copy={`${wishlistBluePlus} of ${wishlistLocks.length} wishlist locks are ranked Blue Belt or above.`}
              stat={`${wishlistBluePlus} locks`}
            />
          </div>
        </section>

        <section className="section explorer-section" id="explorer">
          <div className="explorer-heading">
            <SectionHeading
              eyebrow="Interactive explorer"
              title="Browse owned and wishlist locks"
              copy="Choose owned, wishlist, or all locks, then filter by belt rank, locking mechanism, or keyword."
            />
            <button className="export-button" onClick={exportCsv}>
              <Icon name="download" /> Export filtered CSV
            </button>
          </div>

          <div className="collection-tabs" aria-label="Collection status">
            {(
              [
                ["Owned", `Owned ${ownedLocks.length}`],
                ["Wishlist", `Wishlist ${wishlistLocks.length}`],
                ["All", `All ${locks.length}`],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                className={status === value ? "active" : ""}
                aria-pressed={status === value}
                onClick={() => {
                  setStatus(value);
                  setVisible(24);
                }}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="belt-filters" aria-label="Filter by LPU belt rank">
            <button
              className={belt === "All" ? "active all-belts" : "all-belts"}
              aria-pressed={belt === "All"}
              onClick={() => {
                setBelt("All");
                setVisible(24);
              }}
            >
              {status === "All" ? "All locks" : `All ${status.toLowerCase()}`}
            </button>
            {displayBelts.map((item) => (
              <button
                key={item}
                className={`belt-filter-button ${belt === item ? "active" : ""}`}
                style={{ "--belt": beltColors[item] } as React.CSSProperties}
                aria-pressed={belt === item}
                onClick={() => {
                  setBelt(item);
                  setVisible(24);
                }}
              >
                <i />
                {item === "Unranked" ? item : `${item} Belt`}
              </button>
            ))}
          </div>

          <div className="filter-bar">
            <label className="search-field">
              <Icon name="search" />
              <input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setVisible(24);
                }}
                placeholder="Search model, version, or mechanism…"
              />
              <span>{filteredLocks.length} results</span>
            </label>
            <label>
              <span>Belt</span>
              <select
                value={belt}
                onChange={(event) => {
                  setBelt(event.target.value as "All" | Belt);
                  setVisible(24);
                }}
              >
                <option>All</option>
                {displayBelts.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Mechanism</span>
              <select
                value={mechanism}
                onChange={(event) => {
                  setMechanism(event.target.value);
                  setVisible(24);
                }}
              >
                <option>All</option>
                <option value={MULTI_MECHANISM_FILTER}>{MULTI_MECHANISM_FILTER}</option>
                {mechanisms.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Sort</span>
              <select value={sort} onChange={(event) => setSort(event.target.value)}>
                <option value="belt-desc">Belt: high to low</option>
                <option value="belt-asc">Belt: low to high</option>
                <option value="name">Name: A–Z</option>
                <option value="name-desc">Name: Z–A</option>
              </select>
            </label>
          </div>

          <div className="collection-shell">
            <div className="collection-summary">
              <div>
                <span>{status === "All" ? "Current view" : `${status} collection`}</span>
                <strong>{filteredLocks.length} matching locks</strong>
              </div>
              <p>
                Cards are ordered by{" "}
                {sort === "name" || sort === "name-desc"
                  ? `name, ${sort === "name-desc" ? "Z–A" : "A–Z"}`
                  : `belt, ${sort === "belt-desc" ? "highest first" : "lowest first"}`}
                .
              </p>
            </div>
            <div className="lock-grid">
              {filteredLocks.slice(0, visible).map((lock, index) => (
                <article
                  className="lock-card"
                  key={`${lock.name}-${lock.version}-${index}`}
                  style={{ "--belt": beltColors[lock.belt] } as React.CSSProperties}
                >
                  <span
                    className={`belt-rail ${lock.belt === "Black" ? "black-level" : ""}`}
                    aria-hidden="true"
                  >
                    {lock.belt === "Black" &&
                      Array.from({ length: beltLevelScore(lock.beltLevel) }, (_, stripe) => (
                        <i className="black-level-stripe" key={stripe} />
                      ))}
                  </span>
                  <div className="lock-card-topline">
                    <span className="lock-index">{String(index + 1).padStart(3, "0")}</span>
                    <div className="lock-classification">
                      <span className={`collection-badge ${lock.status.toLowerCase()}`}>
                        {lock.status}
                      </span>
                      {lock.picked && <span className="picked-badge">Picked</span>}
                    </div>
                  </div>
                  <div className="lock-name">
                    <h3>{lock.name}</h3>
                    {lock.version && <p>{lock.version}</p>}
                  </div>
                  <div className="mechanism-tags">
                    {lock.mechanisms.map((item) => (
                      <button key={item} onClick={() => selectMechanism(item)}>
                        {item}
                      </button>
                    ))}
                  </div>
                  <div className="lock-card-footer">
                    <span>Belt rank</span>
                    <BeltPill belt={lock.belt} label={lock.beltLevel} compact />
                  </div>
                </article>
              ))}
              {filteredLocks.length === 0 && (
                <div className="empty-state">
                  <Icon name="search" size={28} />
                  <h3>No locks match those filters</h3>
                  <p>Try a broader keyword or reset one of the collection views.</p>
                  <button
                    onClick={() => {
                      setQuery("");
                      setStatus("Owned");
                      setBelt("All");
                      setMechanism("All");
                    }}
                  >
                    Reset filters
                  </button>
                </div>
              )}
            </div>
            {visible < filteredLocks.length && (
              <button className="load-more" onClick={() => setVisible((count) => count + 24)}>
                Show 24 more <span>{filteredLocks.length - visible} remaining</span>
              </button>
            )}
          </div>
        </section>

        <section className="section wishlist-finder-section" id="wishlist-finder">
          <SectionHeading
            eyebrow="Public-profile exchange finder"
            title={`Who owns ${defaultFinderProfile.name}’s wishlist locks?`}
            copy={`All ${defaultWishlistOwnerRows.length} locks on the default profile’s wishlist are checked against ${publicProfileCount.toLocaleString()} publicly indexed LPU profiles. Changing a non-default profile does not change this finder.`}
          />
          <div className="wishlist-finder-meta">
            <span>
              <Icon name="refresh" size={15} /> Updated {wishlistOwnersUpdatedAt}
            </span>
            <span>Default profile: {defaultFinderProfile.name}</span>
            <span>Anonymous profiles are excluded</span>
          </div>
          <div className="wishlist-table-shell">
            <table className="wishlist-table">
              <thead>
                <tr>
                  <th>Wishlist lock</th>
                  <th>Belt rank</th>
                  <th>Public owners</th>
                </tr>
              </thead>
              <tbody>
                {(defaultFinderReady ? [...defaultWishlistOwnerRows] : [])
                  .sort(
                    (a, b) =>
                      beltScore[b.belt] - beltScore[a.belt] ||
                      beltLevelScore(b.beltLevel) - beltLevelScore(a.beltLevel) ||
                      a.lockName.localeCompare(b.lockName),
                  )
                  .map((row) => (
                    <tr key={row.lockId}>
                      <td>
                        <strong>{row.lockName}</strong>
                      </td>
                      <td>
                        <BeltPill belt={row.belt} label={row.beltLevel} compact />
                      </td>
                      <td>
                        {row.owners.length ? (
                          <details>
                            <summary>
                              {row.owners.length.toLocaleString()} public{" "}
                              {row.owners.length === 1 ? "profile" : "profiles"}
                            </summary>
                            <div className="owner-links">
                              {row.owners.map((owner) => (
                                <a
                                  key={owner.id}
                                  href={`https://lpubelts.com/#/profile/${owner.id}?name=${encodeURIComponent(owner.name)}`}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {owner.name}
                                  <Icon name="external" size={13} />
                                </a>
                              ))}
                            </div>
                          </details>
                        ) : (
                          <span className="no-owner-match">No public matches</span>
                        )}
                      </td>
                    </tr>
                  ))}
                {!defaultFinderReady && (
                  <tr>
                    <td colSpan={3} className="wishlist-pending">
                      Loading the default profile’s wishlist…
                    </td>
                  </tr>
                )}
                {defaultFinderReady && !defaultWishlistOwnerRows.length && (
                  <tr>
                    <td colSpan={3} className="wishlist-pending">
                      The default profile has no wishlist locks.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="wishlist-method-note">
            Matches reflect public LPU profile data at the update time above. Ownership can change,
            and a match is not an offer to sell or trade.
          </p>
        </section>

        <footer>
          <div className="footer-brand">
            <span>
              <Icon name="lock" />
            </span>
            <div>
              <strong>{profile.name}’s Lock Collection</strong>
              <small>Independent visual analysis</small>
            </div>
          </div>
          <p>
            Data reflects the public LPU profile snapshot refreshed {displayedSnapshotDate}.
            Analysis uses owned locks unless labeled otherwise; wishlist entries remain separate in
            the explorer.
          </p>
          <a href={profile.url} target="_blank" rel="noreferrer">
            Open original profile <Icon name="external" size={15} />
          </a>
        </footer>
      </main>
    </ProfileContext.Provider>
  );
}
