# WME CA Government Boundaries

Adds interactive boundary overlays to the [Waze Map Editor](https://www.waze.com/editor) for Canadian federal, provincial, and local administrative areas.

**Authors:** JS55CT
**License:** GNU GPLv3
**Data Source:** [Statistics Canada — Digital and Cartographic Boundary Files (2021)](https://www12.statcan.gc.ca/census-recensement/2021/geo/sip-pis/boundary-limites/index2021-eng.cfm?year=21)

---

## What It Shows

| Layer | Data Source | Default Color | Appears At Zoom |
|---|---|---|---|
| Provinces / Territories | StatCan Digital Boundary Files | Blue `#0000ff` | All zooms |
| Census Divisions | StatCan Digital Boundary Files | Salmon `#ff8c69` | Zoom ≥ 8 (configurable) |
| Census Subdivisions | StatCan Digital Boundary Files | Green `#00aa44` | Zoom ≥ 10 (configurable) |
| Designated Places | StatCan Digital Boundary Files | Purple `#9400d3` | Zoom ≥ 11 (configurable) |
| Forward Sortation Areas (FSA) | StatCan Cartographic Boundary Files | Red `#ff0000` | Zoom ≥ 11 (configurable) |

Layer labels for Census Divisions, Census Subdivisions, and Designated Places display both the **place name and type** (e.g. *Halifax | County*, *Montréal | City*).

The map center's current **FSA code** and **Census Division** are displayed in the WME top bar while the relevant layers are visible.

---

## User Interface

### The CAGB Sidebar Tab

Click the **CAGB** tab in the WME right sidebar to open the control panel. It contains all settings for the script.

---

### Quick Presets

At the top of the panel, four one-click preset chips instantly restyle all layers at once:

| Preset | What It Does |
|---|---|
| **High Contrast** | Bright primaries (blue / yellow / green / magenta / red) at 90% opacity |
| **Minimal** | Keeps existing colors but drops every layer to 30% opacity |
| **Colorblind** | Applies the IBM Design colorblind-friendly palette (blue / amber / teal / violet / yellow) |
| **Night Mode** | Dark jewel tones (navy / brown / dark green / indigo / dark red) at 70% opacity |

> Clicking a preset immediately updates the map and saves the choice to your browser's local storage.

---

### Layer Cards

Each boundary type (Provinces, Census Divisions, Census Subdivisions, Designated Places, FSA) has its own collapsible card.

#### Visibility Toggle

The **pill-shaped toggle switch** on the right side of every card header turns that layer on or off.

- Toggling here also syncs the corresponding checkbox in the WME **Layer Switcher** panel.
- The setting is saved automatically.

#### Expand / Collapse

Click anywhere on the **card header** (except the toggle) to expand or collapse its settings. An animated chevron indicates the state.

#### Inside an Expanded Card

| Control | How to Use | What It Does |
|---|---|---|
| **Dynamic Label Positions** checkbox | Check / uncheck | When enabled, labels are placed at the visual center of each *visible* polygon section rather than the geographic center. Useful when a boundary is partially off screen. |
| **Boundary Color** swatch | Click the colored box to open the native color picker | Changes the stroke color of the boundary lines and the label text color. |
| **Label Outline** swatch | Click the colored box | Changes the halo/outline color drawn behind label text for legibility. |
| **Opacity** slider | Drag left / right | Controls layer transparency from 0 % (invisible) to 100 % (fully opaque). The current percentage is shown to the right of the slider. |
| **25 % / 50 % / 75 % / 100 %** preset buttons | Click | Snaps the opacity slider to that value instantly. |
| **Minimum Zoom Level** *(Census Divisions, Subdivisions, Designated Places & FSA only)* | Type a number (1–22) | The layer will only fetch and display data at or above this zoom level. Raising the minimum zoom improves performance when zoomed out. |

> All card settings are saved to `localStorage` immediately on change — no Save button needed.

---

### WME Layer Switcher (Alternative Toggle)

The script registers checkboxes in the standard WME **Layer Switcher** dropdown:

- **CAGB – Provinces**
- **CAGB – Census Divisions**
- **CAGB – Census Subdivisions**
- **CAGB – Designated Places**
- **CAGB – FSA**

Checking or unchecking these has the same effect as the visibility toggles in the CAGB panel — the two controls stay in sync with each other.

---

### Status Bar (Map Center Info)

While the **FSA** and/or **Census Divisions** layers are visible, the script adds a live readout to the WME top bar showing the FSA code and Census Division that contain the current map center.

---

### Keyboard Shortcuts

The script registers five shortcuts with the WME keyboard shortcut system. By default they are **unassigned** — you assign the actual keys yourself inside WME's keyboard shortcut settings.

| Shortcut ID | Action |
|---|---|
| `cagb-toggle-provinces` | Toggle Provinces layer on/off |
| `cagb-toggle-census-divisions` | Toggle Census Divisions layer on/off |
| `cagb-toggle-census-subdivisions` | Toggle Census Subdivisions layer on/off |
| `cagb-toggle-designated-places` | Toggle Designated Places layer on/off |
| `cagb-toggle-fsa` | Toggle FSA layer on/off |

To assign a key: open **WME Settings → Keyboard Shortcuts**, find the CAGB entries, and click the field to record a key combination.

---

### Reset to Defaults

A **"Reset all to script defaults"** button at the bottom of the CAGB panel restores every setting (colors, opacity, zoom thresholds, visibility) to the original script values. A confirmation dialog appears before any changes are made.

---

## Settings Persistence

All preferences are stored in `localStorage` under the key `wme_ca_government_boundaries`. Settings survive page refreshes and browser restarts. Keyboard shortcut bindings are saved when you leave the WME page (`beforeunload`).

---

## Performance Notes

- **Boundary data** is fetched only when the map stops moving (250 ms debounce). Rapid panning does not trigger multiple simultaneous requests.
- **Census Divisions, Census Subdivisions, Designated Places, and FSA** layers have configurable minimum zoom levels to avoid fetching large amounts of data when zoomed out.
- **Labels** are suppressed for boundary sections smaller than 0.5 % of the visible screen area, reducing visual clutter at all zoom levels.
- All requests are made via `GM_xmlhttpRequest` to bypass browser CORS restrictions on the Statistics Canada ArcGIS REST services.

