"""IFP forecast MCP server (Python). Run with: py server.py"""

from __future__ import annotations

import copy
import json
import os
import urllib.request
from pathlib import Path
from typing import Any

from mcp.server.fastmcp import FastMCP

DEFAULT_API_URL = (
    "http://inventory-forecasting-prod-dplus.ava.prod.hulu.com/v1/inventory/forecast"
)
DEFAULT_SOURCE = "RYM Frequency Cap Test"
DEFAULT_TESTS_ROOT = Path(
    os.environ.get(
        "IFP_TESTS_ROOT",
        Path.home() / "projects" / "ifp-frequency-cap-tests",
    )
)
INCLUDE = "com.disney.digital.ads.rule.manager.common.Include"

mcp = FastMCP("ifp-forecast")


def api_url() -> str:
    return os.environ.get("IFP_API_URL", DEFAULT_API_URL)


def source_header() -> str:
    return os.environ.get("IFP_SOURCE_HEADER", DEFAULT_SOURCE)


def tests_root() -> Path:
    return Path(os.environ.get("IFP_TESTS_ROOT", str(DEFAULT_TESTS_ROOT)))


def load_json(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def get_term_list(body: dict[str, Any]) -> list[dict[str, Any]]:
    return body["targeting-detail"]["targeting-rules"][0]["definition"]["term-list"]


def apply_targeting_dimension(
    body: dict[str, Any],
    dimension: str,
    values: list[str],
) -> dict[str, Any]:
    payload = copy.deepcopy(body)
    term_list = get_term_list(payload)
    term_list[:] = [term for term in term_list if term.get("dimension") != dimension]
    term_list.append(
        {
            "not": False,
            "dimension": dimension,
            "sub-class": INCLUDE,
            "value-set": values,
        }
    )
    return payload


def apply_frequency_cap(body: dict[str, Any], cap: dict[str, Any]) -> dict[str, Any]:
    payload = copy.deepcopy(body)
    payload["frequency-cap-detail"]["frequency-caps"] = [cap]
    return payload


def prepare_request(
    base_request: dict[str, Any],
    cap: dict[str, Any] | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    dma: list[str] | None = None,
) -> dict[str, Any]:
    body = copy.deepcopy(base_request)
    if start_date:
        body["start-date"] = start_date
    if end_date:
        body["end-date"] = end_date
    if cap:
        body = apply_frequency_cap(body, cap)
    # IFP portal DMA uses API dimension "dma-code" with numeric codes, e.g. ["803"].
    if dma:
        body = apply_targeting_dimension(body, "dma-code", dma)
    return body


def post_forecast(body: dict[str, Any]) -> dict[str, Any]:
    request = urllib.request.Request(
        api_url(),
        data=json.dumps(body).encode("utf-8"),
        method="POST",
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Source": source_header(),
        },
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.loads(response.read().decode("utf-8"))


def compute_ratio(response: dict[str, Any]) -> float | None:
    summary = response.get("summary", {})
    capacity = summary.get("capacity")
    available = summary.get("available")
    if capacity in (None, 0) or available is None:
        return None
    return float(available) / float(capacity)


def run_cap_case(
    base_request: dict[str, Any],
    cap_case: dict[str, Any],
    default_tolerance: float,
    dma: list[str] | None = None,
) -> dict[str, Any]:
    body = prepare_request(base_request, cap=cap_case["frequency_cap"], dma=dma)
    response = post_forecast(body)
    ratio = compute_ratio(response)
    expected = cap_case.get("expected_avail_capacity_ratio")
    tolerance = float(cap_case.get("tolerance", default_tolerance))

    validation = "SKIP"
    if expected is not None and ratio is not None:
        validation = "PASS" if abs(ratio - float(expected)) <= tolerance else "FAIL"

    return {
        "case_id": cap_case.get("id"),
        "description": cap_case.get("description"),
        "frequency_cap": cap_case["frequency_cap"],
        "dma": dma,
        "capacity": response["summary"]["capacity"],
        "available": response["summary"]["available"],
        "ratio": None if ratio is None else round(ratio, 6),
        "expected_ratio": expected,
        "validation": validation,
    }


@mcp.tool()
def run_forecast(
    limit: int,
    duration: int,
    duration_unit: str,
    start_date: str | None = None,
    end_date: str | None = None,
    dma: list[str] | None = None,
) -> str:
    """Run a single IFP inventory forecast and return capacity, available, and ratio.

    Optional dma: DMA codes for API dimension "dma-code", e.g. ["803"]. Portal shows names; API uses numbers.
    """
    if duration_unit not in {"MINUTE", "HOUR", "DAY"}:
        raise ValueError("duration_unit must be MINUTE, HOUR, or DAY")

    base_request = load_json(tests_root() / "config" / "base-request.json")
    cap = {"limit": limit, "duration": duration, "duration-unit": duration_unit}
    body = prepare_request(
        base_request,
        cap=cap,
        start_date=start_date,
        end_date=end_date,
        dma=dma,
    )
    response = post_forecast(body)
    ratio = compute_ratio(response)

    return json.dumps(
        {
            "capacity": response["summary"]["capacity"],
            "available": response["summary"]["available"],
            "ratio": None if ratio is None else round(ratio, 6),
            "frequency_cap": cap,
            "start_date": body["start-date"],
            "end_date": body["end-date"],
            "dma": dma,
            "daily_details": response.get("daily-details", []),
        },
        indent=2,
    )


@mcp.tool()
def run_cap_test_matrix(case_id: str | None = None, dma: list[str] | None = None) -> str:
    """Run all frequency cap test cases from the reference file.

    Optional dma: DMA codes for API dimension "dma-code", e.g. ["803"].
    """
    base_request = load_json(tests_root() / "config" / "base-request.json")
    expectations = load_json(tests_root() / "reference" / "cap-ratio-expectations.json")
    default_tolerance = float(expectations.get("default_tolerance", 0.001))
    cases = expectations.get("cases", [])

    if case_id:
        cases = [case for case in cases if case.get("id") == case_id]
        if not cases:
            raise ValueError(f"No case found with id '{case_id}'")

    results = [run_cap_case(base_request, case, default_tolerance, dma=dma) for case in cases]
    return json.dumps(
        {
            "tests_root": str(tests_root()),
            "api_url": api_url(),
            "dma": dma,
            "results": results,
        },
        indent=2,
    )


@mcp.tool()
def validate_cap_test_matrix(case_id: str | None = None, dma: list[str] | None = None) -> str:
    """Run all configured cap cases and return PASS/FAIL/SKIP validation.

    Optional dma: DMA codes for API dimension "dma-code", e.g. ["803"].
    """
    payload = json.loads(run_cap_test_matrix(case_id, dma=dma))
    results = payload["results"]
    failures = sum(1 for item in results if item.get("validation") == "FAIL")
    passes = sum(1 for item in results if item.get("validation") == "PASS")
    skipped = sum(1 for item in results if item.get("validation") == "SKIP")

    return json.dumps(
        {
            "summary": {
                "total": len(results),
                "pass": passes,
                "fail": failures,
                "skip": skipped,
                "ok": failures == 0,
            },
            "results": results,
        },
        indent=2,
    )


@mcp.tool()
def ifp_server_info() -> str:
    """Show IFP MCP server configuration paths and endpoints."""
    return json.dumps(
        {
            "api_url": api_url(),
            "source_header": source_header(),
            "tests_root": str(tests_root()),
            "tools": [
                "run_forecast",
                "run_cap_test_matrix",
                "validate_cap_test_matrix",
            ],
            "optional_parameters": {
                "dma": "DMA codes (API dimension 'dma-code'), e.g. [\"803\"]. Portal shows names; DevTools shows codes.",
            },
        },
        indent=2,
    )


if __name__ == "__main__":
    mcp.run()
