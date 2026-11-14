import type { Poi } from "../types";
import { greatCircleM } from "./mars";

/**
 * Science Mission Selector.
 * Recommendations use ONLY fields from NASA's sample table (type, campaign, sol,
 * core length) and the rover localization used to estimate each position.
 * No minerals, ages or coordinates are added here.
 */

export interface ScienceMission {
  id: string;
  title: string;
  short: string;
  intro: string;
  learn: string;
  filter: (p: Poi) => boolean;
  /** one recommendation per campaign (for broad overviews) */
  onePerCampaign?: boolean;
}

const isSed = (p: Poi) => /sedimentary|carbonate/i.test(p.type ?? "");
const isIgn = (p: Poi) => /igneous/i.test(p.type ?? "");

export const MISSIONS: ScienceMission[] = [
  {
    id: "water",
    title: "Investigate evidence of ancient water",
    short: "Delta and lake-edge rocks",
    intro:
      "NASA chose Jezero because orbital images show an ancient river delta that flowed into a crater lake. Rocks laid down where that water slowed are the best places to look for its traces.",
    learn: "How long water was present, what the lake was like, and whether conditions could have supported microbial life.",
    filter: (p) => isSed(p) && /Delta Front|Margin|Upper Fan/i.test(p.campaign ?? ""),
    onePerCampaign: true,
  },
  {
    id: "sedimentary",
    title: "Study sedimentary rocks",
    short: "Rocks built from deposited grains",
    intro:
      "Sedimentary rocks form from grains carried and deposited by water or wind. On Earth, rocks like these can preserve chemical and physical traces of ancient environments.",
    learn: "Which environments deposited the layers, and whether they preserved any signs of past life.",
    filter: isSed,
  },
  {
    id: "igneous",
    title: "Study volcanic or igneous rocks",
    short: "Rocks formed from cooled molten rock",
    intro:
      "Igneous rocks crystallise from molten rock. Samples like these can be dated precisely in laboratories on Earth, which helps anchor the timeline of Jezero's history.",
    learn: "When the crater floor formed, and how it was later altered by water.",
    filter: isIgn,
  },
  {
    id: "history",
    title: "Explore Jezero Crater's geological history",
    short: "A tour across different rock units",
    intro:
      "Comparing rocks from different parts of the crater (crater floor, delta front, fan) helps scientists piece together the order of events in Jezero's past.",
    learn: "How the crater floor, the delta and the lake-edge deposits relate to each other in time.",
    filter: (p) => p.category === "sample" && p.type !== "Atmospheric",
    onePerCampaign: true,
  },
];

const CAMPAIGN_WHY: Record<string, string> = {
  "Delta Front": "Collected at the front of the ancient river delta, where water-carried sediment entered the crater.",
  "Upper Fan": "Collected higher up the fan-shaped delta deposits that NASA's Upper Fan campaign explored.",
  "Margin Unit": "Collected in the 'margin unit' along the crater's inner edge, which scientists have proposed may relate to the old lake shore (still debated).",
  "South Séítah": "Collected in Séítah, a crater-floor region of rocks NASA identified as igneous.",
  "Artuby Ridge": "Collected on Artuby Ridge on the crater floor, among rocks NASA identified as igneous.",
  "Polygon Valley": "Collected in Polygon Valley on the crater floor.",
};

export interface Recommendation {
  poi: Poi;
  distance_m: number;
  why: string;
  learn: string;
  data: string;
  uncertainty: string;
}

export function campaignWhy(p: Poi): string {
  const c = p.campaign ?? "";
  if (CAMPAIGN_WHY[c]) return CAMPAIGN_WHY[c];
  if (/Octavia|Ch'ał|Ch’ał/i.test(c)) return "Collected near the Octavia E. Butler landing site, on crater-floor rock NASA identified as igneous.";
  return `Collected during NASA's ${c} campaign.`;
}

export function recommend(missionId: string, pois: Poi[], from: { lon: number; lat: number } | null, limit = 5): Recommendation[] {
  const m = MISSIONS.find((x) => x.id === missionId);
  if (!m) return [];
  let list = pois
    .filter((p) => p.category === "sample" && m.filter(p))
    .map((p) => ({ p, d: from ? greatCircleM(from.lon, from.lat, p.lon, p.lat) : 0 }))
    .sort((a, b) => a.d - b.d || (a.p.number ?? 0) - (b.p.number ?? 0));
  // Several samples share one estimated position (same rover localization): keep the first.
  const seenPos = new Set<string>();
  list = list.filter(({ p }) => {
    const k = `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`;
    return seenPos.has(k) ? false : (seenPos.add(k), true);
  });
  if (m.onePerCampaign) {
    const seen = new Set<string>();
    list = list.filter(({ p }) => (seen.has(p.campaign ?? "") ? false : (seen.add(p.campaign ?? ""), true)));
  }
  return list.slice(0, limit).map(({ p, d }) => ({
    poi: p,
    distance_m: d,
    why: campaignWhy(p),
    learn: m.learn,
    data: `NASA sample #${p.number} "${p.name}": ${p.type}, sealed sol ${p.sol_sealed} (${p.date_sealed})${p.core_length_cm ? `, ${p.core_length_cm} cm core` : ""}.`,
    uncertainty:
      `Map position is estimated from the rover's NASA localization ${p.position_offset_sols ?? "?"} sols before sealing. ` +
      "The rock type comes from NASA's table; PAWPRINT has no mineral maps.",
  }));
}
