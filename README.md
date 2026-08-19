# IFP Forecast MCP Server

Python MCP server so **Cursor** can run IFP inventory forecasts from chat.

## Files you need

| File | Purpose |
|------|---------|
| `server.py` | MCP server (Cursor starts this) |
| `requirements.txt` | Python dependency (`mcp`) |

## Install (once per machine)

**Windows**

```powershell
py -m pip install -r requirements.txt
```

**Mac**

```bash
python3 -m pip install -r requirements.txt
```

## Cursor config

Add to `~/.cursor/mcp.json` — copy from **`ifp-frequency-cap-tests/docs/templates/mcp.json`** (Windows) or **`mcp.mac.json`** (Mac).

Also clone **`ifp-frequency-cap-tests`** and set `IFP_TESTS_ROOT` to that folder path.

## Clone

```bash
git clone https://github.com/disneyadsalesdev/ifp-mcp-server.git
```
