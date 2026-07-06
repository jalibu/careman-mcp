# @jalibu/careman-mcp

Read-only MCP server for [CareMan Dienstplan](https://www.optadata-gruppe.de/) (opta data / SIEDA).  
Exposes the CareMan REST API as MCP tools so LLMs can query duty rosters, shift requests, vacant duties, and shift swaps.

---

> **⚠️ Disclaimer**
>
> This is an **unofficial, community-developed** MCP server. It is **not** affiliated with, endorsed by, or in any way connected to CareMan or any other company behind the CareMan product. All product and company names are trademarks of their respective owners.
>
> **Use at your own risk.** This project reverse-engineers an undocumented private API. It may break at any time without notice. The author accepts no liability for any damage, data loss, account suspension, or other consequences arising from its use.
>
> **Data privacy warning.** CareMan contains sensitive personal and operational data (duty rosters, employee information, etc.). Whenever you use an MCP client that connects to a cloud-hosted AI model (e.g. Claude Desktop → Anthropic, ChatGPT, Gemini, …), **your CareMan data will be transmitted to and processed on the AI provider's servers.** This is likely incompatible with your organisation's data protection obligations (GDPR / DSGVO). The only way to keep data under your full control is to use a **locally running, self-hosted AI model** (e.g. [Open WebUI](https://openwebui.com/) + [Ollama](https://ollama.com/)). You are solely responsible for compliance with applicable data protection laws.

---

## Setup

### Open WebUI + Ollama ✅ Recommended (privacy-friendly)

[Open WebUI](https://openwebui.com/) with a locally running [Ollama](https://ollama.com/) model keeps all data on your own machine — nothing is sent to external servers.

**Prerequisites:** Open WebUI and Ollama must already be running locally.

1. In Open WebUI, go to **Settings → Tools → MCP Servers** (or **Admin Panel → Settings → Tools**).
2. Add a new MCP server entry:
   - **Name:** `careman`
   - **Command:** `npx`
   - **Args:** `-y @jalibu/careman-mcp@latest`
   - **Environment variables:**
     ```
     CAREMAN_URL=https://careman.mycompany.com
     CAREMAN_USERNAME=your-username
     CAREMAN_PASSWORD=your-password
     ```
3. Save and reload. The CareMan tools are now available in your local chat.

> Supported Ollama models with good tool-calling ability: `qwen2.5:14b`, `llama3.1:8b`, `mistral-nemo`.

---

### Claude Desktop ⚠️ Cloud — data leaves your network

> **Privacy notice:** Claude Desktop sends your conversations — including all data returned by CareMan — to **Anthropic's cloud servers** for inference. Only use this setup if you have reviewed and accepted the implications for your organisation's data protection policy.

Add to `claude_desktop_config.json` (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "careman": {
      "command": "npx",
      "args": ["-y", "@jalibu/careman-mcp@latest"],
      "env": {
        "CAREMAN_URL": "https://careman.mycompany.com",
        "CAREMAN_USERNAME": "your-username",
        "CAREMAN_PASSWORD": "your-password"
      }
    }
  }
}
```

Restart Claude Desktop. The tools become available immediately.

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `CAREMAN_URL` | ✓ | Base URL of your CareMan instance |
| `CAREMAN_USERNAME` | ✓ | Your CareMan login name |
| `CAREMAN_PASSWORD` | ✓ | Your CareMan password |

## Tools

### `get_planungsgruppen`
Lists all planning groups available for a given month.  
Call this first to discover group IDs for `get_abteilungsdienstplan`.

```
get_planungsgruppen(year, month)
→ [{ name: "Group A", id: 100 }, { name: "Group B", id: 101 }, ...]
```

### `get_abteilungsdienstplan`
Returns the full team duty roster for one planning group and month — every employee with their assigned duty codes per day.

```
get_abteilungsdienstplan(year, month, planningGroupId, planningGroupName?)
→ { data: { data: [{ item1: { name, id }, item2: { data: [...] } }], legendDuties, ... } }
```

Each day entry in `item2.data`:
- `day.date` — UTC timestamp of local Berlin midnight
- `day.bankHolidayName` — non-empty string if public holiday
- `shortName` — duty code, e.g. `"H31T"`, `"H31N"`, `"H51T"`

Days without an assignment are omitted (sparse array).

### `get_rosters_preload`
Returns personal roster data for one month — covers three areas in a single API call:

**Einsatzwünsche** (shift requests) — in `rosterUrlaubEinsatzwunsch.data.data[0].item2.data[]`:
- `einsatzwunsch: true` flags days with a shift request
- `shortNameSollplan` — requested duty code
- `genehmigt / beantragt` — approval status

**Vakante Dienste** (vacant duties) — in `vacantDutiesOccupied.data.duties[]` and `vacantDutiesAssumed.data.duties[]`:
- `idVacantDuty` — use with `get_vakante_duty_details`
- `duty`, `nameWorkstation`, `atDate`, `state`, `comment`

**Diensttausch** (shift swaps) — in `swapDutyOffersOffered.data.offers[]` (incoming) and `swapDutyOffersOwn.data.offers[]` (own):
- `offerer`, `acceptor`, `dutiesOfferer`, `dutiesAcceptor`
- `workstationsOfferer`, `planninggroupsOfferer`
- `state`, `comment`

```
get_rosters_preload(year, month)
→ { rosterUrlaubEinsatzwunsch, swapDutyOffersOffered, swapDutyOffersOwn,
    vacantDutiesOccupied, vacantDutiesAssumed, fehlzeiten }
```

### `get_vakante_duty_details`
Returns full shift details for a single vacant duty entry.

```
get_vakante_duty_details(idVacantDuty)
→ { entries: [{ shortName, nameWorkplace, from, to, stringDuration, ... }] }
```

## Architecture

```
   LLM
    │  MCP (stdio)
    ▼
CareMan MCP Server
    ├─ Session Manager  (auto-login, token cache, employeeId)
    ├─ get_planungsgruppen        → POST /api/-/vacant-duties/possible-planninggroups
    ├─ get_abteilungsdienstplan   → POST /api/-/team-duty/roster/{employeeId}
    ├─ get_rosters_preload        → POST /api/-/rosters/preload
    └─ get_vakante_duty_details   → GET  /api/-/vacant-duties/roster-details-id/{id}
```

## Notes

**Undocumented API.** All endpoints were reverse-engineered from the minified CareMan JavaScript bundle and verified via browser network inspection. They may change with CareMan updates. If a tool starts returning errors after a CareMan upgrade, compare the request/response format in browser DevTools against the code in `src/api.js`.

**Login format.** The login request body uses `{ item1: username, item2: password }` — a generic tuple wrapper pattern used throughout the CareMan codebase. If login fails, verify this against a live browser login via DevTools → Network → `POST /api/-/auth/login`.

**Token lifetime.** JWTs expire after roughly 8 hours. The server tracks expiry and re-logs in automatically.

**Read-only.** No tool submits, modifies, or deletes data. POST requests are used only where the API requires them for data retrieval (a common pattern in this codebase).
