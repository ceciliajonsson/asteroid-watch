// Jev (TypeSafe AI) decides how each close approach is presented in the watch room.
// API: POST https://api.typesafe.ai/v1/systemone  { state, model, questions }
import type { Asteroid } from "./neows";

const JEV_URL = "https://api.typesafe.ai/v1/systemone";

// Keep each question atomic; combine the answers in code (see decide()).
const QUESTIONS = {
  tier: {
    type: "choice",
    instructions:
      "How prominently should a public, general-audience asteroid watch room feature this close approach today?",
    criteria: {
      headline: "Genuinely remarkable: unusually close, unusually large, or otherwise newsworthy. Lead with it.",
      notable: "Interesting enough to highlight in the list, but not the lead story.",
      routine: "An ordinary pass. List it without emphasis.",
    },
  },
  wow: {
    type: "score",
    instructions: "How interesting would a curious non-expert find this approach?",
    // Check the API reference for the exact Score criteria shape if this is rejected.
    criteria: [
      "Not interesting: small and far away",
      "Mildly interesting",
      "Interesting: worth a look",
      "Very interesting: people will want to share it",
    ],
  },
  needs_context: {
    type: "noul",
    instructions:
      "Would a casual viewer be likely to misread this approach as dangerous unless it is explained?",
  },
} as const;

export interface JevAnswers {
  tier: { choice: "headline" | "notable" | "routine"; confidence: number; probabilities: Record<string, number> };
  wow: { score: number; confidence: number };
  needs_context: { noul: number };
}

function describe(a: Asteroid): string {
  const size = `${Math.round(a.diameterMinM)}–${Math.round(a.diameterMaxM)} m`;
  return [
    `Near-Earth asteroid ${a.name} makes its closest approach to Earth at ${a.approachAt} UTC.`,
    `Estimated diameter: ${size}.`,
    `Miss distance: ${a.missLd.toFixed(2)} lunar distances (${Math.round(a.missKm).toLocaleString("en-US")} km). The Moon orbits at 1 lunar distance.`,
    `Relative speed: ${a.velocityKps.toFixed(1)} km/s.`,
    `NASA potentially-hazardous classification: ${a.hazardous ? "yes" : "no"} (an orbital category, not an impact prediction).`,
    `On JPL Sentry impact-monitoring list: ${a.sentry ? "yes" : "no"}.`,
    `Absolute magnitude H: ${a.magnitude}.`,
  ].join("\n");
}

export async function askJev(apiKey: string, a: Asteroid): Promise<JevAnswers> {
  const res = await fetch(JEV_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "jev-latest", state: describe(a), questions: QUESTIONS }),
  });
  if (!res.ok) throw new Error(`Jev ${res.status}: ${await res.text()}`);
  const data = await res.json<{ answers: JevAnswers }>();
  return data.answers;
}

export type Status = "featured" | "listed" | "review";

// The decision layer: Jev answers, your code decides.
export function decide(ans: JevAnswers, threshold: number): Status {
  if (ans.tier.confidence < threshold) return "review";         // unsure → a human looks
  if (ans.tier.choice === "headline") return "featured";
  if (ans.tier.choice === "notable" && ans.wow.score >= 2) return "featured";
  return "listed";
}
