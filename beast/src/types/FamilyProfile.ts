export type ApplicationStatus =
  | "draft"
  | "submitted"
  | "in_review"
  | "approved"
  | "denied"
  | "appealed";

export interface FamilyProfile {
  familyId: string;
  adults: number;
  children: number;
  monthlyIncome: number;
  veteranStatus: boolean;
  disabilityStatus: boolean;
  housingStatus: string;
  status: ApplicationStatus;
}
