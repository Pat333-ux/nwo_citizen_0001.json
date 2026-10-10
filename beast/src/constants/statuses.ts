export const GENESIS_HASH = "BEAST_GENESIS_2026";

export const APPLICATION_STATUSES = [
  "draft",
  "submitted",
  "in_review",
  "approved",
  "denied",
  "appealed",
] as const;

export const ALLOWED_TRANSITIONS: Record<string, readonly string[]> = {
  draft: ["submitted"],
  submitted: ["in_review"],
  in_review: ["approved", "denied"],
  approved: [],
  denied: ["appealed"],
  appealed: ["in_review"],
};
