# Member reinforcement card: columns and walls

Date: 2026-10-19
Status: design agreed. Items F and G were not answered, so the implementer chose them (section 9). Item H (main bars on the lapped sides) was found while checking the drawn shape against the bars; it is a new rule (section 5). Item I (wall link legs) is flagged for a decision (section 9). Column levels (lap splices where the bar diameter changes, with crank bars at each splice) were added later, in section 5b and item J. Branch feat/member-reinforcement. Not committed.

## 1. Goal

Select a concrete column or wall, fill in its reinforcement in a card (main bars, links, starters), and get ordinary rows back, grouped in ▦ sets. The BBS, CSV, viewer, undo and the Set card then work unchanged. The input follows the FreeCAD Reinforcement workbench, but the output is the app's existing rows: no new object type and no file-format change.

## 2. Scope

In v1 (agreed):
- Columns: main bars (all faces, or two faces), column links in the drawn lapped shape (`inputs/Column link shape.dxf`, section 5), starters at both ends, and levels: lap splices where the bar diameter changes, with crank bars at each splice (section 5b).
- Walls: vertical mains around the whole outline, horizontal distribution on both faces, `c_link_with_hook` links (Plane XY, rotation 90), starters at both ends.
- Starters at both ends: base starters anchored below the base, top starters anchored above the top (on by default). Each has a lap inside the member and an anchorage made of a straight part and a bend.
- Box members only (scratch concretes). IFC members are out of scope.

Out of scope in v1:
- Parametric members: rows do not regenerate when the member changes.
- New file format, DXF or CAD changes.
- Beams and slabs.
- Code checks (spacing limits, lap percentages). Bars longer than the stock length get a warning, not a splice.

## 3. User flow

1. Select a Column or Wall in the Concrete tab. The card appears under the member's fields.
2. Fill in the inputs (section 4). Defaults come from the member and the global cover.
3. Generate. The card adds the sets `<member> mains`, `<member> links`, `<member> starters`. For walls: `<member> mains`, `<member> distribution`, `<member> links`, `<member> starters`. One undo step for the whole card.
4. To change the design, delete those sets and generate again. The card keeps its inputs while the member stays selected. Nothing is saved in the project.

Kind: the card has a Column / Wall switch. It is set automatically by `memberKind`, but the automatic rule misses a wall that runs along X and has no "wall" in its name. The reference wall (W1, 5000 long along X) would be classified as a beam.

## 4. Inputs and defaults

- Cover: the global cover (40 mm).
- Bond (agreed, from the samples): mains good, starters good, distribution poor, links none.
- Columns, main bars: Ø. Layout "All faces, one size" with a total count around the ring (4 or more); "All faces, long and short faces" with a count and Ø for the long faces and another for the short (5d); or "Two faces" with a count on each of the two faces (the pair parallel to X or to Y).
- Columns, links: Ø, spacing along the height, and the lap length at the closing corner (section 9, item F).
- Columns, levels (any number, optional): for each, the height above the base where the bars are lapped, the bar Ø above it, and optionally its lap, crank step and jog (defaults in section 5b). Starters: a top Ø, which defaults to the top bar's Ø.
- Walls, mains: Ø and spacing along the length. Equal spacing around the whole outline, as in the sample.
- Walls, distribution: Ø and vertical spacing, on both faces.
- Walls, links: Ø, spacing along the length, vertical spacing. The first and last link sit 100 mm from the wall ends (sample). Leg A is entered (130 in the sample). Leg B is thickness − 2 × cover (120 in the sample).
- Starters (both ends): Ø (default: the main Ø). Lap (default: the good-bond table value, `lapLengthMm`, rounded up to 10 mm). Anchorage (default: the lap). Bend leg (default: the larger of 10 × Ø and 150 mm). Top starters on (default).

## 5. Rules

Geometry
- Cover is measured to the outside of the links, so the outer surface of a link sits at the cover (agreed).
- Main bars sit inside the links: the centre is at cover + Ø_link + Ø_main / 2 from each face (agreed).
- H (new): on the two lapped faces (the left and the bottom faces, in the drawn orientation, section 5 column links) the centre sits one more link diameter in: cover + 2 × Ø_link + Ø_main / 2. The first leg runs inside the closing leg there, so the default position would overlap it (the centre would be 7.5 mm from the first leg's centreline, 17.5 needed). The top and right faces keep the default.
- Column ring: corners first, then the rest share each side equally, rounded so the total is exact (agreed). Corners are the corners of the cage: left and bottom at the H offset, top and right at the default. With long and short faces (5d), each face takes its own count and sits on the same offsets.
- Two faces (agreed: columns only): the count on each face, from corner to corner (at least 2). The total is twice the count.
- Column mains run from base cover to top cover (internal height).

Column links (the drawn shape, agreed)
- The shape is one open polyline in `inputs/Column link shape.dxf`: a closed rectangle whose two ends overlap at one corner (the SW corner in the card's frame: origin at the outer SW corner, x along the width, y along the depth). The drawing's bottom and left sides are the lapped pair; its top and right sides are single legs.
- Centreline geometry, with c = cover, Ø = Ø_link, L = lap (item F), lx and ly the member's sides. Points in order:
  - P0 = (c + 3Ø/2 + L, c + 3Ø/2): first leg starts L from the inner corner, on the bottom.
  - P1 = (c + 3Ø/2, c + 3Ø/2): inner SW corner.
  - P2 = (c + 3Ø/2, ly − c − Ø/2): NW corner, up the left side.
  - P3 = (lx − c − Ø/2, ly − c − Ø/2): NE corner.
  - P4 = (lx − c − Ø/2, c + Ø/2): SE corner, closing leg's bottom.
  - P5 = (c + Ø/2, c + Ø/2): outer SW corner, the closing leg turns up here.
  - P6 = (c + Ø/2, c + 3Ø/2 + L): closing leg ends L past the inner corner.
  - With c = 40, Ø = 10, L = 240, lx = ly = 800: P0 (295, 55), P1 (55, 55), P2 (55, 755), P3 (755, 755), P4 (755, 45), P5 (45, 45), P6 (45, 295). Developed length 3310 mm (gross, before bend deduction).
- Closing leg outer surface at the cover (G): its centreline is c + Ø/2 from the faces. The first leg is one link diameter inside it (Ø), as the drawing shows (offset 0.013 and 0.017 in the DXF units).
- Lap L (F, decided): one third of the link's centreline width (legW = lx − 2c − Ø), rounded to the nearest 10 mm. 710 → 240 on the 800 sample (about 24 × Ø). The lap is an input, so a different length is one number to change.
- Links are stacked over the internal height from the base cover, at the spacing. Count = floor((internal height − Ø) / spacing) + 1, so the last link stays inside the top cover. (The earlier form, floor(height / spacing) + 1, passed the top cover when the height divided exactly by the spacing: 31 links at 4580 mm high instead of 30. The sample is unchanged at 30.)
- Row: one `profile` row per link set (a custom polyline, as the stair profiles use), with qty_z and spacing_z for the stack.

5b. Column levels (lap splices where the bar diameter changes; crank bars at each splice)
- A level is a height above the member's base where every main bar is spliced (all bars, not per bar). Each level gives the bar Ø above it.
- Splice geometry, for a level L with lap ℓ, jog m and crank step s: the upper bar (the new Ø) starts at b = L − ℓ/2 and runs up. The lower bar runs straight at its main position up to a = b − m, cranks inward by s over the jog from a to b, then runs alongside the upper bar to c = L + ℓ/2. The two bars overlap over b to c (length ℓ) and are side by side, s apart (s is at least the mean of their Ø).
- The lower bar is a `double_crank` (Z bar): DC_Lap_Start = a − its bottom, DC_Lap_Mid = m, DC_Tail_Length = ℓ, Crank_step = s. The upper bar is `straight`. The single-jog `crank` type is not used: its jog sits at 40 to 60 % of its length, so a level cannot set it.
- Crank direction: inward, towards the column centre, set through `plan_rotation` on the bar's own transform. The offset tail therefore stays inside the cage and clear of the links.
- Defaults (`levelDefaults`): ℓ = the good-bond table lap of the larger of the two bars (the app's table; the larger bar governs); s = the larger Ø rounded up to 5 mm; m = 6 × s (a 1 in 6 jog) rounded up to 10 mm. All can be entered.
- Bars: V1 is the bottom bar, starting at the base cover + Ø/2 as in the sample; V2 is the next, and so on. The top bar runs to the top end (lz − covT + Ø_top/2), the sample's convention. A level with no crank step gives straight lapped bars at one position, with a warning.
- Top starters take the top bar's Ø. A starter Ø typed in the form applies to both ends, and a top Ø can be entered for the top end only. The lap, anchorage and bend are shared by both ends.
- Room: the bottom bar must extend at least 1 mm below the first jog (a − bottom ≥ 1), each splice must end before the next jog begins (a_{k+1} − c_k ≥ 1), and the top must clear the last splice (top end − c ≥ 1). The double crank's start must be above zero, because the app treats a zero as the default.
- Rows: a column with n levels has n + 1 bar lengths per main position. The sample column (16 mains) with one level gives 32 main rows (16 double cranks), 32 starters and 1 link set: 65 rows.

5c. Column schedule (the drawing's layout; columns only)
- A column is entered as a schedule laid out like the drawing: one block per level, top level first. Each level has a name, its SFL (metres) and three cells, typed as the drawing writes them: SIZE `2500 x 1000`, MAIN BARS `44H25`, LINKS `H10-150 + 6H10-150`. The drawing's "Slab Thickness" row holds the main bars, so the card calls that row MAIN BARS.
- "= below" (or the text `same as below`) copies the level under it. The bottom level is the member's base and cannot copy. Each level runs from its SFL up to the next level's SFL, and the top level runs to the top of the member. Heights are SFL differences, so the SFL datum itself does not matter.
- SFL is in metres. A value of 1000 or more is refused by name (-20870 for -20.870 is the usual slip). Each level must lie above the base and below the top of the member: a level at or above the top is refused, and the message gives the level's height above the base and the member's height. The card also shows the member's height and each level's height above the base, so a short member is easy to spot. A level above the top is refused, not dropped, so a wrong SFL cannot remove bars silently.
- SIZE must match the member's Lx × Ly: the section does not change within one member (a different size is another member). MAIN BARS: the count must stay the same up the column (44 and 52 are not modelled in one member); the Ø can change at any level. MAIN BARS may also give long and short faces (5d), where each pair's count must stay the same. The layout sets the form for every level, so one form runs up the column. LINKS: one closed link set with one outer link Ø up the column; the spacing can change at each level. `3H10-100` is refused for now: more than one closed set per level is not modelled.
- Cross-ties: LINKS is three cells on every level, always shown: Outer link, Cross links X and Cross links Y. A cross-link cell reads its count, size and spacing (`2H10-150`), and a blank cell means none. The card joins them into the notation `H10-100 + 4H10-100 X + 6H10-100 Y`, which the schedule reads, and "same as below" works cell by cell. The notation also accepts a group with no letter, which runs along Y, as `+ 6H10-150` does. A Y group runs between the top and bottom bar rows, in the link layers. An X group runs between the left and right faces, one tie diameter higher (item M). Every tie is a `c_link_with_hook` row with a double hook (BBS shape 85). Its spine runs from one bar row (or face) to the other. Each end hooks the bar of its row: the hook is as wide as the bar and the tie together (width = Ø_bar + Ø_tie, so the bar sits inside the hook). Ø_bar is the Ø of the bars the tie holds: a Y tie holds the bars of the faces along X, an X tie those of the faces along Y (the two differ only with long and short faces, 5d). The spine is the centre-to-centre distance between the rows plus that width (length = (y1 − y0) + Ø_bar + Ø_tie). The end leg is c_length_b = Ø_bar + 2 × Ø_tie. Each return is 10 × Ø_tie, the app's rule. The spine sits half a hook to the right of its bar, so the bar lies in the hook.
- Cross-tie positions: the interior bars of the bottom row that also have a bar at the same x on the top row. If there are more of them than cross-ties, the cross-ties take them evenly spread. The card refuses a count that does not fit (for example 4 cross-ties with 3 bars per long side). Runs with cross-ties restart where the bar Ø changes, because the hook depends on the bar.
- The hook closures sit on the outer links, because the bars touch the links, and the bottom closures also meet the lapped first leg. See item L.
- Every level boundary is a lap splice with a crank (5b), whether or not the bar changes, because the drawing marks a LAP LENGTH at its levels. The lap, crank step and jog per level are optional fields with the 5b defaults.
- Links: a run of levels with the same spacing, and no cross-ties, shares one stack of links, so a level that changes only the bars does not restart the links. A run with cross-ties also restarts where the bar Ø changes (see the cross-ties bullet). A stack starts Ø/2 above its run's bottom and stops Ø/2 below its run's top, so no link passes the top cover.
- Starters: at the base they take the base bar's Ø, and at the top the top bar's Ø, face by face with long and short faces (5d). A typed starter Ø applies to both ends and both faces.
- The mains are placed for the largest bar Ø on their face in the schedule, so every bar clears the links.
- Column 2, as the user corrected it: 2800 x 1400, 52H25, outer link H10-100, 4 cross-ties along X and 6H10-100 along Y. Only the count was given for the X ties, so their size and spacing are assumed H10-100. At an assumed 4.5 m height: 167 rows (52 mains, 104 starters, one outer link set of 45 layers, 4 X ties and 6 Y ties of 45 layers each).
- Worked example (the drawing's 2500 x 1000 column, 12 m high, base at B3 underplatform, levels at B3 platform and B2): 44H32 below 2.3 m, then 44H25; links H10-150 + 6H10-150 throughout. Result: 132 main pieces (44 × 3), 88 starters, two link stacks (16 layers below 2.3 m, then 65 above, because the cross-ties restart the links where the bar changes), and 12 hooked cross-tie rows (six per stack): 234 rows.

5d. Long and short faces (added 2026-10-19 for column 1: 44H40 on the long faces, 8H32 on the short)
- Layout: "All faces, long and short faces" (the schedule's `layout` is `faces`). Each level then has two MAIN BARS cells, one for the long faces (`44H40`) and one for the short faces (`8H32`), each with its own "= below". "All faces, one size" keeps one MAIN BARS cell with a single size (`44H25`). The earlier one-cell notation, `44H40 long + 8H32 short`, is no longer read: a MAIN BARS cell under the one-size layout that contains it is refused with a message that names the layout to use.
- Each count is for a pair of faces. 44 is the total on the two long faces, so 22 on each, corners included. 8 is the total on the two short faces, so 4 on each, between the corners.
- The long faces are the two along the longer side: the bottom and top rows when the member is longer along X, the left and right columns when it is longer along Y. A square member has no long face, so it is refused. Each pair's count must be even, at least 4 on the long faces and 2 on the short.
- Positions: bars on a long face run corner to corner, corners included, so the corners are long-face bars. Bars on a short face sit evenly between its corners. Each face's row sits one bar radius inside its cover line, using that face's own Ø (and the H offset on the lapped faces, rule H).
- Splices: each face splices on its own. Each bar laps the bar of its face below and above, and the lap, crank step and jog defaults come from that face's pair of Ø (5b). A lap, step or jog typed for a level applies to both faces of that level; the placeholders show the long and short defaults as `1650 / 1290`.
- Cross-ties: Y ties hook the long-face bars when the member is longer along X (hook 50 with H40 bars and H10 ties, so c_length_b = 60). X ties hook the short-face bars (hook 42 with H32 bars, c_length_b = 52). A Y tie can sit on any of the 20 interior bars of a long face, and an X tie on any of the 4 interior bars of a short face. More than that is refused, as before.
- Starters: each bar's starter takes its face's Ø, at both ends.
- Column 1, as the user gave it: 2500 × 1000, 44H40 long + 8H32 short, outer link H10-100 (assumed: column 1's outer spacing was not given), 2 X ties and 6 Y ties at 150 (size H10 assumed). Base level only: 165 rows (52 mains, 104 starters, one outer link set of 45 layers, and 2 X and 6 Y cross-tie groups of 30 layers).

5e. Slabs and link zones (added 2026-10-19, from the user's answers: the slab sits below its SFL; B3 platform 1500 mm, B2 concourse 1200 mm)
- Each level above the base has SLAB THK, the slab below its SFL, so the SFL is the top of the slab and the slab runs from SFL − thickness up to the SFL.
- The top of each storey is the slab of the level above. The storey's links run up to that slab, and the slab takes its own links, entered on its own level (the links in the slab below SFL). Those are the drawing's TOP row of the storey below and BOTTOM row of the level above, which the card keeps as one zone.
- Zones from the bottom of the member up: the storey's links from its SFL (the base from the bottom cover) up to the next slab, then the slab zone up to the next SFL, and so on. The top storey runs to the top cover.
- Column 1 (base −20.870, B3 platform −18.570, B2 concourse −12.270): the B3 slab (1500) gives the zone 800 to 2300 mm above the base, and the B2 slab (1200) the zone 7400 to 8600 mm. The base storey runs 40 to 800 mm, the B3 storey 2300 to 7400 mm, and the B2 storey from 8600 mm up.
- Blank slab links: the slab takes the links of the storey it sits in, so it does not split the stack. Slab links follow the LINKS rules (one closed set, the bottom row's outer size, cross links with a count, size and spacing).
- A slab must be thinner than the storey below it, so its links have room, and slab links need a thickness.
- A slab zone's cross links hook the bars of the storey it sits in.
- Not modelled: the slab below the base, which is below the member (the starters go into it, but the links do not yet), and the slab above the top level, since no level sits above it. The top storey runs to the top cover.

Walls
- Length is the longer horizontal side and thickness the shorter.
- Mains: equal spacing around the whole outline, as in the sample. Count = round(perimeter of the mains' rectangle / spacing), positions from one corner.
- Distribution (agreed: vertical layer nearer each face): horizontal bars along the length, on each face, inside the verticals. Stacked from the base cover, count = floor(internal height / spacing) + 1.
- Links (agreed: `c_link_with_hook`, Plane XY, rotation 90): the spine crosses the thickness and the two legs run along the wall. Spine = thickness − 2 × cover − Ø_link, centred between the covers. Leg B = thickness − 2 × cover. The links are spaced along the length and stacked over the internal height from the base cover.

Starters (both ends)
- One starter at each main position, so the laps line up.
- Base starter: the top of the bar sits one lap above the base, inside the member. Below the base: a straight part (anchorage minus bend leg), then the bend.
- Top starter: the bottom of the bar sits one lap below the top, inside the member. Above the top: a straight part, then the bend.
- Bend direction (agreed, as the samples): outward, radially from the member's centre. For walls this sends the bars near the middle through the outer face (the bend ends 30 to 55 mm outside it). Accepted.
- If the element below (base) or above (top) cannot hold the straight part (its internal depth minus cover), the straight part is shortened and the bend lengthens. If there is no such element, the card warns and keeps the full anchorage, as the sample does.
- Starter length = lap + anchorage.

Rows (fields taken from the samples)
- Column mains: straight, Plane XZ, rotation 90, length = internal height, Pos_z = base cover + Ø / 2.
- Column links: `profile` (section 5), Plane XY, qty_z and spacing_z.
- Wall mains: straight, Plane XZ, rotation 90.
- Distribution: straight, Plane XY, rotation 0, qty_z and spacing_z, bond poor.
- Wall links: `c_link_with_hook`, Plane XY, rotation 90. Length = spine, c_length_a = leg A, c_length_b = leg B, double_hook no. qty_x and spacing_x along the wall, qty_z and spacing_z vertically.
- Starters: `bent`, Plane XZ, rotation −90 at the base or 90 at the top. Length of Bar = lap + straight part, H = bend leg, bent_up_down up, plan_rotation = the bend direction.
- Marks (from the samples): `V1-n` and `T1` for columns, `WV1-n`, `WH1`/`WH2`, `WL1` for walls, `ST1-n` for base starters and `ST2-n` for top starters.
- Host = the member, and Group = the member's name, so the BBS and CSV group the rows by member.
- The BBS shape code of a column link becomes 99 (special: bent to sketch), not 51 (closed tie), because the lap is not a standard tie.

## 6. Worked example (column, for review)

400 × 400 × 3000 column, cover 40, 8 × Ø25 all faces, Ø10 links at 150, Ø25 starters, both ends.
- Mains: 8 bars, 62.5 mm from each face (40 + 10 + 12.5). Four corners and one bar at the middle of each side. Length 2920 (3000 − 40 − 40).
- Links: 20 at 150 mm, the first at 45 mm (40 + 5), each closed with the drawn lap (lap length: section 9, item F). The outer surface of each link is at 40 mm.
- Base starters: 8 bars. Lap 1290 (good bond, Ø25). Anchorage 1290 (equal to the lap). Bend 250 (the larger of 250 and 150). Straight part below the base 1040 (1290 − 250). Total 2580 each.
- Top starters: the same, mirrored above the top.

The 800 mm column in the samples (16 × Ø25 mains, plain Ø10 ties at 150) follows the same rules. There the mains sit at 52.5 mm, which overlaps the ties; the card puts them at 62.5 mm (section 7).

## 7. Differences from the samples (intended)

- Column links: the drawn lapped shape (agreed), instead of the sample's plain closed tie.
- Main bars inside the links (agreed). The samples place them at cover + Ø/2, which overlaps a Ø10 tie by 10 mm at 40 mm cover.
- Main bars on the lapped faces sit one link diameter further in (H). The samples have no lapped column link, so they have no such offset.
- Wall distribution inside the verticals (agreed). The samples put both layers on the face.
- Wall link centred between the covers (agreed). The sample's link starts on the outer face, and its spine is 160 mm (thickness minus one cover).
- Wall mains: the same as the sample (equal spacing around the outline, on the outer layer): 67 bars, the second at x = 197.49. The mains do not move, because the distribution, not the mains, moves inside them.
- Starter positions: on the main positions. The samples offset starters by their own Ø (46.5 instead of 48 mm on the wall).

## 8. Acceptance

1. Unit tests (Node): ring positions and counts, the link count, the lap and anchorage split, the shallow-element cap, the wall link spine and leg B, the closing-leg offset and the lap.
2. Parity with the samples: the card's rows for the two sample members (`inputs/column_sample_800_auto_bbs.json`, `inputs/wall_sample_auto_bbs.json`) compared with the sample rows. Only the differences in section 7 may remain. For the column link, the drawn shape (`inputs/Column link shape.dxf`) is the reference for the outline.
3. Browser check: create a column, generate, count the sets and rows, check that the BBS totals change, check that one undo removes all sets.
4. Mutation: break the anchorage split, the shallow-element cap, the link lap or the wall link spine, and the unit tests must fail.

Results (2026-10-19, branch feat/member-reinforcement, not committed):
- Unit tests: `tests/bbs/memberReinforcement.test.mjs`, 16 pass. Store actions: `tests/bbs/memberCardActions.test.mjs`, 4 pass. Full `npm test`: 256 pass.
- Parity with the samples: the column card gives 49 rows (the sample has 49), the wall card 204 (the sample has 204). Wall mains match the sample exactly (67, the same positions). Column starters match at 1290 / 3210 (lap), 2330 (length), 250 (bend), and the plan rotation is outward. Differences are the section 7 items.
- Mutation: the four rules above were each broken in turn and the tests failed each time (file restored).
- Browser (`scripts/perf/check_member_card.mjs`, headless Edge, port 5188): 15 checks pass. Column: one set per group, 49 rows, the same names refused, one undo removes all three sets. Wall: switched to Wall, 204 rows in four sets, all hosted by W1. No console errors. Screenshot: `scripts/perf/out/member_card.png`.
- Lint: the new files add no warnings.
- Levels (added later, 2026-10-19): `tests/bbs/memberLevels.test.mjs`, 10 pass. Full `npm test`: 268 pass. Lint: the repo count is still the 29-warning baseline. Mutation of the splice centring, the crank direction and the room check: each one caught, file restored.
- Schedule (5c, added 2026-10-19): `tests/bbs/memberSchedule.test.mjs`, 8 pass. Full `npm test`: 276 pass. Lint: still the 29-warning baseline. The wall's distribution and link counts moved to the same top-cover form as the column links (sample values unchanged: 20 and 10). Browser check: 24 checks pass, including the schedule's room check and its read-back. Screenshot: `scripts/perf/out/member_card_levels.png`.
- X cross-ties and column 2 (2026-10-19, after the user's correction): `tests/bbs/memberSchedule.test.mjs` 14 pass, including column 2 (167 rows) and the X-tie hook geometry, and two refusals (X ties with two faces along X; more X ties than bars). Full `npm test`: 282 pass. Lint: the 29-warning baseline. Browser check: 29 checks pass, now with two X ties and two Y ties typed into the base level (53 rows, one undo).
- Cross-ties as `c_link_with_hook` (added later, 2026-10-19): `tests/bbs/memberSchedule.test.mjs`, 12 pass. The drawing's column now gives 234 rows, two link stacks and 12 hooked cross-ties; there are two refusals and a hook-geometry test. Full `npm test`: 280 pass. Lint: the 29-warning baseline. Browser check: 29 checks pass, including two cross-ties typed into the base level (51 rows, both `c_link_with_hook` with a double hook, and one undo).
- Browser after levels (before the schedule): `scripts/perf/check_member_card.mjs` had 23 checks, all passing. A level at 100 mm is refused and Generate is off. A level at 2000 mm with Ø20 above adds 65 rows, 16 of them double cranks, and one undo removes them. Screenshot: `scripts/perf/out/member_card_levels.png`.
- Long and short faces (5d, 2026-10-19, after column 1's answers): `tests/bbs/memberFaces.test.mjs`, 9 pass, covering the notation, the face positions, column 1 (165 rows, hook widths 60 and 52), two levels with a splice per face, starters per face, the refusals and the member longer along Y. Full `npm test`: 291 pass. Lint: the 29-warning baseline. Browser check (dev server on port 5189, stopped afterwards): 34 checks pass, including column R1 (2500 × 1000, 44H40 long + 8H32 short, 2 X and 6 Y cross-ties): 165 rows, both hook widths, one undo. A probe of the card showed the per-face placeholders and read-back.
- Layout cells, level message and SFL check (2026-10-19, after the user's drawing check): `tests/bbs/memberFaces.test.mjs` 13 pass, covering the long and short face cells, same as below per face, the one-size refusal that names the layout, a level above the top with both heights, SFL in millimetres, and the drawing's SFLs on a 12 m member (levels at 2300 and 8600 mm). Full `npm test`: 295 pass. Lint: the 29-warning baseline, none in the new files. Browser check: `scripts/perf/check_member_card.mjs` 38 checks pass on the dev server (port 5189, stopped afterwards), including column R1 with the face cells, a level 9 m above its 4.5 m member refused with both heights, and -20870 refused as millimetres.
- Slabs and link zones (5e, 2026-10-19): `tests/bbs/memberSlabs.test.mjs`, 6 pass, covering the B3 and B2 slab zones (800 to 2300 and 7400 to 8600 mm), blank slab links, a slab thicker than its storey, slab links without a thickness, and a column with four link runs and cross links in the slab. Full `npm test`: 306 pass. Lint: the 29-warning baseline. Browser check: `scripts/perf/check_member_card.mjs` 41 pass on the dev server (port 5189, stopped after), including a 1500 mm slab under a level 2.3 m up reading 800 to 2300 mm.

## 9. Open items (to decide before the plan)

F. Column link lap (decided by the implementer, not answered): the drawing's proportion, one third of the link's centreline width, rounded to 10 mm: 240 mm on the 800 sample (about 24 × Ø10). Editable on the card. Note: for Ø10 the good-bond lap table gives 400 mm (`lapLengthMm(10, 'good')`), but the links have no bond condition (section 5), so the table does not apply. Check this lap against your code before using it.

G. Closing leg's outer surface at the cover (decided by the implementer, not answered). Changing it moves the whole link by Ø/2 and the main bars with it.

H. Main bars on the lapped faces, one link diameter further in (new, section 5). Without it the first leg would overlap the corner and side bars in every link layer.

I. Wall link legs (not changed; needs a decision). The legs run along the wall length at the two cover lines, which is where the vertical mains sit (y = c + Ø_main/2). Each leg therefore crosses the mains in its layer, and the first link's leg A runs 30 mm past the wall end (x = 100 − 130). The sample has the same overlaps: its legs sit on the WH1 distribution bar, and the first link's leg A also reaches x = −30. The card keeps the agreed geometry. Options: (a) run the links in the vertical plane around the two distribution layers; (b) make each leg fit between two mains (the clear gap at 150 mm spacing is 134 mm, less the link diameter); (c) keep it as is.

Wall distribution and link ends (decided, from the sample): the distribution and the links both start 100 mm from each wall end; the vertical mains run on the outer layer (cover + Ø_main/2 from each face, as the sample's 48 mm), the distribution inside them (cover + Ø_main + Ø_dist/2, 62.5 mm on the 16 mm verticals).

J. Column levels (new; decided by the implementer, not answered). The lower bar of each splice is a double crank cranked inward by one crank step, with a 1 in 6 jog, and every main bar is spliced at every level. Open for you: (a) per-bar levels, if some bars must not change; (b) the inward crank direction is the same for every bar, which may not match your detailing; (c) the splice is centred on the level (the card's choice), not started at it.

K. Column schedule (item a answered by the user; the rest decided by the implementer). (a) Column 2 is now `H10-100 + 4H10-100 X + 6H10-100 Y`: the outer link is H10-100, with 4 cross-ties along X and 6 along Y. The printed `3H10-100 + 8H10-100` is not used. The X ties' size and spacing are assumed H10-100. (b) Cross-ties are `c_link_with_hook` (double hook, 5c), not straight bars. Their hooks clash with the links (item L). (c) The drawing's "Slab Thickness" row is labelled MAIN BARS. (d) Every level is a lap with a crank, even where the bar stays the same. For a straight lap, set that level's crank step to 0; the bars then share a position and the card warns. (e) The schedule is one column member: a change of size or of bar count needs another member.

L. Cross-tie hooks clash with the links (open; needs your decision). The bars touch the outer links, because the cover rule puts them there. So a hook closure that holds a bar lies on the link. At the top row the closure lands on the link's centreline when the tie and the link are the same Ø. At the bottom row, the lapped side, it also lands on the inner first leg. X ties clash in the same way: their closures land on the lapped first leg along the left side, and on the right link. Options: (a) move the bars one tie diameter further in (the cage gets Ø_tie wider). The closure then sits between the bar and the link, touching both, and the clash is gone; (b) hook the links instead, a different shape; (c) keep the BBS rows as they are and accept the overlap in the 3D view. I recommend (a). Column 1 has the same clash: its bottom Y-tie closures sit at y = 55, on the first leg's centreline (b = cover + 3Ø/2 = 55).

M. X ties sit one tie diameter above the link layer (new; decided by the implementer). A Y tie and an X tie in the same plane cross wherever they meet: 24 crossings for column 2. Stacking the X ties one tie diameter higher keeps them apart. Their size and spacing are assumed H10-100, because only their count was given.

N. Long and short faces (answered by the user, 2026-10-19; section 5d). (1) The 44 is the total for the two long faces, 22 on each, as the user said. The same pair rule gives 4 on each short face for the 8; the user confirmed the long faces only, so the short split is my reading. (2) The corner bars belong to the long faces. (3) Column 1's cross-ties are 2 X ties and 6 Y ties at 150, with size H10 assumed. The earlier note of 10 cross-ties for column 1 is superseded by these counts (2 + 6 = 8). Column 1's outer link is H10-100 as before; its spacing was not given. Still open: a lap, crank step or jog typed for a level applies to both faces. O. Link zones within a level (open, 2026-10-19): the drawing lists LINKS as TOP, MIDDLE and BOTTOM for each level. The card has one outer link and one pair of cross links per level, so the three zones need a split if they differ. Addressed by section 5e (2026-10-19): the zones are each storey's links and each slab's links.

P. Slabs (answered by the user, 2026-10-19; section 5e). The slab sits below its SFL, and B3 platform is 1500 mm, B2 concourse 1200 mm. A level's slab links are entered on that level. Open: the base's slab (below the member) and the slab above the top level are not modelled, and the links do not yet continue into the base slab as the starters do. If the long and short faces need their own splice lengths, that is a second set of fields.

Starter bend direction: plan_rotation makes the bend point radially outward. For top starters the bar's Pos_Rotation of 90 flips the bend's local direction, so the card computes plan_rotation from the transformed bend direction (not from a fixed offset), which gives the sample's values (outward + 180 for top starters).
