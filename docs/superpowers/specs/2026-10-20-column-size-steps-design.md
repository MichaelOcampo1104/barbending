# Column size steps and terminations (design)

Status: built on 2026-10-20 after your "go". Not committed. This extends the [member reinforcement design](2026-10-19-member-reinforcement-design.md) and replaces its item K(e), which kept one box size and one bar count per column. What was built, the checks, and the choices made are in section 8.

## 1. Goal

A column's schedule can change its box size and its MAIN BARS at a level, as the drawing C4/C4A does at B1. The card builds each section's mains, links and starters. The drawing is the acceptance case (section 6).

## 2. The drawing (C4/C4A)

SFL is the top of each slab, and each slab sits below its SFL. Heights are above the base, whose SFL is −20.870.

| Level | SFL (m) | Above base (mm) | Slab (mm) | SIZE | MAIN BARS | Cross-ties (X / Y) |
|---|---|---|---|---|---|---|
| Roof | +2.030 | 22900 (soffit 20900) | 2000 | — | — | — |
| B1 concourse | −5.790 | 15080 | 800 | 2400 × 800 | 40H25 | 2H10-100 / 4H10-100 |
| B2 lower concourse | −12.270 | 8600 | 1200 | same as below | same as below | same as below |
| B3 platform | −18.570 | 2300 | 1500 | same as below | same as below | same as below |
| Base (B3 underplatform) | −20.870 | 0 | — | 3200 × 800 | 40H40 + 8H32 | 2H10-100 / 4H10-100 |

Outer links are H10 throughout. The cross-ties are taken from your answer and applied to every level. The base's bars (40H40 + 8H32) are my reading of the drawing and need confirming.

Derived: the roof soffit is +0.030, which is 20900 mm above the base, so the member height (Hz) is 20900 mm. The B1 soffit is 14280 mm above the base.

## 3. Rules

R1. **Size step.** A level whose SIZE differs from the level below starts a new section at its SFL. The upper section is centred on the lower one (3200 to 2400: 400 mm at each end).

R2. **Termination at a size step.** The lower section's bars and the upper section's starters are both anchored in the step's slab, each bent horizontally inside it. The upper bars do not lap the lower bars, because the two rings do not line up (40 upper bars against 48 lower bars). The lower bends sit one cover above the soffit, and the upper bends one bar diameter above them (the larger of the two bars). The horizontal leg is the anchorage, defaulting to the bar's lap length (2240 for H40, 1650 for H32, 1290 for H25). There is no crank and no jog at the step.

R3. **Levels that keep their size** are splices, as now: crank, jog and lap.

R4. **Top.** The upper bars run to the top end, which is the card's existing convention (lz − cover + Ø/2), so they stop short of the roof soffit. The existing top starters go up into the roof slab.

R5. **Layout per level.** Each level's MAIN BARS is either one cell (all faces) or two cells (long and short faces), chosen per level. Today the layout is set for the whole column, so C4/C4A cannot be entered as drawn.

R6. **Links per section.** Each section's storeys have their own outer link and cross-ties. Link stacks stop at each slab's bottom face, as now, so the B1 slab is a gap and the upper storey starts at its SFL.

R7. **Room and clashes.** Every splice and termination must clear the next level and the top. The bent ends in a step's slab must keep a clear gap of one bar diameter (the larger of the two bars) from each other; the card refuses and names the two bars when they do not. Each bend turns out of the face its bar sits on (a corner bar turns diagonally outward), so neighbouring bars on a face do not fan into each other.

## 4. Derived positions (C4/C4A, Hz 20900)

- Lower section, base to the B1 soffit: 0 to 14280 mm, 3200 × 800, 48 bars.
- Splice at the B3 platform (2300): a 2375, b 2615, c 4855 (40 mm crank, 240 mm jog, 2240 mm lap).
- Splice at the B2 lower concourse (8600): a 8675, b 8915, c 11155. It ends 3125 mm below the B1 soffit, so it fits.
- Step at B1: the lower bends at 14320 mm and the upper bends at 14392.5 mm (one bar diameter above them), both in the B1 slab (14280 to 15080 mm).
- Upper section, from the B1 SFL (15080 mm) to the top: 2400 × 800, centred (x 400 to 2800), 40 H25.
- Links: base storey 40 to 800; B3 storey 2300 to 7400; B2 storey 8600 to 14280; no links in the B1 slab; upper storey from 15080 to the top.
- Member Hz is set to 20900 mm (it is 11000 mm in the project file today).

## 5. Open items (my defaults in brackets)

O1. **Step anchorage.** Both sets bent horizontally in the B1 slab, not lapped [default]. A vertical hook cannot hold a 2240 mm anchorage in an 800 mm slab. Please confirm this is how C4/C4A should be detailed.

O2. **Anchorage length.** The bar's lap length [default], as the starters use. The horizontal leg is that length.

O3. **Base bars and cross-ties.** The base's 40H40 + 8H32 and the 2H10-100 / 4H10-100 cross-ties apply to every level [to confirm].

O4. **Count or Ø change at a level that keeps its size.** It stays a splice, as now [default].

O5. **Roof SFL.** The roof SFL is the top of the roof slab, so the roof soffit is +0.030 [assumed].

## 6. Acceptance

- C4/C4A builds at Hz 20900 with no refusals, and the positions match section 4.
- Unit tests cover the centred step, the B1 anchorages, per-level layouts, the link gap at B1, the top starters, and the refusal of a clash.
- `npm test` passes, lint stays at the 29-warning baseline, and the browser check passes with a C4/C4A check added.

## 7. Not in this step

Base and roof slabs beyond the starters' anchorage. A bent 1-in-6 offset for steps, which C4/C4A does not need.

## 8. Built (2026-10-20)

Code: `src/bbs/memberReinforcement.js` (sections, step bends, the clash check), `src/bbs/MemberCard.jsx` (a MAIN BARS layout per level, the step line in the read-back, splices matched by level), `tests/bbs/memberSteps.test.mjs` (16 tests), and `scripts/perf/check_member_card.mjs` (a C4/C4A section: the drawing typed on the card gives 300 rows, the step line, and one undo).

Checks: `npm test` 323 pass (307 before, plus the 16). Lint at the 29-warning baseline, none in the member files. The browser check on the dev server (port 5189, stopped after) passes all 47 checks, including the C4/C4A drawing: 184 mains, 28 links and 88 starters.

Choices made (say if you want any changed):
- A step's bends turn out of the face their bar sits on, and a corner bar turns diagonally outward. Radial bends from the centre would fan neighbouring bars into each other (about 37 mm apart in the first build, so the check refused it).
- A step bend's horizontal leg is its bar's lap length. There is no typed override yet.
- The upper bars' bends are part of the mains set, because those bars are the step's starters. The starters set still holds only the base and top starters.
- The upper bends sit one bar diameter (the larger of the two) above the lower bends, both in the slab.
- Each level picks its MAIN BARS layout: same as below, one size, or long and short faces. The column's Layout still sets the base, and the two-face X and Y layouts apply to every level.
- A level that changes SIZE must have its SLAB THK.

Not built (limits):
- One size step per column. A second change of SIZE is refused.
- A level directly above a step cannot keep the step's size, because its splice would start in the step's slab. Give it its own SIZE, or take it out.
- No bent 1-in-6 offset option for steps.
- The base and roof slabs are modelled only as far as the starters.

C4/C4A needs the member's height set to 20900 mm. The project's Column is 11000 mm, so change it in the Concrete tab before generating.
