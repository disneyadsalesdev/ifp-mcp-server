import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
  applyFrequencyCap,
  computeRatio,
  getApiUrl,
  getSourceHeader,
  getTestsRoot,
  loadBaseRequest,
  loadExpectations,
  postForecast,
  runCapCase,
} from "./ifp-client.js";
import type { DurationUnit } from "./types.js";

const durationUnitSchema = z.enum(["MINUTE", "HOUR", "DAY"]);

const server = new McpServer({
  name: "ifp-forecast",
  version: "1.0.0",
});

server.tool(
  "run_forecast",
  "Run a single IFP inventory forecast with a frequency cap and return capacity, available, and ratio.",
  {
    limit: z.number().int().min(1).describe("Frequency cap limit"),
    duration: z.number().int().min(1).describe("Duration window"),
    duration_unit: durationUnitSchema.describe("MINUTE, HOUR, or DAY"),
    start_date: z.string().optional().describe("Start date YYYY-MM-DD (defaults from base-request.json)"),
    end_date: z.string().optional().describe("End date YYYY-MM-DD (defaults from base-request.json)"),
  },
  async ({ limit, duration, duration_unit, start_date, end_date }) => {
    try {
      const baseRequest = await loadBaseRequest();
      if (start_date) {
        baseRequest["start-date"] = start_date;
      }
      if (end_date) {
        baseRequest["end-date"] = end_date;
      }

      const body = applyFrequencyCap(baseRequest, {
        limit,
        duration,
        "duration-unit": duration_unit as DurationUnit,
      });
      const response = await postForecast(body);
      const ratio = computeRatio(response);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            capacity: response.summary.capacity,
            available: response.summary.available,
            ratio: ratio === null ? null : Number(ratio.toFixed(6)),
            frequency_cap: body["frequency-cap-detail"]["frequency-caps"][0],
            start_date: body["start-date"],
            end_date: body["end-date"],
          }, null, 2),
        }],
      };
    } catch (error) {
      return toolError(error);
    }
  },
);

server.tool(
  "run_cap_test_matrix",
  "Run all frequency cap test cases from reference/cap-ratio-expectations.json and return capacity, available, and ratio for each case.",
  {
    case_id: z.string().optional().describe("Optional case id to run a single test case"),
  },
  async ({ case_id }) => {
    try {
      const [baseRequest, expectations] = await Promise.all([
        loadBaseRequest(),
        loadExpectations(),
      ]);

      const defaultTolerance = expectations.default_tolerance ?? 0.001;
      let cases = expectations.cases;
      if (case_id) {
        cases = cases.filter((item) => item.id === case_id);
        if (cases.length === 0) {
          throw new Error(`No case found with id '${case_id}'`);
        }
      }

      const results = [];
      for (const capCase of cases) {
        results.push(await runCapCase(baseRequest, capCase, defaultTolerance));
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            tests_root: getTestsRoot(),
            api_url: getApiUrl(),
            results,
          }, null, 2),
        }],
      };
    } catch (error) {
      return toolError(error);
    }
  },
);

server.tool(
  "validate_cap_test_matrix",
  "Run all configured frequency cap cases and return PASS/FAIL/SKIP validation against expected ratios.",
  {
    case_id: z.string().optional().describe("Optional case id to validate a single test case"),
  },
  async ({ case_id }) => {
    try {
      const [baseRequest, expectations] = await Promise.all([
        loadBaseRequest(),
        loadExpectations(),
      ]);

      const defaultTolerance = expectations.default_tolerance ?? 0.001;
      let cases = expectations.cases;
      if (case_id) {
        cases = cases.filter((item) => item.id === case_id);
        if (cases.length === 0) {
          throw new Error(`No case found with id '${case_id}'`);
        }
      }

      const results = [];
      for (const capCase of cases) {
        results.push(await runCapCase(baseRequest, capCase, defaultTolerance));
      }

      const failures = results.filter((item) => item.validation === "FAIL").length;
      const passes = results.filter((item) => item.validation === "PASS").length;
      const skipped = results.filter((item) => item.validation === "SKIP").length;

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            summary: {
              total: results.length,
              pass: passes,
              fail: failures,
              skip: skipped,
              ok: failures === 0,
            },
            results,
          }, null, 2),
        }],
        isError: failures > 0,
      };
    } catch (error) {
      return toolError(error);
    }
  },
);

server.tool(
  "ifp_server_info",
  "Show IFP MCP server configuration paths and endpoints.",
  {},
  async () => {
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          api_url: getApiUrl(),
          source_header: getSourceHeader(),
          tests_root: getTestsRoot(),
          tools: ["run_forecast", "run_cap_test_matrix", "validate_cap_test_matrix"],
        }, null, 2),
      }],
    };
  },
);

function toolError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

const transport = new StdioServerTransport();
await server.connect(transport);
