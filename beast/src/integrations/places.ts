export const CATEGORIES = ["food", "housing", "healthcare", "childcare", "energy", "employment", "legal"] as const;
export type Category = (typeof CATEGORIES)[number];

export interface Resource {
  name: string;
  address: string;
  phone?: string;
  website?: string;
}

export type ResourceLocator = (near: string, category: Category) => Promise<Resource[]>;

const QUERY: Record<Category, string> = {
  food: "food pantry",
  housing: "housing assistance",
  healthcare: "community health clinic",
  childcare: "child care assistance",
  energy: "utility energy assistance",
  employment: "workforce development vocational rehabilitation",
  legal: "legal aid",
};

/** Calls Google Places (New) from the server so the Maps key never reaches a browser. Results cached briefly. */
export function createResourceLocator(apiKey: string, fetchFn: typeof fetch = fetch, ttlMs = 10 * 60_000, now: () => number = Date.now): ResourceLocator {
  if (!apiKey) throw new Error("GOOGLE_MAPS_API_KEY required");
  const cache = new Map<string, { at: number; value: Resource[] }>();
  return async (near, category) => {
    const key = `${category}|${near.toLowerCase()}`;
    const hit = cache.get(key);
    if (hit && now() - hit.at < ttlMs) return hit.value;
    const res = await fetchFn("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
        "x-goog-fieldmask": "places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri",
      },
      body: JSON.stringify({ textQuery: `${QUERY[category]} near ${near}`, maxResultCount: 10 }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Places error ${res.status}`);
    const body = (await res.json()) as {
      places?: { displayName?: { text?: string }; formattedAddress?: string; nationalPhoneNumber?: string; websiteUri?: string }[];
    };
    const value: Resource[] = (body.places ?? []).map((p) => ({
      name: p.displayName?.text ?? "",
      address: p.formattedAddress ?? "",
      ...(p.nationalPhoneNumber ? { phone: p.nationalPhoneNumber } : {}),
      ...(p.websiteUri ? { website: p.websiteUri } : {}),
    }));
    if (cache.size >= 500) cache.delete(cache.keys().next().value as string);
    cache.set(key, { at: now(), value });
    return value;
  };
}
