export type DurationUnit = "MINUTE" | "HOUR" | "DAY";

export interface FrequencyCap {
  limit: number;
  duration: number;
  "duration-unit": DurationUnit;
}

export interface ForecastRequest {
  "start-date": string;
  "end-date": string;
  "ad-products": string[];
  "frequency-cap-detail": {
    "frequency-caps": FrequencyCap[];
    tier: string;
  };
  "targeting-detail": Record<string, unknown>;
}

export interface ForecastSummary {
  capacity: number;
  available: number;
  "start-date"?: string;
  "end-date"?: string;
}

export interface ForecastResponse {
  summary: ForecastSummary;
  [key: string]: unknown;
}

export interface CapCase {
  id: string;
  description?: string;
  frequency_cap: FrequencyCap;
  expected_avail_capacity_ratio?: number | null;
  tolerance?: number;
}

export interface ExpectationsFile {
  default_tolerance?: number;
  cases: CapCase[];
}
