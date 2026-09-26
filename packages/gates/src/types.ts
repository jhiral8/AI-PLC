export type Severity = "error" | "warning";

export interface CheckResult {
  name: string;
  passed: boolean;
  message: string;
  actual?: number;
  threshold?: number;
  severity: Severity;
  /** Node IDs the check is about, so a UI can link to them. */
  subjects?: string[];
}
