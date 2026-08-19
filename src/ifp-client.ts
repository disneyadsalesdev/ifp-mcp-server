import { readFile } from "node:fs/promises";
import path from "node:path";

import type {
  CapCase,
  ExpectationsFile,
  ForecastRequest,
  ForecastResponse,
  FrequencyCap,
} from "./types.js";

const DEFAULT_API_URL =
  "http://inventory-forecasting-prod-dplus.ava.prod.hulu.com/v1/inventory/forecast";
const DEFAULT_SOURCE = "RYM Frequency Cap Test";
const DEFAULT_TESTS_ROOT = path.resolve(
  process.env.IFP_TESTS_ROOT ??
    path.join(process.env.USERPROFILE ?? "", "projects", "ifp-frequency-cap-tests"),
);

export function getApiUrl(): string {
  return process.env.IFP_API_URL ?? DEFAULT_API_URL;
}

export function getSourceHeader(): string {
  return process.env.IFP_SOURCE_HEADER ?? DEFAULT_SOURCE;
}

export function getTestsRoot(): string {
  return DEFAULT_TESTS_ROOT;
}

export async function loadBaseRequest(): Promise<ForecastRequest> {
  const filePath = path.join(getTestsRoot(), "config", "base-request.json");
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as ForecastRequest;
}

export async function loadExpectations(): Promise<ExpectationsFile> {
  const filePath = path.join(getTestsRoot(), "reference", "cap-ratio-expectations.json");
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as ExpectationsFile;
}

export function applyFrequencyCap(
  baseRequest: ForecastRequest,
  cap: FrequencyCap,
): ForecastRequest {
  return {
    ...baseRequest,
    "frequency-cap-detail": {
      ...baseRequest["frequency-cap-detail"],
      "frequency-caps": [cap],
    },
  };
}

export function computeRatio(response: ForecastResponse): number | null {
  const summary = response.summary;
  if (!summary || summary.capacity === 0) {
    return null;
  }
  return summary.available / summary.capacity;
}

export async function postForecast(body: ForecastRequest): Promise<ForecastResponse> {
  const response = await fetch(getApiUrl(), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Source: getSourceHeader(),
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`IFP API error ${response.status}: ${text}`);
  }

  return JSON.parse(text) as ForecastResponse;
}

export interface ForecastResult {
  case_id?: string;
  description?: string;
  frequency_cap: FrequencyCap;
  capacity: number;
  available: number;
  ratio: number | null;
  expected_ratio?: number | null;
  validation?: "PASS" | "FAIL" | "SKIP";
}

export async function runCapCase(
  baseRequest: ForecastRequest,
  capCase: CapCase,
  defaultTolerance: number,
): Promise<ForecastResult> {
  const body = applyFrequencyCap(baseRequest, capCase.frequency_cap);
  const response = await postForecast(body);
  const ratio = computeRatio(response);
  const expected = capCase.expected_avail_capacity_ratio ?? null;
  const tolerance = capCase.tolerance ?? defaultTolerance;

  let validation: ForecastResult["validation"] = "SKIP";
  if (expected !== null && ratio !== null) {
    validation = Math.abs(ratio - expected) <= tolerance ? "PASS" : "FAIL";
  }

  return {
    case_id: capCase.id,
    description: capCase.description,
    frequency_cap: capCase.frequency_cap,
    capacity: response.summary.capacity,
    available: response.summary.available,
    ratio: ratio === null ? null : Number(ratio.toFixed(6)),
    expected_ratio: expected,
    validation,
  };
}
