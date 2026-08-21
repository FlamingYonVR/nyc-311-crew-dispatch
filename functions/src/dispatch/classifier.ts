import {
  CAPABILITY_FOR_TYPE,
  Classification,
  IncidentType,
  Severity,
} from "./types";

/**
 * Incident classification interface.
 *
 * In Foundry, this is implemented by an AIP Logic function (the exact prompt
 * and output schema live in aip/classify_incident.md). For local development
 * and tests we use KeywordClassifier, a transparent rule-based stand-in, so
 * the vertical slice runs end-to-end without any LLM call.
 *
 * Everything downstream (priority, eligibility, ranking) only depends on the
 * Classification shape, so swapping the mock for AIP changes nothing else.
 */

export interface IncidentClassifier {
  classify(description: string): Classification;
}

interface Rule {
  type: IncidentType;
  keywords: string[];
}

/** Ordered: first matching rule wins, so more specific rules come first. */
const TYPE_RULES: Rule[] = [
  { type: "TRAFFIC_SIGNAL", keywords: ["traffic light", "traffic signal", "signal"] },
  { type: "FALLEN_TREE", keywords: ["tree", "limb", "branch"] },
  { type: "FLOODING", keywords: ["flood", "water", "drain"] },
  { type: "STREETLIGHT_OUT", keywords: ["streetlight", "street light", "light pole", "lamppost"] },
  { type: "POTHOLE", keywords: ["pothole", "pavement", "bottomed out"] },
  { type: "GRAFFITI", keywords: ["graffiti", "tag", "spray"] },
  { type: "SIDEWALK_HAZARD", keywords: ["sidewalk", "curb", "slab", "tripped"] },
  { type: "DAMAGED_SIGN", keywords: ["sign"] },
  { type: "ROAD_OBSTRUCTION", keywords: ["debris", "blocking", "obstruct", "in the road", "barriers"] },
];

const OBSTRUCTION_HINTS = ["blocking", "blocked", "lane", "swerv", "backing up", "in the road", "across"];
const SAFETY_HINTS = ["swerv", "sparks", "wires", "tripped", "stuck", "people inside",
  "running it", "blew tires", "stalled", "danger"];
const ESCALATION_HINTS = ["both lanes", "completely", "stuck", "people inside", "sparks",
  "wires", "six-way", "totally blocked"];

const DEFAULT_DURATION: Record<IncidentType, number> = {
  POTHOLE: 45, FALLEN_TREE: 90, STREETLIGHT_OUT: 30, TRAFFIC_SIGNAL: 60,
  GRAFFITI: 40, FLOODING: 120, SIDEWALK_HAZARD: 60, ROAD_OBSTRUCTION: 30,
  DAMAGED_SIGN: 25,
};

const BASE_SEVERITY: Record<IncidentType, Severity> = {
  POTHOLE: "MEDIUM", FALLEN_TREE: "HIGH", STREETLIGHT_OUT: "LOW",
  TRAFFIC_SIGNAL: "HIGH", GRAFFITI: "LOW", FLOODING: "HIGH",
  SIDEWALK_HAZARD: "MEDIUM", ROAD_OBSTRUCTION: "MEDIUM", DAMAGED_SIGN: "LOW",
};

const SEVERITY_ORDER: Severity[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

/**
 * Match at a word boundary so "streetlight" doesn't match "tree".
 * Keywords may be stems ("swerv") — the boundary is only at the start.
 */
function matchesKeyword(text: string, keyword: string): boolean {
  return new RegExp(`\\b${keyword}`).test(text);
}

function bumpSeverity(s: Severity, steps: number): Severity {
  const i = Math.min(SEVERITY_ORDER.indexOf(s) + steps, SEVERITY_ORDER.length - 1);
  return SEVERITY_ORDER[i];
}

export class KeywordClassifier implements IncidentClassifier {
  classify(description: string): Classification {
    const text = description.toLowerCase();

    const rule = TYPE_RULES.find((r) => r.keywords.some((k) => matchesKeyword(text, k)));
    const incidentType = rule ? rule.type : "ROAD_OBSTRUCTION";

    const roadObstruction = OBSTRUCTION_HINTS.some((h) => matchesKeyword(text, h));
    const safetyRisk = SAFETY_HINTS.some((h) => matchesKeyword(text, h));

    let severity = BASE_SEVERITY[incidentType];
    if (roadObstruction && safetyRisk) severity = bumpSeverity(severity, 1);
    if (ESCALATION_HINTS.some((h) => matchesKeyword(text, h))) severity = bumpSeverity(severity, 1);

    const firstSentence = description.split(/(?<=[.!?])\s/)[0];
    return {
      incidentType,
      severity,
      requiredCapability: CAPABILITY_FOR_TYPE[incidentType],
      roadObstruction,
      safetyRisk,
      estimatedDurationMinutes: DEFAULT_DURATION[incidentType],
      summary: firstSentence,
      reasoning:
        `[local mock — replaced by AIP Logic in Foundry] matched type ${incidentType}` +
        `${roadObstruction ? ", detected road obstruction" : ""}` +
        `${safetyRisk ? ", detected safety risk" : ""}.`,
    };
  }
}
