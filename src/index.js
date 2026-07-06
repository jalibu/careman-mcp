#!/usr/bin/env node
// CareMan MCP Server
// Read-only API facade for CareMan Dienstplan (opta data / SIEDA).
//
// Configuration via environment variables:
//   CAREMAN_URL       Base URL, e.g. https://careman.itc.drk.de:6100
//   CAREMAN_USERNAME  Login username
//   CAREMAN_PASSWORD  Login password
//
// Usage in claude_desktop_config.json:
//   {
//     "mcpServers": {
//       "careman": {
//         "command": "npx",
//         "args": ["-y", "@jalibu/careman-mcp@latest"],
//         "env": {
//           "CAREMAN_URL": "https://careman.mycompany.com",
//           "CAREMAN_USERNAME": "...",
//           "CAREMAN_PASSWORD": "..."
//         }
//       }
//     }
//   }

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { CareManSession } from "./session.js";
import {
  getPlanungsgruppen,
  getAbteilungsdienstplan,
  getRostersPreload,
  getVakanteDutyDetails,
} from "./api.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ok(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function err(message) {
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    isError: true,
  };
}

async function run(fn) {
  try {
    return ok(await fn());
  } catch (e) {
    return err(e.message);
  }
}

// ---------------------------------------------------------------------------
// Session (lazy singleton — reused across all tool calls)
// ---------------------------------------------------------------------------

let session = null;

function getSession() {
  if (!session) {
    session = new CareManSession({
      baseUrl: process.env.CAREMAN_URL,
      username: process.env.CAREMAN_USERNAME,
      password: process.env.CAREMAN_PASSWORD,
    });
  }
  return session;
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "careman",
  version: "1.0.0",
});

// ── Tool 1: Planungsgruppen ─────────────────────────────────────────────────

server.tool(
  "get_planungsgruppen",
  `Returns all planning groups (Planungsgruppen) visible to the logged-in employee
for the given month. Use this to discover available group IDs before calling
get_abteilungsdienstplan.

Returns: Array of { name: string, id: number }

Example IDs (may vary per installation):
  948 = RW 44 Haßloch
  949 = RW 51 Neustadt`,
  {
    year: z
      .number()
      .int()
      .min(2020)
      .max(2100)
      .describe("Year, e.g. 2026"),
    month: z
      .number()
      .int()
      .min(1)
      .max(12)
      .describe("Month (1–12)"),
  },
  ({ year, month }) => run(() => getPlanungsgruppen(getSession(), year, month))
);

// ── Tool 2: Abteilungsdienstplan ────────────────────────────────────────────

server.tool(
  "get_abteilungsdienstplan",
  `Returns the full team duty roster (Abteilungsdienstplan) for one planning group
and month. Contains every employee with their assigned duty codes per day.

Returns raw API data:
{
  data: {
    from, to,
    data: [{                         // one entry per employee
      item1: { id, name },           // employee info
      item2: { data: [{              // assigned days only (sparse)
        day: { date, bankHolidayName, isSchoolHoliday },
        shortName                    // duty code, e.g. "H31T"
      }]}
    }],
    legendDuties: { ... },           // duty code definitions with times
    legendLeavePeriods: { ... }
  }
}

Use get_planungsgruppen first to find the planningGroupId.`,
  {
    year: z
      .number()
      .int()
      .min(2020)
      .max(2100)
      .describe("Year, e.g. 2026"),
    month: z
      .number()
      .int()
      .min(1)
      .max(12)
      .describe("Month (1–12)"),
    planningGroupId: z
      .number()
      .int()
      .describe("Planning group ID (e.g. 948 for RW 44 Haßloch)"),
    planningGroupName: z
      .string()
      .optional()
      .describe("Optional: group name for clarity, e.g. 'RW 44 Haßloch'"),
  },
  ({ year, month, planningGroupId, planningGroupName }) =>
    run(() =>
      getAbteilungsdienstplan(
        getSession(),
        year,
        month,
        planningGroupId,
        planningGroupName
      )
    )
);

// ── Tool 3: Rosters preload ─────────────────────────────────────────────────

server.tool(
  "get_rosters_preload",
  `Returns the personal roster preload for one month. A single API call that covers
multiple areas: Einsatzwünsche, Vakante Dienste, and Diensttausch.

Returns raw API data with these top-level keys:
{
  rosterUrlaubEinsatzwunsch: {       // personal calendar + shift requests
    data: { data: [{
      item1: { name, id },           // employee (self)
      item2: { data: [{              // all days of the month (not sparse)
        day: { date, bankHolidayName, isSchoolHoliday },
        shortName,                   // duty type label
        shortNameSollplan,           // concrete duty code, e.g. "H31T"
        einsatzwunsch: boolean,      // true = shift request exists for this day
        prioritaet: boolean,
        beantragt: boolean,          // requested
        genehmigt: boolean,          // approved
        einsatzwunschWunsch: number, // wish priority level
        kommentar: string
      }]}
    }]}
  },

  swapDutyOffersOffered: {           // Diensttausch: offers from others (can accept)
    data: { offers: [{
      id, date, offerer, acceptor,
      dutiesOfferer: { data: [string] },
      dutiesAcceptor: { data: [string] },
      workstationsOfferer, planninggroupsOfferer,
      workstationsAcceptor, planninggroupsAcceptor,
      state, comment
    }]}
  },

  swapDutyOffersOwn: {               // Diensttausch: own offers
    data: { offers: [...] }
  },

  vacantDutiesOccupied: {            // Vakante Dienste: taken on by employee
    data: { duties: [{
      idVacantDuty, atDate,
      nameWorkstation, duty,
      occupyUntil, state,
      comment, isAssumed,
      idPlanningGroup, namePlanningGroup
    }],
    legendDuties: { ... } }
  },

  vacantDutiesAssumed: {             // Vakante Dienste: assumed but pending
    data: { duties: [...] }
  },

  fehlzeiten: { ... }                // absences
}`,
  {
    year: z
      .number()
      .int()
      .min(2020)
      .max(2100)
      .describe("Year, e.g. 2026"),
    month: z
      .number()
      .int()
      .min(1)
      .max(12)
      .describe("Month (1–12)"),
  },
  ({ year, month }) => run(() => getRostersPreload(getSession(), year, month))
);

// ── Tool 4: Vakante Dienst Details ─────────────────────────────────────────

server.tool(
  "get_vakante_duty_details",
  `Returns full shift details for a single vacant duty entry.

Use idVacantDuty from get_rosters_preload →
  vacantDutiesOccupied.data.duties[].idVacantDuty

Returns:
{
  day, from, to, employeeId,
  entries: [{
    shortName,          // duty code
    nameWorkplace,
    shortNameWorkplace,
    nameShiftType,
    nameRole,
    from, to,           // UTC shift start/end times
    stringDuration,     // e.g. "12h00"
    genehmigungsebene
  }]
}`,
  {
    idVacantDuty: z
      .number()
      .int()
      .describe("Vacant duty ID from vacantDutiesOccupied or vacantDutiesAssumed"),
  },
  ({ idVacantDuty }) =>
    run(() => getVakanteDutyDetails(getSession(), idVacantDuty))
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
