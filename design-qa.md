# Design QA — 本地安全扫描 Webpanel

final result: passed

## Comparison target

- Source visual truth: `/var/folders/2b/z81n4myx7k765ws80j1fgvc00000gn/T/codex-clipboard-01831cfb-0859-41b1-9d82-eb17387bfea6.png`
- Normalized source capture: `/Users/rui.ma1/Documents/security_group/security-plugin/design-qa-source.png`
- Implementation screenshot: `/Users/rui.ma1/Documents/security_group/security-plugin/design-qa-implementation.png`
- Combined comparison evidence: `/Users/rui.ma1/Documents/security_group/security-plugin/design-qa-comparison.png`（上：参考图；下：实现）
- Viewport/state: 1872 × 420 CSS px，深色主题，最近一次扫描完成且存在上次扫描记录。
- Density normalization: source 1872 × 630 px cropped to 1872 × 420 px; implementation 1872 × 420 px at device scale factor 1. Both comparison inputs are equal pixel size.

## Full-view comparison evidence

- Information hierarchy: the source's left summary, severity metrics, detailed table, total count, and footer actions are retained. The score gauge is intentionally replaced with current issue count, previous-scan delta, workspace, scope, and local-persistence status per product requirement.
- Fonts and typography: both use the host application's compact system UI font treatment. Count hierarchy, 12–13 px table text, weights, truncation, and line height remain readable at 1:1 scale.
- Spacing and layout rhythm: 12 px outer padding, 9–12 px card gaps, compact severity cards, sticky table header, and footer actions match the source panel density. The final pass keeps every persistent action fully inside the 420 px viewport.
- Colors and tokens: the implementation uses VS Code theme tokens for surfaces, borders, foregrounds, focus, and hover states, with semantic red/orange/yellow/green/blue severity accents matching the source intent.
- Image quality and assets: the target contains no required raster product assets. Decorative score artwork and severity glyphs were intentionally omitted rather than approximated with custom SVG/CSS art. No image assets are blurred, stretched, or substituted.
- Copy/content: labels consistently describe counts, changes, local storage, severity, location, rule, and remediation. Internal scan-engine names are absent.
- Accessibility and controls: the three footer buttons are enabled in the completed state, five finding rows are keyboard-focusable, progress has ARIA values in the running state, and browser console inspection reported no errors or warnings.

Focused region comparison was not needed: both 1872 × 420 captures were inspected at original resolution, where severity-card copy, all table columns, and footer controls are fully readable. The dense table is also visible without scaling in the combined 1872 × 840 comparison.

## Findings and comparison history

### Iteration 1 — blocked

- [P2] Footer actions clipped at the reference viewport height.
  - Evidence: the first implementation capture placed the lower button border below the 420 px viewport.
  - Impact: persistent actions could become partially hidden in a short VS Code bottom panel.
  - Fix: reduced `.table-wrap` maximum height from 250 px to 208 px so the header, rows, summary, total, and all actions fit within the reference-height panel.

### Iteration 2 — passed

- Post-fix evidence: `/Users/rui.ma1/Documents/security_group/security-plugin/design-qa-implementation.png` and `/Users/rui.ma1/Documents/security_group/security-plugin/design-qa-comparison.png`.
- The footer actions are fully visible; no actionable P0, P1, or P2 visual differences remain.
- Remaining differences are intentional product constraints: no score, one additional explicit critical category, a local-record indicator, and no engine/Skill disclosure in table copy.

## Primary interactions checked

- Completed-state controls are keyboard-reachable and enabled: rescan, view report, and export report.
- Finding rows expose focus targets and locations for the VS Code open-file command.
- The local browser preview verifies rendered states and layout; actual VS Code command dispatch and local-history behavior are covered by the Extension Host regression suite because those commands require the VS Code host bridge.

## Implementation checklist

- [x] Remove vulnerability scoring.
- [x] Show current and previous issue counts with severity deltas.
- [x] Show persisted-local status and latest scan metadata.
- [x] Preserve dense finding table and report actions.
- [x] Hide internal scan-engine/tool names.
- [x] Fit the completed state inside the reference-height panel.
