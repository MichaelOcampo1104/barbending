# dxf_to_bbs.py - DXF plan -> barbending rebar_scheduling.csv + *_bbs.json project
# Usage: py scripts/dxf_to_bbs.py inputs/bar_plan_bbs.dxf [--bond poor|good] [--stock 12000] [--out out.csv]
# Convention (written into bar_plan_bbs.dxf):
#   centerline LWPOLYLINE on REBAR-H<dia>  -> bar length + position (WCS mm)
#   cyan tick on REBAR-EXTENT, PERPENDICULAR -> its LENGTH = distribution width
#   TEXT tag  "B1 H32-150-T Z=1000 EXT=1800 HOST=GL23-Roof"
#     MARK H<dia>-<spacing>-<T/B> Z=<z> EXT=<width> HOST=<group>
#     Z = Pos_z (plan has no Z), EXT cross-checks the tick, T = straight top bar
#   closed LWPOLYLINE on CONC-* + tag "C1 SLAB GL23-Roof THK=1000 Z=0 COVB=40 COVT=40"
#     footprint from rect bbox (x/y/lx/ly), lz=THK, z=Z; name MUST equal bars' HOST.
#     Covers live in the tag (COVB=/COVT=, else COV= for both, else --cover 40) and
#     drive auto-level plus link spine length (L = THK - covers unless L= given).
#   bent bars:  add "BENT H=<leg> UP|DOWN", e.g. "B3 H25-150-T BENT H=800 UP Z=500 EXT=1800"
#   links: closed rect on REBAR-LINK-H<dia> (or REBAR-H<dia> + LINK tag for old
#     files) + "LINK A=<a> B=<b>", e.g. "S1 H10-150 LINK A=400 B=600 Z=500 EXT=2000".
#     Length/spine and legs come from the tag (L=/A=/B=), else host rules, else
#     measurement (closed rects); where nothing is measurable (open lines,
#     wall field rects) length defaults 110 and legs default 130, NOTEd.
#     A closed rect on REBAR-LINK-H<dia> already declares a link; HOOK in the
#     layer (or a LINK_HOOK tag) selects the hooked variant.
#     Omit EXT=/SP= to zone the grid from the drawn rect itself (spacing from
#     SP=, else H<dia>-<sp>, else 150); keep EXT= when the field is smaller.
#   hooked links: "LINK_HOOK L=<spine> A=<a> B=<b> [DOUBLE]", e.g.
#     "B1155 H13 LINK_HOOK L=1120 A=160 B=110 SINGLE Z=696 EXT=900x4050 SP=300x450 HOST=C_Links_Hook VIEW=XZ ROT=90"
#     L=/A=/B= override measurement (geometry keeps Pos + direction only);
#     EXT=wxh + SP=sxsy gives a 2-axis grid (qty=round(w/s)+1 per axis);
#     VIEW= sets Plane (default XY), ROT= overrides Pos_Rotation; DOUBLE = hook both ends
#   columns: closed rect on CONC-* + "C1 COLUMN C1 THK=<height> Z=<base> ...".
#     verticals need no centerlines: "V1 VERT 8xH25 [H=<height>] HOST=<col>"
#     (or spacing form "V1 VERT H25-150": count from the ring perimeter) —
#     generates one straight bar per perimeter position (cover inset from the
#     rect), height from H= else host internal depth, seated on base cover,
#     stock-split upward; place the tag inside its column. Column ties: closed
#     rect on REBAR-LINK + "T1 TIE A=<x> B=<y> [SZ=<sp>] [NZ=<n>] HOST=<col>"
#     (A/B measured from the rect when omitted); ties stack in Z from the base
#     cover (count auto from host height unless NZ= given); loop sides are
#     axis-locked to the rect bbox. New shape code 51 (BS8666 closed link).
#     starters: "ST1 STARTER 8xH25 [AT=BOT|TOP] [HB=<bent leg>] HOST=<col>"
#     (count or spacing form like VERT — same spacing keeps laps aligned)
#     makes bent dowels (legs aimed outward from the column center):
#     vertical lap above the SFL plus straight-then-bent below, one good-bond
#     tension lap each way (bent leg HB=, else lap minus straight; straight
#     limited by the lower-slab depth; AT=TOP mirrors into the slab above with
#     the vertical leg hanging down).
#     Stair starters pair DRAWN profiles instead: "SSB1 STARTER H13-150 AT=BOT
#     Z=<level> HOST=<stair>" takes the nearest OPEN polyline on REBAR-H<dia>
#     (the 1:1 section profile: local X = along-run, local Y = up, drawn in a
#     detail zone) verbatim as a stair_starter bar (polyline column, shape 99):
#     anchored by its lowest (BOT) / highest (TOP) vertex at the landing edge,
#     flight legs running up/down the flight, copied across the stair width at
#     SP= (H-sp, else 150; explicit nx in STARTER nxH<dia> wins). Plane XZ (run
#     along X) or YZ (run along Y), rot 0. Z= wins; omitting Z= auto-seats
#     from the stair (BOT: v=0 on the bottom cover; TOP: v=0 hung from the top
#     cover at the high end — needs SLOPE=, else bottom-cover fallback WARNed).
#     Bond BOT good / TOP poor unless GOOD/POOR overrides.
#     Seating: (0,0) lands on the landing-edge steel (BOT bottom steel, TOP
#     top steel). Profiles whose flight-leg root sits at landing level
#     (hairpins) are S-seated — root translated to the edge steel and rotated
#     so the flight leg matches SLOPE= (lengths verbatim, ~1-2 deg kink
#     correction, else the leg would dive through the flight soffit);
#     section-spanners (flight root ~waist depth up) are A-seated verbatim.
#   drawn-circle starters: one bent dowel per CIRCLE (any layer — the DXF
#     is a SECTION: centre X = in-plane horizontal, centre Y = ELEVATION
#     (becomes Pos_z unless Z= wins); the out-of-plane coordinate is NOT in
#     the drawing — give --starter-x (YZ plane: App X of the plane) or
#     --starter-y (XZ plane: App Y of the plane), or per-group X=/Y= in the
#     spec tag. So YZ: Pos=(X-input, circle-X, circle-Y); XZ:
#     Pos=(circle-X, Y-input, circle-Y). Diameter = drawn circle diameter
#     (2x radius, snapped to standard with a NOTE). Nearest
#     direction line (LINE, or OPEN polyline on a non-REBAR layer so real
#     bars are never consumed) gives Length (line length) + aim (line
#     angle); nearest plain spec tag ("L 2000 ROT 90", "=" optional)
#     overrides: L= length, ROT= length compass (0=+X, 90=+Y),
#     [STRAIGHT | BENT] (default BENT), H=/HB= bent leg, H<dia>/DIA=
#     diameter, VIEW=/PLANE= plane, X=/Y=/Z= (or POS X/Y/Z n) position,
#     HOST=, GOOD/POOR. Tags carrying VERT/TIE/RISER/LINK/BENT/STARTER
#     belong to other systems — those circles are skipped with a WARN.
#     Output bent, Rot 0: main Length runs horizontally OUT of the section
#     (XZ section: toward +-Y; YZ section: toward +-X) with the corner/run
#     AT the circle elevation (bend at circle, length after it, upstand
#     dropping below Pos); plan_rotation aims the length from ROT=
#     (XZ phi=aim, YZ phi=aim+270). Auto-plane keeps the length
#     out-of-plane (aim near +-X -> YZ, near +-Y -> XZ); VIEW=/
#     --starter-plane force the record (then ROT should suit that axis);
#     bond good. Missing pieces fall back to --starter-length/--starter-rot/
#     --starter-h/--starter-dia (--starter-dia 0 = dia from circle diameter;
#     --starter-h 0 = max(150, 10*dia)); --starter-plane auto|XZ|YZ and
#     --starter-z override every circle; marks ST<n> (--starter-mark).
#     --starter-lengths "25:2000,40:3000" assigns Length by drawn diameter
#     (tag L= still wins; beats line geometry and --starter-length).
#     Host concrete: tag HOST= wins, else --starter-host (Group carries it).
#     Hook-first: run/corner AT the circle elevation (upstand drops below
#     Pos, like a dowel lapping from underneath);
#     STRAIGHT bars start AT the circle (protrusion origin) and run Length
#     along the aim with no leg. HOOK=END in the tag (or --starter-hook end)
#     trails the leg instead.
#   drawn section profiles: "PB1 PROFILE H25 [HOST=] [PLANE=/VIEW=] [ROT=]
#     [Z=] [X=/Y=] [GOOD|POOR]" pairs the nearest OPEN 3+-pt polyline (any
#     layer except REBAR-EXTENT ticks; paired traces are consumed, never
#     also run as straight chords) into a `profile` bar (shape 99): legs
#     verbatim as [length, compassDeg] parameters (no shape fitting), Pos =
#     first vertex (plan XY verbatim, or section X → App X on XZ / App Y on
#     YZ with out-of-plane from X=/Y= else --starter-x/--starter-y else 0),
#     Z= wins else host bottom cover else 0. Single piece, qty 1x1.
#     DIMENSION entities are annotations only. Tag L= is ignored (legs rule).
#     --profiles auto skips tags entirely: every untagged open 3+-pt
#     REBAR-H/LINK trace (dia from its layer, Plane XY unless --starter-plane,
#     Z from --starter-z else 0) becomes a profile; tagged bars keep legacy
#     straight-chord rows. 2-pt lines always stay straight bars.
#     Distribution (copies start AT Pos, step signed one-sided): tag N= /
#     SP= (signed) / AXIS= X|Y|Z, else --profile-n / --profile-spacing /
#     --profile-axis; axis defaults out-of-plane (XZ->Y, YZ->X, XY->X).
#   walls: closed rect on CONC-* + "W1 WALL W1 THK=<height> Z=<base> ...".
#     Mains are verticals: "WV1 VERT 34xH12 HOST=<wall>" rings the rect like a
#     column (perimeter positions, full internal height, good bond).
#     Distribution is horizontal: drawn plan centerline (one per curtain, at
#     its Y) + "WH1 H12-150 NZ=20 SZ=150 HOST=<wall>" — length from the line,
#     stacked in Z from the base cover (count auto from host height unless
#     NZ= given); bond stays poor unless GOOD=/POOR= overrides.
#     Wall links reuse the slab U-hook shape laid flat: closed rect on
#     REBAR-LINK + "WL1 H13 LINK_HOOK A=<leg> B=<leg> HOST=<wall>" forces
#     Plane XY / ROT 90 (spine across the thickness, legs along the wall;
#     explicit VIEW=/ROT= still win). Spine auto = wall thickness - covers;
#     hook leg (c_length_b) follows thickness-covers, superseding B= (NOTEd).
#     Field = along-wall spread (EXT width or tick, rect-long-side driven,
#     spine centered on cover inside the rect) x stacked height (NZ=/SZ= or
#     host height, capped so the tallest leg stays under the top cover);
#     spacing inputs: SP=<along>x<vertical> (sx, else H-sp; sz from SZ=, else
#     SP= second value, else H-sp), length L= and leg A= explicit (B= follows
#     thickness); a second EXT axis is ignored with a NOTE. Legs trail -X past
#     the rect start when the rect is drawn tight — warned with the overhang.
#   stairs: closed rect on CONC-* + "ST1 STAIR ST1 THK=<waist> Z=<soffit-low>
#     SLOPE=<deg> ..." (rect = plan footprint incl. landings, run along the
#     longer side, low end at the bbox min; Z = soffit at the low end).
#     Riser L-bars need no centerlines: "SR1 RISER 12xH12 [SP=<sp>] HOST=<st>"
#     makes per step one section L (main=going along run + riser down) with
#     copies across the width at SP= (H-sp, else 150), plus one same-size
#     straight bar at the nosing (marks SR1-i-S). Steps divide the run evenly
#     up the member slope.
#     The member box stays flat at the base (hosting only).
#   All member rects and bar lines must be axis-aligned: rotated geometry gets
#   a bbox approximation (lengths/levels/grids skew) with a WARN. Rotate the
#   whole plan instead, or accept the approximation for checking.
#   grids are CENTERED on the drawn anchor via offset_x/offset_y (the app copies
#   one-sided from Pos, but the tick straddles the line / the grid sits mid-rect).
#   Column ties stack the same grid in Z via qty_z/spacing_z (NZ=/SZ= or auto).
#   MARK convention: the mark can be any integer (1, 101, ...) with an optional
#     B/T/S/V prefix; location is declared with keywords so numbering stays free:
#     BOT|TOP side, MAIN|DIST role, LYR=n layer, ON=<parent mark> for stacking,
#     GOOD|POOR bond. E.g. "101 H40-150 BOT MAIN", "102 H40-150 BOT DIST ON=101".
#     Missing pieces fall back to the classic rule (B bottom / T top, odd main /
#     even distribution stacked on N-1, B good / T poor bond).
#     Plan position + direction ALWAYS come from the drawn centerline (Pos =
#     line start, rot = line angle) — the mark never moves a bar in plan.
#     Odd/even mains share one direction per slab; distribution runs across
#     (warned, never blocked).
#     Straight B/T bars auto-level from the host slab (no Z= needed):
#     bottom z = slab.z + cover + dia/2 + layer*(dia+gap), top mirrors from slab top.
#     Layer pairs: (B1,B2)=L1, (B3,B4)=L2... B1 sits on the soffit cover, T1 is topmost.
#     Even marks are the transverse distribution of the preceding odd main and
#     stack one step inside it (B2 rides above B1, T2 below T1) so mats don't clash.
#     Bent/link bars and explicit Z= always win over auto-level.
#   bond --auto (default): B-marks = good, T-marks = poor per EC2 8.2 (top-zone steel
#     casts in poor bond); --bond good|poor forces every bar. Unknown marks default poor.
#     The per-bar value is persisted as bond_condition (links carry '') so the
#     GUI shows each bar's bond instead of only the global default.
# Lap: stock 12 m max; EC2 table mirrors src/bbs/calc.js LAP_TABLE.
import argparse, csv, json, math, re, sys, time
import ezdxf

MASTER = ['Rebar_tag','Bar_mark','Rebar_Type','Shape_Code','Dia',
'Pos_x','Pos_y','Pos_z','Group','Pos_Rotation','Plane',
 'Length of Bar','H','bent_up_down','hook_start','Long_length','Crank_step','Length of Lap',
'bond_condition',
'DC_Lap_Start','DC_Lap_Mid','DC_Tail_Length',
'c_length_a','c_length_b','length','double_hook',
'qty_x','spacing_x','qty_y','spacing_y','qty_z','spacing_z',
 'offset_x','offset_y','offset_z','plan_rotation','feature',
 'polyline','legs',
 'qty','Total Length','Weight_kg','Visible']

LAP = {'good': {13:580,16:760,20:990,25:1290,32:1650,40:2240,50:3170},
       'poor': {13:830,16:1080,20:1420,25:1840,32:2350,40:3200,50:4520}}

def lap_len(dia, bond):
    t = LAP[bond]; ds = sorted(t)
    d = float(dia)
    if d <= ds[0]:
        a,b = ds[0],ds[1]; L = t[a]+(t[b]-t[a])*(d-a)/(b-a)
    elif d >= ds[-1]:
        a,b = ds[-2],ds[-1]; L = t[b]+(t[b]-t[a])*(d-b)/(b-a)
    else:
        i = next(i for i,x in enumerate(ds) if x>=d); a,b = ds[i-1],ds[i]
        L = t[a]+(t[b]-t[a])*(d-a)/(b-a)
    return int(math.ceil(L/10)*10)

TAG = re.compile(r'^\s*([BSTVW]\w+|\d+)?\s*(?:H(\d+)|VERT\s*(?:\d+\s*[x×]\s*)?H(\d+)|\bTIE\b|\bSTARTER\b|\bRISER\b)', re.I)
BTMARK = re.compile(r'^\s*([BT])\s*0*(\d+)\s*$', re.I)
# explicit location keywords (side/role/layer/parent/bond); all optional,
# classic B/T+number inference fills whatever is missing
LOCSIDE = re.compile(r'\b(BOT(?:TOM)?|TOP)\b', re.I)
LOCROLE = re.compile(r'\b(MAIN|DIST(?:RIBUTION)?)\b', re.I)
LOCLYR = re.compile(r'\bLYR\s*=\s*(\d+)', re.I)
LOCON = re.compile(r'\bON\s*=\s*([A-Za-z0-9_-]+)', re.I)
LOCBOND = re.compile(r'\b(GOOD|POOR)\b', re.I)

# bar diameter carried by a tag: plain H<dia> (group 2) or VERT n x H<dia> (group 3)
def _tagdia(tm):
    if not tm:
        return 0
    return int(tm.group(2) or tm.group(3) or 0)
LEGSP = re.compile(r'H\d+\s*-\s*(\d+)', re.I)
TYPEW = re.compile(r'\b(BENT|LINK_HOOK|LINK|C_LINK|HOOK|STRAIGHT|TIE|VERT|STARTER|RISER)\b', re.I)
RISERCOUNT = re.compile(r'\bRISER\s*(\d+)\s*[x×]\s*H(\d+)', re.I)
SLOPERE = re.compile(r'\bSLOPE\s*=\s*([\d.]+)', re.I)
VERTCOUNT = re.compile(r'\bVERT\s*(\d+)\s*[x×]\s*H(\d+)', re.I)
VERTSP = re.compile(r'\bVERT\s+H(\d+)\s*-\s*(\d+)', re.I)
STARTERCOUNT = re.compile(r'\bSTARTER\s*(?:(\d+)\s*[x×]\s*)?H(\d+)(?:\s*-\s*(\d+))?', re.I)
STAT = re.compile(r'\bAT\s*=\s*(TOP|BOT)', re.I)
STARTHB = re.compile(r'\bHB\s*=\s*([\d.]+)', re.I)
TIENZ = re.compile(r'\bNZ\s*=\s*(\d+)', re.I)
TIESZ = re.compile(r'\bSZ\s*=\s*([\d.]+)', re.I)
DOUBLEW = re.compile(r'\b(DOUBLE|DBL|2HOOK)\b', re.I)
LEGZ = re.compile(r'\bZ\s*=\s*([-\d.]+)', re.I)
LEGEXT = re.compile(r'\bEXT\s*=\s*([\d.]+)(?:\s*[x×]\s*([\d.]+))?', re.I)
LEGSP2 = re.compile(r'\bSP\s*=\s*([\d.]+)(?:\s*[x×]\s*([\d.]+))?', re.I)
LEGHOST = re.compile(r'\bHOST\s*=\s*(\S+)', re.I)
LEGLEN = re.compile(r'\bL\s*=\s*([\d.]+)', re.I)
LEGH = re.compile(r'(?:BENT\s+)?H\s*=\s*([\d.]+)', re.I)
UD = re.compile(r'\b(UP|DOWN)\b', re.I)
LEGE = re.compile(r'\bA\s*=\s*([\d.]+)', re.I)
LEGB = re.compile(r'\bB\s*=\s*([\d.]+)', re.I)
LEGVW = re.compile(r'\bVIEW\s*=\s*(XY|XZ|YZ)\b', re.I)
LEGROT = re.compile(r'\bROT\s*=\s*([-\d.]+)', re.I)
CONCTAG = re.compile(r'(C\w+)?\s*(SLAB|BEAM|COLUMN|WALL|FOOTING|STAIR)?\s*(\S+)?\s*THK\s*=\s*([\d.]+).*?Z\s*=\s*([-\d.]+)', re.I)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('dxf'); ap.add_argument('--bond', default='auto', choices=['good','poor','auto'])
    ap.add_argument('--stock', type=float, default=12000)
    ap.add_argument('--cover', type=float, default=40)
    ap.add_argument('--gap', type=float, default=25)
    ap.add_argument('--out', default='')
    ap.add_argument('--starter-length', type=float, default=2000.0)
    ap.add_argument('--starter-rot', type=float, default=0.0)
    ap.add_argument('--starter-h', type=float, default=0.0)
    ap.add_argument('--starter-dia', type=int, default=0)
    ap.add_argument('--starter-plane', default='auto')
    ap.add_argument('--starter-z', type=float, default=None)
    ap.add_argument('--starter-mark', default='ST')
    ap.add_argument('--starter-x', type=float, default=None)
    ap.add_argument('--starter-y', type=float, default=None)
    ap.add_argument('--starter-hook', default='start', choices=['start', 'end'])
    ap.add_argument('--starter-type', default='bent', choices=['bent', 'straight'])
    ap.add_argument('--starter-host', default='')
    ap.add_argument('--starter-lengths', default='')
    ap.add_argument('--profiles', default='tags', choices=['tags', 'auto'])
    ap.add_argument('--profile-n', type=int, default=0)
    ap.add_argument('--profile-spacing', type=float, default=0.0)
    ap.add_argument('--profile-axis', default='')
    a = ap.parse_args()

    doc = ezdxf.readfile(a.dxf); msp = doc.modelspace()
    texts = [(t.plain_text(), t.dxf.insert) for t in msp.query('TEXT MTEXT')
             if TAG.search(t.plain_text())]
    cticks = [(t.plain_text(), t.dxf.insert) for t in msp.query('TEXT MTEXT')
              if CONCTAG.search(t.plain_text()) and not TAG.search(t.plain_text())]
    ticks = [e for e in msp.query('LWPOLYLINE') if e.dxf.layer == 'REBAR-EXTENT']
    # links live on REBAR-LINK-H<dia> (unambiguous); plain REBAR-H<dia> closed
    # rects with a LINK tag still work for backward compatibility
    bars  = [e for e in msp.query('LWPOLYLINE')
             if e.dxf.layer.startswith('REBAR-H') or e.dxf.layer.startswith('REBAR-LINK')]
    rects = [e for e in msp.query('LWPOLYLINE')
             if e.dxf.layer.startswith('CONC-') and e.is_closed]
    print(f'{len(bars)} centerlines, {len(ticks)} extent ticks, {len(texts)} bar tags, {len(rects)} concrete rects, {len(cticks)} concrete tags')

    # ---- concrete rects: bbox footprint + THK/Z tag -> app box member ----
    # Tags pair nearest-first by ascending rect area (consumed), so stacked
    # members (column on slab, shared footprint center) claim their own tag
    # before the big slab does.
    def rect_box(e):
        q = [(p[0], p[1]) for p in e.vertices()]
        xs = [p[0] for p in q]; ys = [p[1] for p in q]
        return min(xs), min(ys), max(xs), max(ys)
    ctag_of, used_ct = {}, set()
    for r in sorted(rects, key=lambda e: (lambda b: (b[2]-b[0])*(b[3]-b[1]))(rect_box(e))):
        qx0, qy0, qx1, qy1 = rect_box(r)
        best, bd = None, None
        for ci, (txt, pos) in enumerate(cticks):
            if ci in used_ct:
                continue
            dd = math.hypot(pos[0]-(qx0+qx1)/2, pos[1]-(qy0+qy1)/2)
            if bd is None or dd < bd:
                best, bd = ci, dd
        if best is not None:
            used_ct.add(best)
            ctag_of[id(r)] = cticks[best][0]
    concretes = []
    for i, r in enumerate(rects):
        pts = [(p[0], p[1]) for p in r.vertices()]
        xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
        x0, y0 = min(xs), min(ys)
        cx, cy = (min(xs)+max(xs))/2, (min(ys)+max(ys))/2
        # rotated rects only get a bbox approximation (levels, run length and
        # grids assume axis alignment) — shout instead of silently skewing
        try:
            eang = [math.degrees(math.atan2(pts[k+1][1]-pts[k][1], pts[k+1][0]-pts[k][0])) % 90
                    for k in range(min(3, len(pts)-1))]
            skew = min(min(a, 90-a) for a in eang)
            if skew > 1.0:
                print(f'WARN {r.dxf.layer}: rect rotated ~{round(skew,1)}° off axis — bbox approximation; draw axis-aligned for exact levels/grids')
        except Exception:
            pass
        ctag = ctag_of.get(id(r), '')
        m = CONCTAG.search(ctag) if ctag else None
        g = m.groups() if m else (None, None, None, None, None)
        cid = (g[0] or f'c{i+1}').strip()
        kind = (g[1] or r.dxf.layer.replace('CONC-', '') or 'Slab').strip()
        name = (g[2] or f'{kind} {cid}').strip()
        thk = float(g[3]) if g[3] else 0.0
        z = float(g[4]) if g[4] else 0.0
        # covers live in the slab tag: COVB=/COVT= win, else COV=, else --cover
        covs = {k.upper(): float(v) for k, v in re.findall(r'COV([BT])?\s*=\s*([\d.]+)', ctag, re.I)}
        cov = covs.get('', a.cover)
        covB, covT = covs.get('B', cov), covs.get('T', cov)
        sl = SLOPERE.search(ctag); slope = float(sl.group(1)) if sl else 0.0
        concretes.append({'id': cid.lower(), 'name': name, 'kind': kind,
            'lx': round(max(xs)-min(xs), 1), 'ly': round(max(ys)-min(ys), 1),
            'lz': thk, 'x': round(x0, 2), 'y': round(y0, 2), 'z': z,
            'covB': covB, 'covT': covT, 'slope': slope})
        print(f'{r.dxf.layer} bbox x={x0:.1f} y={y0:.1f} lx={max(xs)-min(xs):.1f} ly={max(ys)-min(ys):.1f} -> id={cid.lower()} name={name} lz={thk} z={z} covB={covB} covT={covT}')
    cmap = {c['id']: c['id'] for c in concretes} | {c['name'].lower(): c['id'] for c in concretes}
    cobj = {c['id']: c for c in concretes}

    # ---- VERT column verticals: one synthesized zero-length bar per perimeter
    # position from "V<n> VERT n x H<dia> [H=<height>] HOST=<col>" tags. The main
    # loop pairs, auto-seats (base cover), bonds (good) and stock-splits them
    # upward in Z. Place the tag inside its column, away from same-dia bars.
    # STARTER dowels share the ring: "ST<n> STARTER n x H<dia> [AT=TOP|BOT]
    # [HB=<bent leg>] HOST=<col>" makes bent bars (ROT -90, bend at the SFL):
    # vertical lap above the SFL plus straight-then-bent below totaling one
    # good-bond tension lap each way; bent legs point at the column center.
    from types import SimpleNamespace
    class _VBar:
        def __init__(self, layer, x, y, idx, vmark, ov=None):
            self.dxf = SimpleNamespace(layer=layer)
            self.is_closed = False
            self._xy = (round(x, 2), round(y, 2))
            self._vert_idx = idx
            self._vert_mark = vmark
            self._ov = ov
        def vertices(self):
            return [self._xy, self._xy]
    def host_for(ttxt, tpos, what):
        mhst = LEGHOST.search(ttxt); vhost = mhst.group(1) if mhst else ''
        vslab = None
        if vhost and vhost.lower() in cmap:
            vslab = cobj.get(cmap[vhost.lower()])
        if vslab is None:
            for cc in concretes:
                if cc['x'] <= tpos[0] <= cc['x']+cc['lx'] and cc['y'] <= tpos[1] <= cc['y']+cc['ly']:
                    vslab = cc; break
        if vslab is None and concretes:
            vslab = concretes[0]
        if vslab is None:
            print(f'WARN {what}: no concrete host — skipped')
        return vslab
    def ring_pts(sl, ins, n):
        x0b, y0b = sl['x']+ins, sl['y']+ins
        x1b, y1b = sl['x']+sl['lx']-ins, sl['y']+sl['ly']-ins
        wb, hb = max(0.0, x1b-x0b), max(0.0, y1b-y0b)
        per = 2*(wb+hb) or 1.0
        out = []
        for i in range(max(1, n)):
            dd = per*i/max(1, n)
            if dd < wb: px, py = x0b+dd, y0b
            elif dd < wb+hb: px, py = x1b, y0b+(dd-wb)
            elif dd < 2*wb+hb: px, py = x1b-(dd-wb-hb), y1b
            else: px, py = x0b, y1b-(dd-2*wb-hb)
            out.append((px, py))
        return out
    for ttxt, tpos in texts:
        vm = VERTCOUNT.search(ttxt)
        sm = None if vm else VERTSP.search(ttxt)
        if not vm and not sm:
            if 'VERT' in ttxt.upper():
                print(f'WARN VERT tag {ttxt[:44]!r} needs VERT nxH<dia> or VERT H<dia>-<sp> — skipped')
            continue
        tm = TAG.search(ttxt); vmark = tm.group(1) if tm and tm.group(1) else None
        if not vmark or vmark.upper() in ('VERT', 'TIE', 'LINK', 'STARTER', 'BENT', 'HOOK'):
            print(f'WARN VERT tag {ttxt[:44]!r} needs a mark like V1 — skipped')
            continue
        if vm:
            vn, vdia, vsp = max(1, int(vm.group(1))), int(vm.group(2)), 0
        else:
            vdia, vsp, vn = int(sm.group(1)), int(sm.group(2)), 0
        vslab = host_for(ttxt, tpos, vmark)
        if vslab is None:
            continue
        ins = max(1.0, vslab.get('covB', a.cover) + vdia/2)
        if not vn:
            # spacing form: count from the ring perimeter (closed loop, no +1)
            x0t, y0t = vslab['x']+ins, vslab['y']+ins
            x1t, y1t = vslab['x']+vslab['lx']-ins, vslab['y']+vslab['ly']-ins
            vn = max(4, round(2*(max(0.0, x1t-x0t)+max(0.0, y1t-y0t))/max(1, vsp)))
            print(f'NOTE {vmark}: spacing {vsp} -> {vn} bars')
        for i, (px, py) in enumerate(ring_pts(vslab, ins, vn)):
            bars.append(_VBar(f'REBAR-VERT-H{vdia}', px, py, i, vmark))
        print(f'{vmark}: {vn} vertical H{vdia} around {vslab["name"]} (inset {round(ins,1)})')
    for ttxt, tpos in texts:
        sm = STARTERCOUNT.search(ttxt)
        if not sm:
            if 'STARTER' in ttxt.upper():
                print(f'WARN STARTER tag {ttxt[:44]!r} needs STARTER [nx]H<dia>[-<sp>] — skipped')
            continue
        tm = TAG.search(ttxt); smark = tm.group(1) if tm and tm.group(1) else None
        if not smark or smark.upper() in ('VERT', 'TIE', 'LINK', 'STARTER', 'BENT', 'HOOK'):
            print(f'WARN STARTER tag {ttxt[:44]!r} needs a mark like ST1 — skipped')
            continue
        sCount = int(sm.group(1)) if sm.group(1) else 0
        sn, sdia = max(1, sCount) if sCount else 0, int(sm.group(2))
        ssp = int(sm.group(3)) if sm.group(3) else 0
        col = host_for(ttxt, tpos, smark)
        if col is None:
            continue
        if str(col.get('kind') or '').upper() == 'STAIR':
            continue  # stair starters pair drawn profiles below, not column dowels
        mat = STAT.search(ttxt); atop = bool(mat and mat.group(1).upper() == 'TOP')
        sfl = col['z'] + col['lz'] if atop else col['z']
        lap = lap_len(sdia, 'good')
        hleg_min = max(10*sdia, 150)
        hb = STARTHB.search(ttxt); hleg_fix = float(hb.group(1)) if hb else 0.0
        cx, cy = col['x']+col['lx']/2, col['y']+col['ly']/2
        if atop:
            # true mirror: bend sits high in the slab above, vertical leg hangs
            # down past the top SFL by one lap to meet the column steel
            upper = None
            for cc in concretes:
                if cc is not col and cc['x'] <= cx <= cc['x']+cc['lx'] \
                        and cc['y'] <= cy <= cc['y']+cc['ly'] \
                        and abs(cc['z'] - (col['z']+col['lz'])) <= 2.0:
                    upper = cc; break
            if upper is None:
                # slab-free mirror: assume the embed depth (bend floats above
                # the head where the upper slab would confine it)
                print(f'WARN {smark}: no slab above {col["name"]} — bend floats unconfined')
                sbelow, bend, rotO, legO = lap - hleg_min, sfl + (lap - hleg_min), 90.0, 180.0
            else:
                # bend fixed at the upper cover; straight fills down to the SFL
                # so below-SFL vertical is exactly one lap whatever the depth
                covTU = upper.get('covT', a.cover)
                bend = upper['z']+upper['lz'] - covTU - sdia/2
                sbelow, rotO, legO = max(0.0, bend - (col['z']+col['lz'])), 90.0, 180.0
            hleg = hleg_fix or max(hleg_min, lap - sbelow)
            mainL, pz = lap + sbelow, bend - (lap + sbelow)
        else:
            lower = None
            for cc in concretes:
                if cc is not col and cc['x'] <= tpos[0] <= cc['x']+cc['lx'] \
                        and cc['y'] <= tpos[1] <= cc['y']+cc['ly'] \
                        and abs(cc['z']+cc['lz'] - col['z']) <= 2.0:
                    lower = cc; break
            if lower is None:
                sbelow = lap - hleg_min
                print(f'WARN {smark}: no slab under {col["name"]} — bend hangs below SFL')
            else:
                sint = lower['lz'] - lower.get('covT', 0) - lower.get('covB', 0)
                sbelow = max(0.0, min(lap - hleg_min, sint - sdia))
            hleg = hleg_fix or (lap - sbelow)
            mainL, pz, rotO, legO = lap + sbelow, sfl + lap, -90.0, 0.0
        ins = max(1.0, col.get('covB', a.cover) + sdia/2)
        if not sn:
            # spacing form: same ring count as VERT so laps align
            x0t, y0t = col['x']+ins, col['y']+ins
            x1t, y1t = col['x']+col['lx']-ins, col['y']+col['ly']-ins
            eff = ssp or 150
            sn = max(4, round(2*(max(0.0, x1t-x0t)+max(0.0, y1t-y0t))/max(1, eff)))
            print(f'NOTE {smark}: spacing {eff} -> {sn} starters')
        for i, (px, py) in enumerate(ring_pts(col, ins, sn)):
            prot = round((math.degrees(math.atan2(py-cy, px-cx)) + legO) % 360, 1)
            bars.append(_VBar(f'REBAR-VERT-H{sdia}', px, py, i, smark,
                {'starter': True, 'plane': 'XZ', 'rot': rotO,
                 'L': round(mainL, 1), 'H': round(hleg, 1),
                 'z': round(pz, 1), 'plan_rotation': prot}))
        shape = 'mirror' if (atop and upper is not None) else 'dowel-up'
        print(f'{smark}: {sn} starter H{sdia} at {"TOP" if atop else "BOT"} SFL={round(sfl,1)} [{shape}] '
              f'(vert {lap} + straight {round(sbelow,1)} + bent {round(hleg,1)})')

    # ---- stair starters: drawn section profiles used verbatim ----
    # "SSB<n> STARTER H<dia>-<sp> AT=BOT|TOP Z=<level> HOST=<stair>" tags pair
    # the nearest OPEN polyline on REBAR-H<dia> (1:1 section profile, X =
    # along-run, Y = up, drawn in a detail zone). Anchored by the lowest
    # (BOT) / highest (TOP) vertex at the landing edge, flight legs running
    # up/down the flight, copied across the stair width. Emits stair_starter
    # rows (polyline column) with Plane XZ (run along X) / YZ (run along Y).
    stair_used = set()
    for ttxt, tpos in texts:
        sm = STARTERCOUNT.search(ttxt)
        if not sm:
            continue
        tm = TAG.search(ttxt); smark = tm.group(1) if tm and tm.group(1) else None
        if not smark or smark.upper() in ('VERT', 'TIE', 'LINK', 'STARTER', 'RISER', 'BENT', 'HOOK'):
            continue  # column loop already warned these
        st = host_for(ttxt, tpos, smark)
        if st is None:
            continue
        if str(st.get('kind') or '').upper() != 'STAIR':
            continue  # column dowels handled above
        sdia = int(sm.group(2))
        ssp = int(sm.group(3)) if sm.group(3) else 0
        if not ssp:
            ms0 = LEGSP2.search(ttxt)
            ssp = int(float(ms0.group(1))) if ms0 and ms0.group(1) else 0
        ssp = ssp or 150
        sn = int(sm.group(1)) if sm.group(1) else 0
        smat = STAT.search(ttxt); satop = bool(smat and smat.group(1).upper() == 'TOP')
        cand, bd = None, None
        for b in bars:
            if id(b) in stair_used or b.is_closed or getattr(b, '_vert_idx', None) is not None:
                continue
            if not b.dxf.layer.startswith('REBAR-H'):
                continue
            lay = re.search(r'H(\d+)', b.dxf.layer, re.I)
            if not lay or int(lay.group(1)) != sdia:
                continue
            q = [(p[0], p[1]) for p in b.vertices()]
            if not q:
                continue
            dd = min(math.hypot(tpos[0] - px, tpos[1] - py) for px, py in q)
            if bd is None or dd < bd:
                cand, bd = b, dd
        if cand is None:
            print(f'WARN {smark}: no open H{sdia} profile near the tag — starter skipped')
            continue
        stair_used.add(id(cand))
        prof = [(float(p[0]), float(p[1])) for p in cand.vertices()]
        if satop:
            ai = max(range(len(prof)), key=lambda i: (prof[i][1], -prof[i][0]))
        else:
            ai = min(range(len(prof)), key=lambda i: (prof[i][1], prof[i][0]))
        au, av = prof[ai]
        if satop:
            rel = [(-(u - au), v - av) for u, v in prof]
        else:
            rel = [(u - au, v - av) for u, v in prof]
        sL = 0.0
        for i in range(1, len(rel)):
            sL += math.hypot(rel[i][0] - rel[i - 1][0], rel[i][1] - rel[i - 1][1])
        sL = round(sL, 1)
        sSlope = st.get('slope', 0) or 0.0
        # Seating: the flight lap must bear on the flight steel, but
        # schematics draw the landing/hook zone loose (hook legs flat while
        # true steel climbs ~run.tan(slope)). Longest segment = flight leg;
        # S = its hook-side end (endpoint nearer the anchor A=(0,0)).
        #   S-seat (|sv| <= 150: hairpins whose flight legs start at landing
        #     level): root S at the landing-edge steel and rotate the profile
        #     about S so the flight leg matches the stair slope (lengths and
        #     hook angles verbatim, ~1-2 deg kink correction).
        #   A-seat (section-spanners whose flight root already rides ~waist
        #     depth above the landing legs): anchor A at the landing-edge
        #     steel, verbatim, no rotation.
        li = max(range(1, len(rel)),
                 key=lambda i: math.hypot(rel[i][0] - rel[i - 1][0], rel[i][1] - rel[i - 1][1]))
        dA0 = math.hypot(rel[li][0], rel[li][1])
        dA1 = math.hypot(rel[li - 1][0], rel[li - 1][1])
        si = li - 1 if dA1 <= dA0 else li
        sx, sy = rel[si]
        drot = 0.0
        seat = 'A-seat'
        if abs(sy) <= 150:
            leg_ang = math.degrees(math.atan2(rel[li][1] - rel[li - 1][1],
                                              rel[li][0] - rel[li - 1][0]))
            steel_ang = (180.0 + sSlope) if satop else sSlope
            drot = (steel_ang - leg_ang + 90.0) % 180.0 - 90.0
            th = math.radians(drot)
            c, s_ = math.cos(th), math.sin(th)
            rel = [((u - sx) * c - (v - sy) * s_, (u - sx) * s_ + (v - sy) * c)
                   for u, v in rel]
            seat = 'S-seat'
        if st['ly'] >= st['lx']:
            srun, swidth = st['ly'], st['lx']
            srunMin, swidthMin, salongX = st['y'], st['x'], False
        else:
            srun, swidth = st['lx'], st['ly']
            srunMin, swidthMin, salongX = st['x'], st['y'], True
        nqy = sn or max(1, int(round(swidth / ssp)) + 1)
        acrossPos = round(swidthMin + swidth / 2, 2)
        acrossOff = round(-(nqy - 1) * ssp / 2, 1)
        runPos = round((srunMin + srun) if satop else srunMin, 2)
        if salongX:
            qx0, qy0 = runPos, acrossPos
            gox, goy = 0.0, acrossOff
            gqx, gqy, gsx, gsy = 1, nqy, 0, ssp
        else:
            qx0, qy0 = acrossPos, runPos
            gox, goy = acrossOff, 0.0
            gqx, gqy, gsx, gsy = nqy, 1, ssp, 0
        smz = LEGZ.search(ttxt)
        if smz:
            sz, zsrc = float(smz.group(1)), 'tag'
        elif satop and sSlope > 0:
            sz = round(st['z'] + srun * math.tan(math.radians(sSlope)) + st['lz']
                       - st.get('covT', a.cover) - sdia / 2, 1)
            zsrc = 'auto-topLand'
            print(f'NOTE {smark}: no Z= — hanging v=0 at top landing steel {sz}')
        else:
            sz = round(st['z'] + st.get('covB', a.cover) + sdia / 2, 1)
            zsrc = 'auto-stairBot'
            if satop:
                print(f'WARN {smark}: no Z= and no SLOPE= — seating at bottom cover {sz}')
            else:
                print(f'NOTE {smark}: no Z= — seating v=0 at bottom landing steel {sz}')
        sbond = 'poor' if satop else 'good'
        sov = {'stair': True, 'rtype': 'stair_starter', 'nosuffix': True,
               'plane': 'XZ' if salongX else 'YZ', 'rot': 0.0,
               'L': sL, 'z': sz, 'zsrc': zsrc,
               'poly': [[round(u, 1), round(v, 1)] for u, v in rel],
               'qty_x': gqx, 'spacing_x': gsx, 'qty_y': gqy, 'spacing_y': gsy,
               'offset_x': gox, 'offset_y': goy, 'stairbond': sbond}
        bars.append(_VBar(f'REBAR-VERT-H{sdia}', qx0, qy0, 0, smark, dict(sov)))
        print(f'{smark}: stair starter H{sdia} at {"TOP" if satop else "BOT"} of {st["name"]} '
              f'(profile {len(rel)}pt L={sL} x{nqy} @ {ssp}, z={sz} {zsrc}, {sbond}, '
              f'{seat} drot={drot:.1f})')

    # ---- stair risers: one bent L-bar (facing down) per step from
    # "SR<n> RISER n x H<dia> [SP=<sp>] HOST=<stair>" tags. Steps divide the
    # run evenly up the member slope (run along the longer plan axis, low end
    # at the bbox min); each step gets main=going + H=riser with copies
    # across the width. The member box stays flat at the base (hosting only).
    for ttxt, tpos in texts:
        rm = RISERCOUNT.search(ttxt)
        if not rm:
            if 'RISER' in ttxt.upper():
                print(f'WARN RISER tag {ttxt[:44]!r} needs RISER nxH<dia> — skipped')
            continue
        tm = TAG.search(ttxt); rmark = tm.group(1) if tm and tm.group(1) else None
        if not rmark or rmark.upper() in ('VERT', 'TIE', 'LINK', 'STARTER', 'RISER', 'BENT', 'HOOK'):
            print(f'WARN RISER tag {ttxt[:44]!r} needs a mark like SR1 — skipped')
            continue
        rn, rdia = max(1, int(rm.group(1))), int(rm.group(2))
        rst = host_for(ttxt, tpos, rmark)
        if rst is None:
            continue
        rslope = rst.get('slope', 0) or 0.0
        if rslope <= 0:
            print(f'WARN {rmark}: host {rst["name"]} has no SLOPE= — risers skipped')
            continue
        if rst['ly'] >= rst['lx']:
            run, width = rst['ly'], rst['lx']
            runMin, widthMin, alongX = rst['y'], rst['x'], False
        else:
            run, width = rst['lx'], rst['ly']
            runMin, widthMin, alongX = rst['x'], rst['y'], True
        if run <= 0:
            print(f'WARN {rmark}: zero run — risers skipped')
            continue
        sp0 = LEGSP.search(ttxt); rsp = int(sp0.group(1)) if sp0 else 0
        if not rsp:
            ms2 = LEGSP2.search(ttxt)
            rsp = int(float(ms2.group(1))) if ms2 and ms2.group(1) else 0
        rsp = rsp or 150
        going = run/rn
        rise = run*math.tan(math.radians(rslope))/rn
        # nosing steel per step: section L (main=going along run + riser down,
        # copies across the width) plus one TRANSVERSE straight bar across the
        # full width at the nosing line (marks SR1-i-S) — perpendicular to the
        # L main so it actually renders instead of hiding inside it.
        # The L corner sits ON the straight bar (rot 180 puts the bend at the
        # main start = nosing); the flat leg trails back uphill.
        qw = max(1, int(width//rsp)+1)
        off = round((width-(qw-1)*rsp)/2, 1)
        tOff = max(1.0, rst.get('covB', a.cover) + rdia/2)
        tLen = max(rdia*2, round(width - 2*tOff, 1))
        base = rst['z'] + rst['lz']
        for i in range(rn):
            zi = round(base + (i+1)*rise, 1)
            # L corner at the nosing, flat leg back uphill (rot 180 + 'up'
            # nets main-backwards with the leg still pointing down)
            qx0 = round(runMin + (i+1)*going, 2) if alongX else widthMin
            qy0 = widthMin if alongX else round(runMin + (i+1)*going, 2)
            ov = {'riser': True, 'plane': 'XZ' if alongX else 'YZ', 'rot': 180.0,
                  'L': round(going, 1), 'H': round(rise, 1), 'z': zi,
                  'bent_up_down': 'up'}
            if alongX:
                ov.update(qty_x=1, spacing_x=0, qty_y=qw, spacing_y=rsp,
                          offset_x=0.0, offset_y=off)
            else:
                ov.update(qty_x=qw, spacing_x=rsp, qty_y=1, spacing_y=0,
                          offset_x=off, offset_y=0.0)
            bars.append(_VBar(f'REBAR-VERT-H{rdia}', qx0, qy0, i, rmark, dict(ov)))
            # transverse companion: face-to-face across the full width at the
            # same nosing and level, so every L corner lands on it
            if alongX:
                qx, qy = round(runMin + i*going, 2), widthMin
                splane = 'YZ'
            else:
                qx, qy = widthMin, round(runMin + i*going, 2)
                splane = 'XZ'
            bars.append(_VBar(f'REBAR-VERT-H{rdia}', qx, qy, i, rmark,
                              dict(riser=True, plane=splane, rot=0.0,
                                   rtype='straight', msuffix='-S',
                                   L=round(width, 1), z=zi)))
        print(f'{rmark}: {rn} nosing H{rdia} on {rst["name"]} '
              f'(L going {round(going,1)} + H riser {round(rise,1)} + straight, x{qw} @ {rsp})')

    # ---- stair distribution: one full-width horizontal bar per slope step from
    # "SD1 H12-150 DIST [NZ=<n>] [SZ=<sp>] HOST=<stair>" tags (no centerlines;
    # drawn bars never pair these tags). Steps run from the low end at SP
    # pitch (NZ= count wins, even); each row sits on the mains (main dia from
    # the same host's MAIN tag, else cover-only) so laps bear correctly.
    for ttxt, tpos in texts:
        dm = LOCROLE.search(ttxt)
        if not (dm and dm.group(1).upper().startswith('DIST')):
            continue
        tm = TAG.search(ttxt); dmark = tm.group(1) if tm and tm.group(1) else None
        if not dmark:
            continue
        dh = host_for(ttxt, tpos, dmark)
        if dh is None or str(dh.get('kind') or '').upper() != 'STAIR':
            continue
        ddia = _tagdia(tm)
        if not ddia:
            print(f'WARN {dmark}: distribution needs H<dia> — skipped')
            continue
        dslope = dh.get('slope', 0) or 0.0
        if dslope <= 0:
            print(f'WARN {dmark}: host {dh["name"]} has no SLOPE= — skipped')
            continue
        if dh['ly'] >= dh['lx']:
            drun, dwidth = dh['ly'], dh['lx']
            drunMin, dwidthMin, dalongX = dh['y'], dh['x'], False
        else:
            drun, dwidth = dh['lx'], dh['ly']
            drunMin, dwidthMin, dalongX = dh['x'], dh['y'], True
        dsp0 = LEGSP.search(ttxt); dsp = int(dsp0.group(1)) if dsp0 else 0
        if not dsp:
            dms = LEGSP2.search(ttxt)
            dsp = int(float(dms.group(1))) if dms and dms.group(1) else 0
        dsz = TIESZ.search(ttxt); dsp = float(dsz.group(1)) if dsz else (dsp or 150)
        dnz = TIENZ.search(ttxt); dnz = int(dnz.group(1)) if dnz else 0
        dmside = LOCSIDE.search(ttxt)
        dtop = bool(dmside and dmside.group(1).upper().startswith('TOP'))
        slopeLen = drun/math.cos(math.radians(dslope))
        nn = dnz or max(1, int(slopeLen//dsp)+1)
        # stacking main: same-side MAIN first (TOP transverse hangs under TOP
        # mains), then side-less, else cover-only
        mainDia = 0
        for want in (('TOP' if dtop else 'BOT'), None):
            for ttx2, _ in texts:
                if ttx2 == ttxt:
                    continue
                rm2 = LOCROLE.search(ttx2)
                if not (rm2 and rm2.group(1).upper().startswith('MAIN')):
                    continue
                sm2 = LOCSIDE.search(ttx2)
                side2 = ('TOP' if sm2.group(1).upper().startswith('TOP')
                         else 'BOT') if sm2 else None
                if side2 != want:
                    continue
                tm2 = TAG.search(ttx2)
                mh2 = LEGHOST.search(ttx2); hh2 = mh2.group(1) if mh2 else ''
                same = hh2 and hh2.lower() in cmap and cobj.get(cmap[hh2.lower()]) is dh
                if same and _tagdia(tm2):
                    mainDia = _tagdia(tm2)
                    break
            if mainDia > 0:
                break
        dinset = max(1.0, dh.get('covB', a.cover) + ddia/2)
        dlen = max(ddia*2, round(dwidth - 2*dh.get('covB', a.cover) - ddia, 1))
        for j in range(nn):
            dd = (slopeLen*j/max(1, nn-1)) if dnz and nn > 1 else j*dsp
            if dtop:
                zalong = (dh['z'] + dh['lz'] + dd*math.sin(math.radians(dslope))
                          - dh.get('covT', a.cover) - ddia/2)
                if mainDia > 0:
                    zalong -= mainDia + a.gap
            else:
                zalong = dh['z'] + dh.get('covB', a.cover) + ddia/2 + dd*math.sin(math.radians(dslope))
                if mainDia > 0:
                    zalong += mainDia + a.gap
            px = round(drunMin + dd*math.cos(math.radians(dslope)), 2) if dalongX else round(dwidthMin + dinset, 2)
            py = round(dwidthMin + dinset, 2) if dalongX else round(drunMin + dd*math.cos(math.radians(dslope)), 2)
            bars.append(_VBar(f'REBAR-VERT-H{ddia}', px, py, j, dmark,
                {'sdist': True, 'plane': 'YZ' if dalongX else 'XZ', 'rot': 0.0,
                 'L': dlen, 'z': round(zalong, 1)}))
        print(f'{dmark}: {nn} transverse H{ddia} on {dh["name"]} '
              f'(L={dlen} {"even" if dnz else "@"+str(dsp)})')

    # ---- drawn-circle starters: one bent dowel per CIRCLE (see header) ----
    STD_DIA = (10, 13, 16, 20, 25, 32, 40, 50)
    circles = [e for e in msp.query('CIRCLE')]
    _bar_ids = set(id(e) for e in bars)
    dir_lines = [e for e in msp.query('LINE')]
    dir_lines += [e for e in msp.query('LWPOLYLINE')
                  if (not e.is_closed and id(e) not in _bar_ids
                      and not e.dxf.layer.startswith('REBAR-H')
                      and not e.dxf.layer.startswith('REBAR-LINK'))]
    alltexts = [(t.plain_text(), t.dxf.insert) for t in msp.query('TEXT MTEXT')]
    _SKIPW = re.compile(r'\b(VERT|TIE|RISER|LINK|C_LINK|HOOK|BENT|STARTER)\b', re.I)
    _SL = re.compile(r'\bL\s*=?\s*([\d.]+)', re.I)
    _SROT = re.compile(r'\bROT\s*=?\s*([-\d.]+)', re.I)
    _SH = re.compile(r'\bH\s*=\s*([\d.]+)', re.I)
    _SHB = re.compile(r'\bHB\s*=?\s*([\d.]+)', re.I)
    _SDIA = re.compile(r'\bDIA\s*=?\s*H?(\d+)', re.I)
    _SHDIA = re.compile(r'H(\d+)(?:\s|$|-|$)', re.I)
    def _segdist(px, py, ax, ay, bx, by):
        vx, vy = bx-ax, by-ay
        vv = vx*vx+vy*vy or 1.0
        tt = max(0.0, min(1.0, ((px-ax)*vx+(py-ay)*vy)/vv))
        return math.hypot(px-(ax+tt*vx), py-(ay+tt*vy))
    def _line_geom(e):
        try:
            if e.dxftype() == 'LINE':
                a, b = e.dxf.start, e.dxf.end
            else:
                q = [(p[0], p[1]) for p in e.vertices()]
                a, b = q[0], q[-1]
            ln = math.hypot(b[0]-a[0], b[1]-a[1])
            an = math.degrees(math.atan2(b[1]-a[1], b[0]-a[0])) if ln else 0.0
            return ln, an
        except Exception:
            return None
    class _CBar:
        def __init__(self, layer, x, y, mark, ov):
            self.dxf = SimpleNamespace(layer=layer)
            self.is_closed = False
            self._xy = (round(x, 2), round(y, 2))
            self._circ = True
            self._circ_mark = mark
            self._ov = ov
        def vertices(self):
            return [self._xy, self._xy]
    if circles:
        print(f'{len(circles)} starter circles, {len(dir_lines)} direction lines')
    # dia-driven lengths: --starter-lengths "25:2000,40:3000" (H prefix and
    # = allowed) assigns Length by drawn diameter; tag L= still wins, the
    # table beats line geometry and the flat --starter-length default
    _len_by_dia = {}
    if a.starter_lengths:
        for _dd, _ll in re.findall(r'H?(\d+)\s*[:=]\s*([\d.]+)', a.starter_lengths, re.I):
            _len_by_dia[int(_dd)] = float(_ll)
    if _len_by_dia:
        print('dia lengths: ' + ', '.join(f'H{d}={L:.0f}' for d, L in sorted(_len_by_dia.items())))
    # counts of explicitly-given --starter-x/--starter-y flags that a row's
    # plane cannot use (YZ needs X, XZ needs Y, XY needs neither) — warned
    # once at the end instead of silently dropping the flag
    _flagign = [0, 0]
    _sidx = 0
    _oopdef = 0
    for _ce in sorted(circles,
                      key=lambda e: (round(float(e.dxf.center[0]), 2),
                                     round(float(e.dxf.center[1]), 2))):
        # section convention: DXF X = in-plane horizontal, DXF Y = elevation
        # (true DXF Z is ignored)
        _cx, _cy = float(_ce.dxf.center[0]), float(_ce.dxf.center[1])
        _cr = float(_ce.dxf.radius)
        _spec, _sd, _sd2, _spec2 = '', None, None, ''
        _cand = []
        for _tx, _ps in alltexts:
            if _SL.search(_tx) or _SROT.search(_tx):
                _cand.append((math.hypot(_ps[0]-_cx, _ps[1]-_cy), _tx))
        _cand.sort(key=lambda r: r[0])
        if _cand:
            (_sd, _spec) = _cand[0]
            if len(_cand) > 1:
                _sd2, _spec2 = _cand[1][0], _cand[1][1]
        if _sd2 is not None and _sd2 - _sd < 400:
            # same guess-guard as bar tags: a close runner-up means the zone
            # boundary runs between the tags — move the tag deeper into its zone
            print(f'WARN circle @ ({_cx:.0f},{_cy:.0f}): tag {_spec[:40]!r} wins by '
                  f'{_sd2-_sd:.0f} over {_spec2[:40]!r} — move the tag closer to its zone')
        if _spec and _SKIPW.search(re.sub(r'\bHOOK\s*=?\s*(START|END)\b|\bHOOKSTART\b|\bBENT\b|\bSTRAIGHT\b', '', _spec, flags=re.I)):
            print(f'WARN circle @ ({_cx:.0f},{_cy:.0f}): tag {_spec[:44]!r} belongs to another system — skipped')
            continue
        # bar type: STRAIGHT | BENT in the tag wins, else --starter-type
        # (default bent); straight bars start at the circle (protrusion
        # origin) and run Length along the aim with no leg
        _mT = re.search(r'\b(STRAIGHT|BENT)\b', _spec, re.I)
        if _mT:
            _want_straight = _mT.group(1).upper() == 'STRAIGHT'
        else:
            _want_straight = str(a.starter_type).lower() == 'straight'
        # hook side: HOOK=START|END (or HOOKSTART) in the tag wins, else
        # --starter-hook (default start: upstand at the circle, length after)
        _mHK = re.search(r'\bHOOK\s*=?\s*(START|END)\b|\bHOOKSTART\b', _spec, re.I)
        if _mHK:
            _hook = 'yes' if (_mHK.group(1) or 'START').upper() == 'START' else 'no'
        else:
            _hook = 'yes' if str(a.starter_hook).lower() == 'start' else 'no'
        _bl, _ba, _bd = 0.0, None, None
        for _le in dir_lines:
            _g = _line_geom(_le)
            if not _g:
                continue
            _ln, _an = _g
            try:
                if _le.dxftype() == 'LINE':
                    _ax, _ay = float(_le.dxf.start[0]), float(_le.dxf.start[1])
                    _bx, _by = float(_le.dxf.end[0]), float(_le.dxf.end[1])
                else:
                    _q = [(p[0], p[1]) for p in _le.vertices()]
                    _ax, _ay, _bx, _by = _q[0][0], _q[0][1], _q[-1][0], _q[-1][1]
            except Exception:
                continue
            _dd = _segdist(_cx, _cy, _ax, _ay, _bx, _by)
            if _bd is None or _dd < _bd:
                _bd, _bl, _ba = _dd, _ln, _an
        _mL = _SL.search(_spec); _mR = _SROT.search(_spec)
        _mH = _SHB.search(_spec) or _SH.search(_spec)
        _mD = _SDIA.search(_spec); _mHd = _SHDIA.search(_spec)
        if _mD:
            _dia = int(_mD.group(1))
        elif _mHd:
            _dia = int(_mHd.group(1))
        elif a.starter_dia:
            _dia = int(a.starter_dia)
        else:
            _d2 = _cr*2
            _dia = min(STD_DIA, key=lambda d: abs(d-_d2))
            if abs(_dia-_d2) > 1.0:
                print(f'NOTE circle @ ({_cx:.0f},{_cy:.0f}): r={_cr:.0f} -> nearest H{_dia}')
        if _mL:
            _L, _Lsrc = float(_mL.group(1)), 'tag'
        elif _dia in _len_by_dia:
            _L, _Lsrc = _len_by_dia[_dia], 'dia'
        elif _bl:
            _L, _Lsrc = round(_bl, 1), 'line'
        else:
            _L, _Lsrc = float(a.starter_length), 'default'
            print(f'NOTE circle @ ({_cx:.0f},{_cy:.0f}): no line/tag length — default {_L:.0f}')
        if _mR:
            _aim = float(_mR.group(1)) % 360.0
        elif _ba is not None:
            _aim = round(_ba % 360.0, 1)
        else:
            _aim = float(a.starter_rot) % 360.0
        if _mH:
            _H = float(_mH.group(1))
        elif a.starter_h:
            _H = float(a.starter_h)
        else:
            _H = round(max(150.0, 10*_dia), 1)
        _mUD = UD.search(_spec)
        _sdir = -1.0 if (_mUD and _mUD.group(1).upper() == 'DOWN') else 1.0
        _mv = LEGVW.search(_spec)
        _mp = re.search(r'\bPLANE\s*=?\s*(XY|XZ|YZ)\b', _spec, re.I)
        if _mv:
            _pl = _mv.group(1).upper()
        elif _mp:
            _pl = _mp.group(1).upper()
        elif str(a.starter_plane).upper() in ('XZ', 'YZ'):
            _pl = str(a.starter_plane).upper()
        else:
            # auto-plane keeps the length OUT of the section: aim along +-X
            # lives on a YZ record, aim along +-Y on an XZ record
            _alongX = (abs(math.cos(math.radians(_aim)))
                       >= abs(math.sin(math.radians(_aim))))
            _pl = 'YZ' if _alongX else 'XZ'
        if _pl == 'XZ':
            _prot = round(_aim % 360.0, 1)  # local X already along App X
        else:
            _prot = round((_aim+270.0) % 360.0, 1)  # local X along App Y
        _mz = (LEGZ.search(_spec)
               or re.search(r'\bPOS(?:ITION)?\s+Z\s*=?\s*([-\d.]+)', _spec, re.I))
        if _mz:
            _z, _zsrc = float(_mz.group(1)), 'tag'
        elif a.starter_z is not None:
            _z, _zsrc = float(a.starter_z), 'default'
        else:
            _z, _zsrc = round(_cy, 1), 'circle-Y'
        if not _want_straight and _hook == 'yes':
            # hook-first: the run/corner sits AT the circle elevation (like a
            # straight bar protruding from the circle), so the upstand drops
            # below it — Pos lowered by the signed leg
            _z, _zsrc = round(_z - _sdir*_H, 1), _zsrc + '+corner@cY'
        # out-of-plane coordinate is NOT in the section: tag X=/Y= (or
        # POS X n / POS Y n) wins, else --starter-x (YZ) / --starter-y (XZ),
        # else 0 with a NOTE
        _mX = (re.search(r'\bX\s*=\s*([-\d.]+)', _spec, re.I)
               or re.search(r'\bPOS(?:ITION)?\s+X\s*=?\s*([-\d.]+)', _spec, re.I))
        # host concrete: tag HOST= wins, else --starter-host (Group carries
        # it; links to a same-named concrete on import into the app)
        _mHST = LEGHOST.search(_spec)
        _host = _mHST.group(1) if _mHST else (a.starter_host or '')
        _mY = (re.search(r'\bY\s*=\s*([-\d.]+)', _spec, re.I)
               or re.search(r'\bPOS(?:ITION)?\s+Y\s*=?\s*([-\d.]+)', _spec, re.I))
        if _pl == 'YZ':
            _py = round(_cx, 2)  # section X runs along App Y
            if a.starter_y is not None:
                _flagign[1] += 1  # --starter-y unused on a YZ plane
            if _mX:
                _px, _oopsrc = round(float(_mX.group(1)), 2), 'tag-X'
            elif a.starter_x is not None:
                _px, _oopsrc = round(float(a.starter_x), 2), 'input-X'
            else:
                _px, _oopsrc = 0.0, 'default-0'
                _oopdef += 1
        else:
            _px = round(_cx, 2)  # section X runs along App X
            if a.starter_x is not None:
                _flagign[0] += 1  # --starter-x unused on an XZ plane
            if _mY:
                _py, _oopsrc = round(float(_mY.group(1)), 2), 'tag-Y'
            elif a.starter_y is not None:
                _py, _oopsrc = round(float(a.starter_y), 2), 'input-Y'
            else:
                _py, _oopsrc = 0.0, 'default-0'
                _oopdef += 1
        _sidx += 1
        _mark = f'{a.starter_mark}{_sidx}'
        _ov = {'starter': True, 'transverse': True,
               'rtype': 'straight' if _want_straight else 'bent',
               'plane': _pl, 'rot': 0.0, 'L': round(_L, 1), 'H': round(_H, 1),
               'z': _z, 'zsrc': _zsrc, 'plan_rotation': _prot,
               'tag': _spec, 'aim': _aim, 'Lsrc': _Lsrc, 'hook_start': _hook,
               'host': _host}
        bars.append(_CBar(f'REBAR-H{_dia}', _px, _py, _mark, dict(_ov)))
        print(f'{_mark}: circle H{_dia} dxf=({_cx:.1f},{_cy:.1f}) -> '
              f'({_px:.1f},{_py:.1f},{_z})[{_oopsrc}] L={_L:.0f}({_Lsrc}) '
              f'aim={_aim} -> {_pl} prot={_prot} '
              f'[{"straight (no leg)" if _want_straight else f"H={_H:.0f} hook@{_hook}"}]')

    if _oopdef:
        print(f'NOTE {_oopdef} circles: no tag X=/Y= or --starter-x/--starter-y — out-of-plane defaults to 0')

    # profile distribution: copies start AT Pos and step toward the signed
    # direction (one-sided, never centered). Tag N=/SP=(signed)/AXIS= win
    # per key over --profile-n/--profile-spacing/--profile-axis; axis
    # defaults out-of-plane (XZ->Y, YZ->X, XY->X); spacing defaults 150
    # when N>1, else single.
    def _prof_dist(ptxt, pl):
        mN = re.search(r'\bN\s*=?\s*(\d+)', ptxt, re.I) if ptxt else None
        mSP = re.search(r'\bSP\s*=?\s*(-?[\d.]+)', ptxt, re.I) if ptxt else None
        mAX = re.search(r'\bAXIS\s*=?\s*([XYZ])\b', ptxt, re.I) if ptxt else None
        n = int(mN.group(1)) if mN else (int(a.profile_n) or 0)
        if mSP:
            sp = float(mSP.group(1))
        elif a.profile_spacing:
            sp = float(a.profile_spacing)
        else:
            sp = 150.0 if n > 1 else 0.0
        if mAX:
            ax = mAX.group(1).upper()
        elif str(a.profile_axis).upper() in ('X', 'Y', 'Z'):
            ax = str(a.profile_axis).upper()
        elif pl == 'XZ':
            ax = 'Y'
        elif pl == 'YZ':
            ax = 'X'
        else:
            ax = 'X'
        g = {'qty_x': 1, 'spacing_x': 0, 'qty_y': 1, 'spacing_y': 0,
             'qty_z': 1, 'spacing_z': 0,
             'offset_x': 0.0, 'offset_y': 0.0, 'offset_z': 0.0}
        if n <= 1:
            g['dist_note'] = 'single'
            return g
        k = ax.lower()
        g[f'qty_{k}'] = n
        g[f'spacing_{k}'] = sp
        g['dist_note'] = f'x{n} toward {"-" if sp < 0 else "+"}{ax} @ {abs(sp):.0f}'
        return g

    # ---- drawn section profiles: one `profile` bar per PROFILE tag ----
    # "PB1 PROFILE H25 [HOST=] [PLANE=/VIEW=] [ROT=] [Z=] [X=/Y=] [GOOD|POOR]"
    # pairs the nearest OPEN polyline with 3+ vertices (2-pt lines are
    # straight bars or direction ticks, never profiles) on any layer except
    # REBAR-EXTENT (ticks); paired traces are consumed (never also run as
    # straight chords). Legs are taken verbatim as [length, compassDeg]
    # compassDeg] parameters (no shape fitting); DIMENSION entities are CAD
    # annotations only and never drive lengths. Single piece (never split),
    # qty 1x1 — set copies in the app.
    _PROFW = re.compile(r'\bPROFILE\b', re.I)
    _prof_tags = [(t, p) for t, p in alltexts if _PROFW.search(t)]
    _prof_used, _pidx, _poopdef = set(), 0, 0
    for _ptxt, _ppos in _prof_tags:
        _cand, _bd = None, None
        for _e in msp.query('LWPOLYLINE'):
            # paired traces are consumed from straight-chord processing below
            if _e.is_closed or id(_e) in stair_used or id(_e) in _prof_used:
                continue
            if _e.dxf.layer == 'REBAR-EXTENT':
                continue
            _q = [(p[0], p[1]) for p in _e.vertices()]
            if len(_q) < 3:
                continue
            _dd = min(math.hypot(_ppos[0]-x, _ppos[1]-y) for x, y in _q)
            if _bd is None or _dd < _bd:
                _cand, _bd = _e, _dd
        if _cand is None:
            print(f'WARN tag {_ptxt[:44]!r}: no open 3+-pt polyline nearby — skipped')
            continue
        _prof_used.add(id(_cand))
        _q = [(float(p[0]), float(p[1])) for p in _cand.vertices()]
        _legs = []
        for _k in range(1, len(_q)):
            _dx, _dy = _q[_k][0]-_q[_k-1][0], _q[_k][1]-_q[_k-1][1]
            _ln = math.hypot(_dx, _dy)
            if _ln < 1e-6:
                continue
            _legs.append([round(_ln, 1), round(math.degrees(math.atan2(_dy, _dx)), 1)])
        if not _legs:
            print(f'WARN tag {_ptxt[:44]!r}: degenerate polyline — skipped')
            continue
        _tot = round(sum(l for l, _ in _legs), 1)
        _tm = TAG.search(_ptxt)
        _pmark = _tm.group(1) if _tm and _tm.group(1) else None
        if not _pmark or _pmark.upper() in ('VERT', 'TIE', 'LINK', 'STARTER', 'RISER', 'BENT', 'HOOK', 'PROFILE'):
            _pidx += 1
            _pmark = f'PB{_pidx}'
        _pmD = _SDIA.search(_ptxt); _pmHd = _SHDIA.search(_ptxt)
        _pmLay = re.search(r'H(\d+)', _cand.dxf.layer, re.I)
        if _pmD:
            _pdia = int(_pmD.group(1))
        elif _pmHd:
            _pdia = int(_pmHd.group(1))
        elif _pmLay:
            _pdia = int(_pmLay.group(1))  # plan traces carry dia in the layer
        else:
            _pdia = 16
            print(f'WARN {_pmark}: no H<dia>/DIA= in tag or layer — assuming H16')
        if _SL.search(_ptxt):
            print(f'NOTE {_pmark}: tag L= ignored — leg lengths rule the profile')
        _mv = LEGVW.search(_ptxt)
        _mp = re.search(r'\bPLANE\s*=?\s*(XY|XZ|YZ)\b', _ptxt, re.I)
        if _mv:
            _ppl = _mv.group(1).upper()
        elif _mp:
            _ppl = _mp.group(1).upper()
        elif str(a.starter_plane).upper() in ('XY', 'XZ', 'YZ'):
            _ppl = str(a.starter_plane).upper()
        elif abs(math.cos(math.radians(_legs[0][1]))) >= abs(math.sin(math.radians(_legs[0][1]))):
            _ppl = 'XZ'
        else:
            _ppl = 'YZ'
        _mrot = LEGROT.search(_ptxt)
        _prot0 = float(_mrot.group(1)) if _mrot else 0.0
        _mhst = LEGHOST.search(_ptxt)
        _phost = _mhst.group(1) if _mhst else (a.starter_host or '')
        _mslab = cobj.get(cmap[_phost.lower()]) if _phost and _phost.lower() in cmap else None
        _mz = LEGZ.search(_ptxt)
        if _mz:
            _pz, _pzsrc = float(_mz.group(1)), 'tag'
        elif _mslab is not None:
            _pz = round(_mslab['z'] + _mslab.get('covB', a.cover) + _pdia/2, 1)
            _pzsrc = f'auto-{str(_mslab.get("kind") or "member").lower()}Bot'
        else:
            _pz, _pzsrc = 0.0, 'default-0'
            print(f'NOTE {_pmark}: no Z= or host — level 0 (set Z= or move in app)')
        _mX = (re.search(r'\bX\s*=\s*([-\d.]+)', _ptxt, re.I)
               or re.search(r'\bPOS(?:ITION)?\s+X\s*=?\s*([-\d.]+)', _ptxt, re.I))
        _mY = (re.search(r'\bY\s*=\s*([-\d.]+)', _ptxt, re.I)
               or re.search(r'\bPOS(?:ITION)?\s+Y\s*=?\s*([-\d.]+)', _ptxt, re.I))
        if _ppl == 'XY':
            # plan-drawn bars: position verbatim from the first vertex
            _ppx, _ppy, _poop = round(_q[0][0], 2), round(_q[0][1], 2), 'plan-XY'
            if a.starter_x is not None:
                _flagign[0] += 1
            if a.starter_y is not None:
                _flagign[1] += 1
        elif _ppl == 'YZ':
            _ppy = round(_q[0][0], 2)
            if a.starter_y is not None:
                _flagign[1] += 1  # --starter-y unused on a YZ plane
            if _mX:
                _ppx, _poop = round(float(_mX.group(1)), 2), 'tag-X'
            elif a.starter_x is not None:
                _ppx, _poop = round(float(a.starter_x), 2), 'input-X'
            else:
                _ppx, _poop = 0.0, 'default-0'
                _poopdef += 1
        else:
            _ppx = round(_q[0][0], 2)
            if a.starter_x is not None:
                _flagign[0] += 1  # --starter-x unused on an XZ plane
            if _mY:
                _ppy, _poop = round(float(_mY.group(1)), 2), 'tag-Y'
            elif a.starter_y is not None:
                _ppy, _poop = round(float(a.starter_y), 2), 'input-Y'
            else:
                _ppy, _poop = 0.0, 'default-0'
                _poopdef += 1
        _pov = {'rtype': 'profile', 'plane': _ppl, 'rot': _prot0,
                'L': _tot, 'z': _pz, 'zsrc': _pzsrc,
                'tag': _ptxt, 'legs': _legs, 'nosplit': True,
                'host': _phost}
        _pdist = _prof_dist(_ptxt, _ppl)
        for _gk, _gv in _pdist.items():
            if _gk != 'dist_note':
                _pov[_gk] = _gv
        if _tot > a.stock:
            print(f'NOTE {_pmark}: profile {round(_tot)} over stock {round(a.stock)} — single piece, split manually in app')
        bars.append(_CBar(f'PROFILE-H{_pdia}', _ppx, _ppy, _pmark, dict(_pov)))
        print(f'{_pmark}: profile H{_pdia} {len(_legs)} legs L={_tot} -> {_ppl} rot={_prot0} '
              f'@ ({_ppx:.1f},{_ppy:.1f},{_pz})[{_poop}] zsrc={_pzsrc} {_pdist["dist_note"]}')
    if _poopdef:
        print(f'NOTE {_poopdef} profiles: no tag X=/Y= or --starter-x/--starter-y — out-of-plane defaults to 0')

    # ---- tagless plan cranks: --profiles auto converts untagged open 3+-pt
    # REBAR-H/LINK traces (dia from the layer) into profiles; anything with
    # a bar tag within 1500 keeps its legacy straight-chord row. Default
    # tags-mode leaves this off so mixed/tagged plan files convert exactly
    # as before.
    if str(a.profiles).lower() == 'auto':
        _auto_n = 0
        for _e in msp.query('LWPOLYLINE'):
            if (_e.is_closed or id(_e) in stair_used or id(_e) in _prof_used
                    or not (_e.dxf.layer.startswith('REBAR-H') or _e.dxf.layer.startswith('REBAR-LINK'))):
                continue
            _q = [(float(p[0]), float(p[1])) for p in _e.vertices()]
            if len(_q) < 3:
                continue
            _tagged = False
            for _tx, _ps in texts:
                if min(math.hypot(_ps[0]-x, _ps[1]-y) for x, y in _q) < 1500:
                    _tagged = True
                    break
            if _tagged:
                continue
            _legs = []
            for _k in range(1, len(_q)):
                _dx, _dy = _q[_k][0]-_q[_k-1][0], _q[_k][1]-_q[_k-1][1]
                _ln = math.hypot(_dx, _dy)
                if _ln < 1e-6:
                    continue
                _legs.append([round(_ln, 1), round(math.degrees(math.atan2(_dy, _dx)), 1)])
            if not _legs:
                continue
            _tot = round(sum(l for l, _ in _legs), 1)
            _lay = re.search(r'H(\d+)', _e.dxf.layer, re.I)
            _pdia = int(_lay.group(1)) if _lay else 16
            _pidx += 1
            _pmark = f'PB{_pidx}'
            _ppl = str(a.starter_plane).upper() if str(a.starter_plane).upper() in ('XY', 'XZ', 'YZ') else 'XY'
            if _ppl == 'XY':
                _ppx, _ppy = round(_q[0][0], 2), round(_q[0][1], 2)
                if a.starter_x is not None:
                    _flagign[0] += 1
                if a.starter_y is not None:
                    _flagign[1] += 1
            elif _ppl == 'YZ':
                _ppy = round(_q[0][0], 2)
                if a.starter_y is not None:
                    _flagign[1] += 1  # --starter-y unused on a YZ plane
                _ppx = round(float(a.starter_x), 2) if a.starter_x is not None else 0.0
            else:
                _ppx = round(_q[0][0], 2)
                if a.starter_x is not None:
                    _flagign[0] += 1  # --starter-x unused on an XZ plane
                _ppy = round(float(a.starter_y), 2) if a.starter_y is not None else 0.0
            if a.starter_z is not None:
                _pz, _pzsrc = float(a.starter_z), 'default'
            else:
                _pz, _pzsrc = 0.0, 'default-0'
            _pov = {'rtype': 'profile', 'plane': _ppl, 'rot': 0.0,
                    'L': _tot, 'z': _pz, 'zsrc': _pzsrc,
                    'tag': '', 'legs': _legs, 'nosplit': True,
                    'host': (a.starter_host or '')}
            _pdist = _prof_dist(None, _ppl)
            for _gk, _gv in _pdist.items():
                if _gk != 'dist_note':
                    _pov[_gk] = _gv
            if _tot > a.stock:
                print(f'NOTE {_pmark}: profile {round(_tot)} over stock — single piece, split manually in app')
            _prof_used.add(id(_e))
            bars.append(_CBar(f'PROFILE-H{_pdia}', _ppx, _ppy, _pmark, dict(_pov)))
            _auto_n += 1
            print(f'{_pmark}: auto-profile H{_pdia} {len(_legs)} legs L={_tot} -> {_ppl} @ ({_ppx:.1f},{_ppy:.1f},{_pz}) {_pdist["dist_note"]}')
        if _auto_n:
            print(f'{_auto_n} untagged traces auto-profiled (tagged bars keep legacy rows)')
    if _prof_used:
        bars[:] = [b for b in bars if id(b) not in _prof_used]
        print(f'{len(_prof_used)} traces consumed as profiles (no chord rows)')
    if _flagign[0]:
        print(f'WARN {_flagign[0]} bars: --starter-x given but unused (YZ plane needs X; XZ/XY ignore it)')
    if _flagign[1]:
        print(f'WARN {_flagign[1]} bars: --starter-y given but unused (XZ plane needs Y; YZ/XY ignore it)')

    rows = []; tag = 0
    odir = []  # (mark, rtype, ang, len, slabId) for the parity-orientation check
    for b in bars:
        if id(b) in stair_used:
            continue  # drawn stair-starter profile: consumed by its SSB/SST tag
        pts = list(b.vertices()); (x1,y1),(x2,y2) = pts[0][:2], pts[1][:2]
        L = math.hypot(x2-x1, y2-y1)
        ang = round(math.degrees(math.atan2(y2-y1, x2-x1)), 1)
        ux, uy = ((x2-x1)/L, (y2-y1)/L) if L else (1,0)
        uz = 0.0  # stock-split direction: plan for drawn bars, +Z for VERT
        if b.is_closed:
            # rect anchor = bbox min corner (stable profile origin; vertex[0]
            # is an arbitrary corner and skews one-sided grids off the zone).
            # Direction/angle above (first edge) is kept only as fallback.
            xs0 = [p[0] for p in pts]; ys0 = [p[1] for p in pts]
            x1, y1 = min(xs0), min(ys0)
        lay_dia = re.search(r'H(\d+)', b.dxf.layer, re.I)

        # nearest tag to the bar SEGMENT (not midpoint — tags sit at bar ends)
        def dseg(px, py):
            vx, vy = x2-x1, y2-y1
            vv = vx*vx+vy*vy or 1.0
            t = max(0.0, min(1.0, ((px-x1)*vx+(py-y1)*vy)/vv))
            return math.hypot(px-(x1+t*vx), py-(y1+t*vy))
        # pair tag to bar: distance to segment + heavy penalty if dia disagrees
        # with the layer (bars overlap in Y, so pure distance mis-pairs).
        # Dia-less tags (TIE) carry no penalty — the layer gives the diameter.
        # Generator tags are fenced: VERT tags pair only their own synthesized
        # perimeter bars, TIE tags only closed LINK-layer rects.
        lay_dia_n = int(lay_dia.group(1)) if lay_dia else 0
        def score(t):
            m2 = TAG.search(t[0])
            tw2 = TYPEW.search(t[0]); kw2 = tw2.group(1).upper() if tw2 else ''
            if hasattr(b, '_vert_idx'):
                if not m2 or (m2.group(1) or '').upper() != b._vert_mark.upper():
                    return 1e12
                return dseg(t[1][0], t[1][1])
            if kw2 in ('VERT', 'STARTER', 'RISER') or (m2 and VERTCOUNT.search(t[0])):
                return 1e12
            if kw2 == 'TIE' and not (b.is_closed and 'LINK' in b.dxf.layer.upper()):
                return 1e12
            mr2 = LOCROLE.search(t[0])
            if mr2 and mr2.group(1).upper().startswith('DIST'):
                # stair distribution generates its own stepped rows; drawn
                # bars (e.g. wall horizontals) keep pairing these tags
                mhst2 = LEGHOST.search(t[0]); hh2 = mhst2.group(1) if mhst2 else ''
                ks = cobj.get(cmap[hh2.lower()]) if hh2 and hh2.lower() in cmap else None
                if ks is not None and str(ks.get('kind') or '').upper() == 'STAIR':
                    return 1e12
            d = dseg(t[1][0], t[1][1])
            if b.is_closed:
                # rect perimeter, not just the first edge (tags sit at any corner)
                q0 = [(p[0], p[1]) for p in pts]
                for i in range(1, len(q0)):
                    ax, ay = q0[i - 1]; bx, by = q0[i]
                    vx, vy = bx - ax, by - ay
                    vv = vx * vx + vy * vy or 1.0
                    tt = max(0.0, min(1.0, ((t[1][0] - ax) * vx + (t[1][1] - ay) * vy) / vv))
                    dd = math.hypot(t[1][0] - (ax + tt * vx), t[1][1] - (ay + tt * vy))
                    if dd < d:
                        d = dd
            tag_dia = _tagdia(m2)
            return d + (0 if tag_dia in (lay_dia_n, 0) else 5000)
        best = None
        if texts and not getattr(b, '_circ', False):
            scored = sorted(((score(t), t) for t in texts), key=lambda r: r[0])
            best = scored[0][1]
            # tags drift during CAD edits; a close runner-up means the pairing
            # is a guess — shout instead of silently writing wrong BBS rows
            if len(scored) > 1 and scored[1][0] - scored[0][0] < 400:
                print(f'WARN {b.dxf.layer}: tag {scored[0][1][0][:44]!r} wins by '
                      f'{scored[1][0]-scored[0][0]:.0f} over {scored[1][1][0][:44]!r} — '
                      f'move the tag closer to its bar end')
        raw = best[0] if best else ''
        m = TAG.search(raw) if best else None
        mark = (m.group(1) if m and m.group(1) else f'B{len(rows)+1}')
        if getattr(b, '_circ', False):
            # drawn-circle starter: own mark + spec tag (generic pairing
            # above is skipped so nearby unrelated tags never leak in)
            raw = (getattr(b, '_ov', None) or {}).get('tag', '') or ''
            m = TAG.search(raw) if raw else None
            mark = b._circ_mark
        dd = _tagdia(m)
        if dd:
            dia = dd
        elif lay_dia:
            dia = int(lay_dia.group(1))  # dia-less tags (TIE): layer carries it
        else:
            dia = 16
            print(f'WARN {mark}: no diameter in tag or layer — assuming H16')
        sp0 = LEGSP.search(raw); spacing = int(sp0.group(1)) if sp0 else 150
        mz = LEGZ.search(raw); zman = float(mz.group(1)) if mz else None
        mhst = LEGHOST.search(raw); host = mhst.group(1) if mhst else ''
        bt = BTMARK.match(mark or '')
        ov = getattr(b, '_ov', None)
        if not host and ov and ov.get('host'):
            host = ov['host']  # circle starters: tag HOST= else --starter-host
        mv = LEGVW.search(raw); plane = mv.group(1).upper() if mv else 'XY'
        mr = LEGROT.search(raw); rot = float(mr.group(1)) if mr else ang
        if ov:
            # generated bars carry their own frame (starter: XZ / -90)
            plane, rot = ov.get('plane', plane), ov.get('rot', rot)
        # shape keywords: BENT H=<leg> UP/DOWN | LINK A=<a> B=<b> | LINK_HOOK + DOUBLE
        # TIE A=<x-side> B=<y-side> (closed loop) | VERT n x H<dia> (column verticals)
        tw = TYPEW.search(raw); tword = tw.group(1).upper() if tw else ''
        # VERT only generates from synthesized perimeter bars (a drawn bar that
        # merely pairs a VERT tag keeps its drawn geometry)
        vert = (tword == 'VERT' and hasattr(b, '_vert_idx'))
        ov = getattr(b, '_ov', None)
        if ov and 'rtype' in ov:
            rtype = ov['rtype']  # generated rows declare their own shape
        elif tword == 'BENT':
            rtype = 'bent'
        elif tword == 'STARTER':
            rtype = 'bent'  # only synthesized starter bars can pair these tags
        elif tword == 'RISER':
            rtype = 'bent'  # only synthesized riser steps can pair these tags
        elif tword in ('LINK_HOOK', 'HOOK'):
            rtype = 'c_link_with_hook'
        elif tword in ('LINK', 'C_LINK'):
            rtype = 'c_link'
        elif tword == 'TIE':
            rtype = 'tie'
        elif b.is_closed and 'LINK' in b.dxf.layer.upper():
            # closed rect on a REBAR-LINK layer declares a link by itself
            rtype = 'c_link_with_hook' if 'HOOK' in b.dxf.layer.upper() else 'c_link'
        else:
            rtype = 'straight'
        dbl = bool(DOUBLEW.search(raw))
        mh = LEGH.search(raw); leg_h = float(mh.group(1)) if (mh and rtype == 'bent') else 0.0
        mu = UD.search(raw); updown = mu.group(1).lower() if (mu and rtype == 'bent') else ''
        ma = LEGE.search(raw); mb = LEGB.search(raw)
        link_a = float(ma.group(1)) if (ma and rtype in ('c_link', 'c_link_with_hook', 'tie')) else 0.0
        link_b = float(mb.group(1)) if (mb and rtype in ('c_link', 'c_link_with_hook', 'tie')) else 0.0
        vert_h = float(mh.group(1)) if (mh and vert) else 0.0
        mnz = TIENZ.search(raw); tie_nz = int(mnz.group(1)) if mnz else 0
        msz = TIESZ.search(raw); tie_sz = float(msz.group(1)) if msz else 0.0
        ml = LEGLEN.search(raw); exp_len = float(ml.group(1)) if ml else 0.0
        # host slab lookup (HOST tag, else spatial containment, else first) —
        # drives slab covers for auto-level and link spine length
        def find_slab():
            if host and host.lower() in cmap:
                s = cobj.get(cmap[host.lower()])
                if s:
                    return s
            for cc in concretes:
                if cc['x'] <= x1 <= cc['x']+cc['lx'] and cc['y'] <= y1 <= cc['y']+cc['ly']:
                    return cc
            return concretes[0] if concretes else None
        slab = find_slab()
        # wall-hosted links run re-oriented (VIEW=YZ): spine through the wall
        # thickness, field spread along the wall, stacked in Z like ties
        wallFlag = bool(slab) and str(slab.get('kind') or '').upper() == 'WALL'
        # link spine: explicit L= wins, else slab internal depth (THK - covers),
        # else rect-measured (closed) / line length. Legs stay tag-or-measured.
        def meas_rect():
            q = [(p[0], p[1]) for p in b.vertices()]
            w = math.hypot(q[1][0]-q[0][0], q[1][1]-q[0][1])
            hside = math.hypot(q[2][0]-q[1][0], q[2][1]-q[1][1]) if len(q) > 2 else w
            return ((w, hside, hside) if w >= hside else (hside, w, w))
        Lsrc = 'line'
        if exp_len:
            L, Lsrc = exp_len, 'tag'
        elif rtype in ('c_link', 'c_link_with_hook'):
            if wallFlag:
                if slab and min(slab['lx'], slab['ly']) - slab.get('covT', 0) - slab.get('covB', 0) > 0:
                    L, Lsrc = round(min(slab['lx'], slab['ly']) - slab['covT'] - slab['covB'], 1), 'wall'
                elif b.is_closed:
                    L, Lsrc = 110.0, 'default'  # field rect is not a spine
                # open line: keep the drawn length as the spine
            elif slab and slab['lz'] - slab.get('covT', 0) - slab.get('covB', 0) > 0:
                L, Lsrc = round(slab['lz'] - slab['covT'] - slab['covB'], 1), 'slab'
            elif b.is_closed:
                L, Lsrc = meas_rect()[0], 'rect'
        if rtype in ('c_link', 'c_link_with_hook') and b.is_closed and not wallFlag:
            # zone rects double as leg profiles for slab/column links
            _, lega, legb = meas_rect()
            link_a = link_a or lega; link_b = link_b or legb
        if rtype in ('c_link', 'c_link_with_hook') and not (b.is_closed and not wallFlag):
            # nothing measurable (open line, or wall rect = field not profile):
            # small defaults instead of garbage
            if not ma:
                link_a = 130.0
            if not mb and not wallFlag:
                link_b = 130.0
            if wallFlag and not ma:
                print(f'NOTE {mark}: leg A defaults to {link_a} (nothing measurable)')
        if wallFlag and rtype in ('c_link', 'c_link_with_hook'):
            # flat (XY) wall links: hook leg follows the wall internal depth;
            # legs run along the wall, so an explicit B= is superseded
            if slab and min(slab['lx'], slab['ly']) - slab.get('covT', 0) - slab.get('covB', 0) > 0:
                wall_int = round(min(slab['lx'], slab['ly']) - slab['covT'] - slab['covB'], 1)
                if mb and abs(link_b - wall_int) > 1e-6:
                    print(f'NOTE {mark}: wall B={link_b} follows thickness-covers {wall_int}')
                link_b = wall_int
            if mv is None:
                plane = 'XY'  # wall links lie flat in plan
            if mr is None:
                rot = 90.0  # spine (local X) across the thickness
        if vert:
            # generated column vertical: height from H=, else host internal height
            plane, rot = 'XZ', 90.0  # local X stands up to App Z
            ux, uy, uz = 0.0, 0.0, 1.0
            if vert_h:
                L, Lsrc = vert_h, 'tag'
            elif slab and slab['lz'] - slab.get('covT', 0) - slab.get('covB', 0) > 0:
                L, Lsrc = round(slab['lz'] - slab['covT'] - slab['covB'], 1), 'slab'
            else:
                L, Lsrc = 0.0, 'none-WARN-no-H'
                print(f'WARN {mark}: VERT with no H= and no host depth — zero-length row')
        if ov and ov.get('transverse'):
            # section starter: horizontal main — stock splits run along the
            # length compass (world dir is (cos aim, sin aim) on both planes)
            _th = math.radians(float(ov.get('aim', 0.0)))
            ux, uy, uz = round(math.cos(_th), 4), round(math.sin(_th), 4), 0.0
        if ov and 'L' in ov:
            L, Lsrc = ov['L'], 'starter'
        tie_h = 0.0
        if rtype == 'tie' and b.is_closed:
            # axis-locked loop sides from the rect bbox (vertex order varies);
            # an explicit L= overrides the X-side only
            tq = [(p[0], p[1]) for p in b.vertices()]
            tie_w = round(max(p[0] for p in tq)-min(p[0] for p in tq), 1)
            tie_h = round(max(p[1] for p in tq)-min(p[1] for p in tq), 1)
            if not exp_len:
                L, Lsrc = tie_w, 'rect'
            if mr is None:
                rot = 0.0
        # level: explicit Z= wins; else straight bars auto-level from the slab.
        # Location comes from explicit keywords (BOT/TOP side, MAIN/DIST role,
        # LYR=n layer, ON=<parent mark>), so the mark itself can be any integer
        # (101, ...). Missing pieces fall back to the classic B/T+number rule
        # (B bottom / T top, odd main / even distribution stacked on N-1).
        def tag_raw_for(want):
            for ttxt, _ in texts:
                tm = TAG.search(ttxt)
                if tm and (tm.group(1) or '').upper() == want.upper():
                    return ttxt
            return None
        def tag_dia_for(want):
            tr = tag_raw_for(want)
            tm = TAG.search(tr) if tr else None
            dd = _tagdia(tm)
            return dd or None
        def base_level(side0, idx0, dia0):
            st = dia0 + a.gap
            if side0 == 'B':
                return slab['z'] + slab['covB'] + dia0/2 + idx0*st
            return slab['z'] + slab['lz'] - slab['covT'] - dia0/2 - idx0*st
        mside = LOCSIDE.search(raw); mrole = LOCROLE.search(raw)
        kw_side = ('B' if mside.group(1).upper().startswith('BOT') else 'T') if mside else None
        bt = BTMARK.match(mark or '')
        side = kw_side or (bt.group(1).upper() if bt else None)
        num = int(bt.group(2)) if bt else None
        if mrole:
            role = 'main' if mrole.group(1).upper().startswith('MAIN') else 'dist'
        elif vert:
            role = 'vert'
        elif num is not None:
            role = 'dist' if num % 2 == 0 else 'main'
        else:
            role = 'main'
        mlyr = LOCLYR.search(raw)
        lyr = int(mlyr.group(1)) if mlyr else None
        mon = LOCON.search(raw); on_mark = mon.group(1) if mon else None
        mrole_main = bool(mrole and mrole.group(1).upper().startswith('MAIN'))
        mrole_dist = bool(mrole and mrole.group(1).upper().startswith('DIST'))
        if lyr is not None:
            idx, Lnum = lyr - 1, lyr
        elif num is not None:
            idx, Lnum = max(0, (num+1)//2 - 1), (num+1)//2
        else:
            idx, Lnum = 0, 1
        if zman is not None:
            z, zsrc = zman, 'tag'
        elif rtype == 'straight' and mrole_main and slab is not None and side is None:
            # side-less MAIN (stair mains): seat on the bottom cover; pitched
            # bars re-root at the low end below. BOT/TOP mains keep going to
            # the side branches so LYR/layering still applies.
            z, zsrc = round(slab['z'] + slab['covB'] + dia/2, 1), f'auto-{str(slab.get("kind") or "member").lower()}Bot'
        elif vert and slab is not None:
            z, zsrc = round(slab['z'] + slab['covB'] + dia/2, 1), 'auto-vertBot'
        elif vert:
            z, zsrc = round(a.cover + dia/2, 1), 'auto-no-slab'
        elif rtype == 'straight' and (tie_nz or tie_sz) and slab is not None:
            # horizontals with NZ=/SZ= (wall curtains, stair steps share): base
            # cover seat, stacked in Z; explicit NZ/SZ wins over side inference
            z, zsrc = round(slab['z'] + slab['covB'] + dia/2, 1), f'auto-{str(slab.get("kind") or "member").lower()}Bot'
        elif side and rtype == 'straight' and slab is not None:
            if role == 'dist':
                praw = tag_raw_for(on_mark) if on_mark else None
                if praw is None and num is not None and num % 2 == 0 and lyr is None and not mrole:
                    praw = tag_raw_for(f'{"B" if side == "B" else "T"}{num-1}')
                if praw is not None:
                    pm = TAG.search(praw)
                    pmark = pm.group(1) or ''
                    pbt = BTMARK.match(pmark)
                    pmside = LOCSIDE.search(praw)
                    if pmside:
                        pside = 'B' if pmside.group(1).upper().startswith('BOT') else 'T'
                    else:
                        pside = pbt.group(1).upper() if pbt else side
                    pnum = int(pbt.group(2)) if pbt else None
                    plyr = LOCLYR.search(praw)
                    pidx = (int(plyr.group(1)) - 1) if plyr else ((max(0, (pnum+1)//2 - 1)) if pnum is not None else 0)
                    pdia = _tagdia(pm) or dia
                    poz = base_level(pside, pidx, pdia)
                    if side == 'B':
                        z, zsrc = round(poz + pdia/2 + a.gap + dia/2, 1), f'auto-botL{Lnum}-on{pmark}'
                    else:
                        z, zsrc = round(poz - pdia/2 - a.gap - dia/2, 1), f'auto-topL{Lnum}-on{pmark}'
                else:
                    if side == 'B':
                        z, zsrc = round(base_level(side, idx, dia) + dia + a.gap, 1), f'auto-botL{Lnum}-onLYR'
                    else:
                        z, zsrc = round(base_level(side, idx, dia) - dia - a.gap, 1), f'auto-topL{Lnum}-onLYR'
            elif side == 'B':
                z, zsrc = round(base_level(side, idx, dia), 1), f'auto-botL{Lnum}'
            else:
                z, zsrc = round(base_level(side, idx, dia), 1), f'auto-topL{Lnum}'
        elif rtype == 'straight' and (side or tie_nz or tie_sz):
            z, zsrc = round(a.cover + dia/2, 1), 'auto-no-slab'
        else:
            # links and ties with no explicit Z sit on the bottom cover (same
            # cover+dia/2 convention as B1); bent/unknown still warn
            if rtype in ('c_link', 'c_link_with_hook', 'tie'):
                if slab is None:
                    z, zsrc = round(a.cover + dia/2, 1), 'auto-no-slab'
                else:
                    z, zsrc = round(slab['z'] + slab['covB'] + dia/2, 1), 'auto-linkBot'
            else:
                z, zsrc = 0.0, 'none-WARN-no-Z'
        if ov and 'z' in ov:
            z, zsrc = ov['z'], (ov.get('zsrc') or ('starter' if ov.get('starter')
                                else ('sdist' if ov.get('sdist') else 'riser')))
        # vertical-spine links (XZ plane, ROT 90) with an explicit Z that
        # pokes out of the host slab are almost certainly a stale tag value
        if (rtype in ('c_link', 'c_link_with_hook') and zman is not None
                and slab is not None and plane == 'XZ'
                and abs((rot % 180) - 90) < 1.0):
            if z < slab['z'] - 1e-6 or z + L > slab['z'] + slab['lz'] + 1e-6:
                print(f'WARN {mark}: link z={z}..{round(z+L,1)} pokes out of slab '
                      f'{slab["z"]}..{slab["z"]+slab["lz"]} — drop Z= to auto-seat it')
        # bond: EC2 8.2 — bottom steel good, top-zone steel poor; explicit
        # GOOD/POOR wins over side-derived, --bond forces every bar
        mbond = LOCBOND.search(raw)
        if a.bond in ('good', 'poor'):
            bond_bar = a.bond
        elif mbond:
            bond_bar = mbond.group(1).lower()
        elif vert:
            bond_bar = 'good'
        elif ov and ov.get('starter'):
            bond_bar = 'good'
        elif ov and ov.get('stairbond'):
            bond_bar = ov['stairbond']  # stair starters: BOT good / TOP poor
        elif side == 'B':
            bond_bar = 'good'
        elif side == 'T':
            bond_bar = 'poor'
        elif mrole_main:
            bond_bar = 'good'
        elif mrole_dist and slab is not None and str(slab.get('kind') or '').upper() == 'STAIR':
            bond_bar = 'good'
        else:
            bond_bar = 'poor'
        # stair mains ride the slope: full-run bars re-rooted at the low end so
        # Pos + base cover stay exact (explicit ROT= still wins). The drawn
        # line only gives direction (ascending) and across-position — a short
        # segment near its own tag pairs cleanly where coincident full lines
        # tie and collapse onto one mark.
        stSlope = (slab.get('slope', 0) or 0.0) if slab else 0.0
        if rtype == 'straight' and mrole_main and slab and stSlope > 0:
            horiz = slab['lx'] >= slab['ly']
            runLen = slab['lx'] if horiz else slab['ly']
            if runLen > 0:
                if mv is None:
                    plane = 'XZ' if horiz else 'YZ'  # section along the run
                if horiz:
                    x1 = slab['x']
                    ux, uy = 1.0, 0.0
                else:
                    y1 = slab['y']
                    ux, uy = 0.0, 1.0
                L, Lsrc = round(runLen / math.cos(math.radians(stSlope)), 1), 'slope'
                if mr is None:
                    rot = stSlope
                uz = round(math.sin(math.radians(stSlope)), 4)
        # distribution: 2-axis grid from tag (EXT=wxh SP=sxsy) or 1-axis tick.
        # Closed link rects with no EXT= fall back to the drawn rectangle as
        # the zone (spacing from SP=, else H<dia>-<sp>, else 150) — keep EXT=
        # when the field is intentionally smaller than the rect.
        me = LEGEXT.search(raw); ms = LEGSP2.search(raw)
        ex2 = float(me.group(2)) if me and me.group(2) else 0.0
        s2 = float(ms.group(2)) if ms and ms.group(2) else 0.0
        ex1 = float(me.group(1)) if me else 0.0
        s1 = float(ms.group(1)) if ms else 0.0
        wallLink = wallFlag and rtype in ('c_link', 'c_link_with_hook')
        if wallLink:
            # wall field = along-wall spread (sx) x stacked height (sz from
            # SZ=, else SP= second value, else H-sp/default); a second EXT
            # axis would stack through the thickness: ignored (s2 survives
            # below for the Z spacing)
            if ex2 and s2:
                print(f'NOTE {mark}: wall link ignores second EXT axis {ex1}x{ex2} — height comes from the host')
            ex2 = 0.0
        ext_src = 'tag' if (ex2 and s2) else ''
        if not (ex2 and s2) and rtype in ('c_link', 'c_link_with_hook') and b.is_closed \
                and not wallLink:
            q0 = [(p[0], p[1]) for p in b.vertices()]
            ex1 = round(max(p[0] for p in q0) - min(p[0] for p in q0), 1)
            ex2 = round(max(p[1] for p in q0) - min(p[1] for p in q0), 1)
            s1 = s1 or s2 or spacing
            s2 = s2 or s1 or spacing
            ext_src = 'rect'
            print(f'NOTE {mark}: no EXT=/SP= — zoning {ex1}x{ex2} from the rect @ {s1} (keep EXT= for a smaller field)')
        ext_tick = 0.0
        # Grids are CENTERED on the drawn anchor: the app copies one-sided
        # (Pos + ix*spacing) but drafters center the line in its zone (the cyan
        # tick straddles the bar), so emit negative offsets to recenter.
        # Closed rects: grid centered inside the rect (leftover splits evenly).
        ox, oy = 0.0, 0.0
        if vert or ov:
            # generated bars stand alone (no distribution, no tick; risers
            # and stepped rows carry their own grid in ov)
            qx, sx, qy, sy = 1, 0, 1, 0
            n = 1; width_txt = 0.0
        elif ex2 and s2:
            qx = max(1, int(round(ex1/s1))+1); sx = s1
            qy = max(1, int(round(ex2/s2))+1); sy = s2
            n = qx*qy; width_txt = ex1
            if b.is_closed:
                q = [(p[0], p[1]) for p in b.vertices()]
                rw = max(p[0] for p in q) - min(p[0] for p in q)
                rh = max(p[1] for p in q) - min(p[1] for p in q)
                ox = round((rw - (qx-1)*sx)/2, 1); oy = round((rh - (qy-1)*sy)/2, 1)
            else:
                ox = round(-(qx-1)*sx/2, 1); oy = round(-(qy-1)*sy/2, 1)
        else:
            # nearest UNUSED extent tick within 4000 of bar midpoint (greedy:
            # bars can overlap, so a used tick must not be re-paired)
            mx, my = (x1+x2)/2, (y1+y2)/2
            if not hasattr(main, '_tick_used'):
                main._tick_used = set()
            best_ti, best_td = -1, 4000.0
            for ti, t in enumerate(ticks):
                if ti in main._tick_used:
                    continue
                q = list(t.vertices()); qmx=(q[0][0]+q[1][0])/2; qmy=(q[0][1]+q[1][1])/2
                d = math.hypot(qmx-mx, qmy-my)
                if d < best_td:
                    best_td, best_ti = d, ti
            if best_ti >= 0:
                main._tick_used.add(best_ti)
                q = list(ticks[best_ti].vertices())
                ext_tick = math.hypot(q[1][0]-q[0][0], q[1][1]-q[0][1])
            ext_txt = ex1
            if s1:
                spacing = s1
            width = round(ext_tick) if ext_tick else ext_txt
            n = max(1, int(round(width/spacing))+1) if width and spacing else 1
            vertical = abs(x2-x1) < abs(y2-y1)
            if wallLink and b.is_closed:
                # closed rect: spread along the long side, spine centered
                # across the thickness (open-line centering would shove the
                # field off the rect: -2400 in the WL1 case)
                rq = [(p[0], p[1]) for p in b.vertices()]
                rw = max(p[0] for p in rq)-min(p[0] for p in rq)
                rh = max(p[1] for p in rq)-min(p[1] for p in rq)
                if rw >= rh:
                    qx, sx, qy, sy = n, spacing, 1, 0
                    ox, oy = round((rw-(qx-1)*sx)/2, 1), round((rh-L)/2, 1)
                else:
                    qx, sx, qy, sy = 1, 0, n, spacing
                    ox, oy = round((rw-L)/2, 1), round((rh-(qy-1)*sy)/2, 1)
                # flat-U legs trail -X from each origin; flag rect spill
                legX = max(link_a, link_b - (dia if rtype == 'c_link_with_hook' else 0))
                if legX - ox > 1e-6:
                    print(f'WARN {mark}: legs extend {round(legX-ox,1)} past rect start — widen rect or accept overhang')
            else:
                if wallLink:
                    vertical = not vertical  # spread along the wall, not across it
                qx,sx,qy,sy = (n,spacing,1,0) if vertical else (1,0,n,spacing)
                # center copies on the line: tick straddles it, app copies don't
                ox = round(-(qx-1)*sx/2, 1) if qx > 1 else 0.0
                oy = round(-(qy-1)*sy/2, 1) if qy > 1 else 0.0
            width_txt = ext_txt
        if rtype in ('c_link', 'c_link_with_hook', 'tie') and L <= 0:
            L, Lsrc = 110.0, 'default'
        lap = 0 if rtype in ('c_link', 'c_link_with_hook', 'tie', 'profile') else (lap_len(dia, bond_bar) if L > a.stock else 0)

        # split > stock into lapped pieces (verticals split upward in Z);
        # drawn profiles never split (a lap mid-crank is meaningless — NOTE
        # when over stock and emit one piece)
        segs = []; s = 0.0
        if (ov and ov.get('nosplit')) or L <= a.stock: segs = [(0.0, L, 0)]
        else:
            while L - s > a.stock:
                segs.append((s, a.stock, lap)); s += a.stock - lap
            segs.append((s, L - s, lap))

        vmark = getattr(b, '_vert_idx', None)
        msfx = (ov.get('msuffix', '') if ov else '')
        if ov and ov.get('nosuffix'):
            bmark = mark + msfx  # single-row generated bars keep the plain mark
        else:
            bmark = (f'{mark}-{vmark+1}' if vmark is not None else mark) + msfx
        def zstack_count(sz, legTop=0.0):
            # stacked levels capped so the top copy (plus leg height) stays
            # under the top cover; explicit NZ= always wins
            if tie_nz:
                return (tie_nz, sz) if sz > 0 else (tie_nz, 0)
            if sz > 0 and slab and slab['lz'] - slab.get('covT', 0) - slab.get('covB', 0) > 0:
                topLim = slab['z'] + slab['lz'] - slab['covT'] - dia/2 - legTop
                return max(1, int((topLim-pz)//sz)+1), sz
            return 1, 0
        for k,(off,seglen,ll) in enumerate(segs):
            tag += 1
            px, py = round(x1+ux*off,2), round(y1+uy*off,2)
            pz = round(z+uz*off,2)
            row = {'Rebar_tag':tag,'Bar_mark':bmark if len(segs)==1 else f'{bmark}-P{k+1}',
                'Rebar_Type':rtype,'Dia':dia,'Pos_x':px,'Pos_y':py,'Pos_z':pz,
                'Group':host,'Pos_Rotation':rot,'Plane':plane,'Length of Bar':round(seglen,1),
                'Length of Lap':ll if len(segs)>1 else '',
                'bond_condition':bond_bar if rtype not in ('c_link','c_link_with_hook','tie') else '',
                'qty_x':qx,'spacing_x':sx,'qty_y':qy,'spacing_y':sy,
                'offset_x':ox,'offset_y':oy,
                'qty':1,'Visible':1,
                'feature':f'stock-split {k+1}/{len(segs)} {bond_bar} lap={ll}' if len(segs)>1 else f'EXT tick={round(ext_tick,0)} TXT={round(width_txt,0)} n={qx}x{qy} zsrc={zsrc}'}
            if rtype == 'bent':
                row['H'] = (ov['H'] if ov and 'H' in ov else leg_h)
                row['bent_up_down'] = (ov['bent_up_down'] if ov and 'bent_up_down' in ov
                                       else (updown or 'up'))
                row['hook_start'] = (ov['hook_start'] if ov and 'hook_start' in ov else 'no')
            if ov and 'plan_rotation' in ov:
                # generated bars (starters) aim via plan rotation on any type
                row['plan_rotation'] = ov['plan_rotation']
            if ov and 'legs' in ov:
                # drawn section profile: per-leg [[len, compassDeg]...] JSON
                row['legs'] = json.dumps(ov['legs'])
            if ov:
                for gk in ('qty_x', 'spacing_x', 'qty_y', 'spacing_y',
                           'qty_z', 'spacing_z', 'offset_x', 'offset_y', 'offset_z'):
                    if gk in ov:
                        row[gk] = ov[gk]
            if ov and 'poly' in ov:
                # stair starters: explicit section profile ([[run,up]...] mm)
                row['polyline'] = json.dumps(ov['poly'])
            if rtype in ('c_link', 'c_link_with_hook'):
                row['length'] = round(seglen,1); row['c_length_a'] = link_a; row['c_length_b'] = link_b
                row.pop('Length of Bar', None)
            if rtype == 'tie':
                # closed loop: length = X-side, c_length_a = Y-side; vertical
                # stacking via qty_z (NZ=/auto from host height)
                row['length'] = round(seglen,1); row['c_length_a'] = tie_h
                row.pop('Length of Bar', None)
                row['qty_z'], row['spacing_z'] = zstack_count(tie_sz or spacing or 150)
            if wallFlag and rtype in ('c_link', 'c_link_with_hook'):
                # wall links stack in Z like ties (SZ=, else SP= second value,
                # else H-sp/default), capped so the tallest leg stays under
                # the top cover; explicit L=/A= always win for spine/legs
                row['qty_z'], row['spacing_z'] = zstack_count(
                    tie_sz or s2 or spacing or 150, max(link_a, link_b))
            if rtype == 'straight' and (tie_nz or tie_sz):
                # wall horizontals: plan line + NZ=/SZ= (or host height);
                # bond stays the safe poor default (GOOD/POOR to override)
                row['qty_z'], row['spacing_z'] = zstack_count(tie_sz or spacing or 150)
            if rtype == 'c_link_with_hook':
                row['double_hook'] = 'yes' if dbl else 'no'
            # direct host link so project JSON opens already hosted
            if host and host.lower() in cmap:
                row['host'] = cmap[host.lower()]
            rows.append(row)

        print(f'{b.dxf.layer} {mark} L={L:.1f}({Lsrc}) ang={ang} dia=H{dia} z={z}({zsrc}) plane={plane} rot={rot} grid={qx}x{qy} @ {sx}x{sy} | lap({bond_bar})={lap} -> {len(segs)} piece(s) [{rtype}]')
        odir.append((mark, rtype, ang, L, slab['id'] if slab else None, role))

    # main-vs-distribution orientation check (straight bars only): MAIN marks
    # must share one direction per slab; DIST marks must run across it.
    # Flags mislabeled bars, never blocks the import.
    by_slab = {}
    for m0, r0, a0, l0, s0, role0 in odir:
        if r0 == 'straight':
            if (m0 or '').upper().startswith('SR'):
                continue  # generated nosing steel mixes orientations by design
            by_slab.setdefault(s0, []).append((m0, a0, l0, role0))
    for s0, items in by_slab.items():
        mains = [(m, a, l) for m, a, l, r in items if r == 'main']
        dists = [(m, a, l) for m, a, l, r in items if r == 'dist']
        if not mains or not dists:
            continue
        refm = max(mains, key=lambda r: r[2])
        for m0, a0, _ in dists:
            if abs((a0 - refm[1] + 90) % 180 - 90) < 15:
                print(f'WARN {m0}: distribution drawn at {a0}° parallel to mains ({refm[0]} at {refm[1]}°) — distribution should run transverse')
        for m0, a0, _ in mains:
            if m0 != refm[0] and abs((a0 - refm[1] + 90) % 180 - 90) > 75:
                print(f'WARN {m0}: main drawn at {a0}° across the main direction ({refm[0]} at {refm[1]}°)')

    suffix = a.bond if a.bond in ('good', 'poor') else 'auto'
    out = a.out or a.dxf.rsplit('.',1)[0] + f'_{suffix}.csv'
    with open(out,'w',newline='') as f:
        w = csv.DictWriter(f, fieldnames=MASTER, extrasaction='ignore'); w.writeheader(); w.writerows(rows)
    print('wrote', out, f'({len(rows)} rows)')
    # direct-import project file (FileBar -> import): bars + concrete + bond
    jout = out.rsplit('.',1)[0] + '_bbs.json'
    proj = {'v':1,'app':'barbending','savedAt':int(time.time()*1000),
            'bars':rows,'concretes':concretes,'refLines':[],
            'cover':a.cover,'bond':(a.bond if a.bond in ('good','poor') else 'poor'),'selectedBar':0,
            'selectedBars':[0] if rows else []}
    with open(jout,'w') as f:
        json.dump(proj, f, indent=2)
    print('wrote', jout, f'({len(concretes)} concrete, {len(rows)} bars)')

if __name__ == '__main__':
    sys.exit(main())
