// CareMan API calls — all read-only (GET or POST used only to fetch data,
// never to mutate state).
//
// All endpoints were reverse-engineered from the minified Angular bundle at
// /main.*.js and verified via live browser network inspection.
// They are undocumented and may change with CareMan updates.

import { monthRange } from "./dates.js";

// ---------------------------------------------------------------------------
// Planungsgruppen
// ---------------------------------------------------------------------------

/**
 * Returns all planning groups the employee can see for the given month.
 *
 * Endpoint: POST /api/-/vacant-duties/possible-planninggroups
 * Body: [{ employeeId, from, to }]  ← array, one element per month
 * Response: [{ nameOfNull: "NULL", data: [{ name, id }] }]
 *
 * Note: Despite being a POST, this is a read-only query.
 * The array wrapper exists because the UI sends multiple months at once.
 */
export async function getPlanungsgruppen(session, year, month) {
  const { from, to } = monthRange(year, month);
  const result = await session.post(
    "/api/-/vacant-duties/possible-planninggroups",
    [{ employeeId: session.employeeId, from, to }]
  );
  // Flatten the array-of-month-results into a single deduplicated list
  const seen = new Set();
  const groups = [];
  for (const monthResult of result) {
    for (const group of monthResult.data ?? []) {
      if (!seen.has(group.id)) {
        seen.add(group.id);
        groups.push(group);
      }
    }
  }
  return groups; // [{ name, id }]
}

// ---------------------------------------------------------------------------
// Abteilungsdienstplan
// ---------------------------------------------------------------------------

/**
 * Returns the full team duty roster for one planning group and month.
 *
 * Endpoint: POST /api/-/team-duty/roster/{employeeId}
 * Body: { teamDuty: { idPlanninggroup, namePlanninggroup, from, to }, filterEmployee: 0 }
 *
 * Response shape:
 * {
 *   data: {
 *     from, to,
 *     vacantDutiesTemporaryPlan: boolean,
 *     data: [{                    ← one entry per employee
 *       item1: { id, name },
 *       item2: { data: [{         ← one entry per assigned day (sparse, not all days)
 *         day: { date, bankHolidayName, isSchoolHoliday },
 *         shortName               ← duty code, e.g. "H31T"
 *       }]}
 *     }],
 *     legendDuties: { ... },
 *     legendLeavePeriods: { ... }
 *   }
 * }
 */
export async function getAbteilungsdienstplan(
  session,
  year,
  month,
  planningGroupId,
  planningGroupName = ""
) {
  const { from, to } = monthRange(year, month);
  return session.post(`/api/-/team-duty/roster/${session.employeeId}`, {
    teamDuty: {
      idPlanninggroup: planningGroupId,
      namePlanninggroup: planningGroupName,
      from,
      to,
    },
    filterEmployee: 0,
  });
}

// ---------------------------------------------------------------------------
// Rosters preload — covers Einsatzwünsche, Vakante Dienste, Diensttausch
// ---------------------------------------------------------------------------

/**
 * Returns the personal roster preload for one month. This single call returns:
 *
 *   rosterUrlaubEinsatzwunsch  → personal calendar with Einsatzwünsche flags
 *   swapDutyOffersOffered      → Diensttausch offers from others (can accept)
 *   swapDutyOffersOwn          → own Diensttausch offers
 *   vacantDutiesOccupied       → vacant duties the employee has taken on
 *   vacantDutiesAssumed        → vacant duties assumed but not yet confirmed
 *   fehlzeiten                 → absences
 *
 * Endpoint: POST /api/-/rosters/preload
 * Body: [{ employeeId, begin, end, rosterViewMode: 2 }]
 *
 * Key fields in rosterUrlaubEinsatzwunsch.data.data[0].item2.data[]:
 *   day: { date, bankHolidayName, isSchoolHoliday }
 *   shortName            ← duty type label
 *   shortNameSollplan    ← concrete duty code e.g. "H31T"
 *   einsatzwunsch: bool  ← true = this day has a shift request
 *   prioritaet: bool
 *   beantragt: bool
 *   genehmigt: bool
 *   einsatzwunschWunsch: number
 *   kommentar: string
 *
 * swapDutyOffersOffered.data.offers[]:
 *   { id, date, offerer, acceptor, dutiesOfferer, dutiesAcceptor,
 *     workstationsOfferer, planninggroupsOfferer, state, comment, ... }
 *
 * vacantDutiesOccupied.data.duties[]:
 *   { idVacantDuty, atDate, nameWorkstation, duty, occupyUntil, state,
 *     comment, isAssumed, idPlanningGroup, namePlanningGroup, ... }
 */
export async function getRostersPreload(session, year, month) {
  const { from: begin, to: end } = monthRange(year, month);
  const result = await session.post("/api/-/rosters/preload", [
    {
      employeeId: session.employeeId,
      begin,
      end,
      rosterViewMode: 2,
    },
  ]);
  // API returns an array; we request one month so take first element
  return Array.isArray(result) ? result[0] : result;
}

// ---------------------------------------------------------------------------
// Vakante Dienste — detail view
// ---------------------------------------------------------------------------

/**
 * Returns full shift details for a single vacant duty entry.
 *
 * Endpoint: GET /api/-/vacant-duties/roster-details-id/{idVacantDuty}
 *
 * Response:
 * {
 *   day, from, to, employeeId,
 *   entries: [{
 *     shortName, nameWorkplace, shortNameWorkplace,
 *     nameShiftType, nameRole,
 *     from, to,          ← UTC timestamps
 *     stringDuration,    ← e.g. "12h00"
 *     genehmigungsebene
 *   }]
 * }
 */
export async function getVakanteDutyDetails(session, idVacantDuty) {
  return session.get(
    `/api/-/vacant-duties/roster-details-id/${idVacantDuty}`
  );
}
