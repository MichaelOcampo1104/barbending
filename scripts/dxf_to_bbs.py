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
#     generates one straight bar per perimeter position (cover inset from the
#     rect), height from H= else host internal depth, seated on base cover,
#     stock-split upward; place the tag inside its column. Column ties: closed
#     rect on REBAR-LINK + "T1 TIE A=<x> B=<y> [SZ=<sp>] [NZ=<n>] HOST=<col>"
#     (A/B measured from the rect when omitted); ties stack in Z from the base
#     cover (count auto from host height unless NZ= given); loop sides are
#     axis-locked to the rect bbox. New shape code 51 (BS8666 closed link).
#     starters: "ST1 STARTER 8xH25 [AT=BOT|TOP] [HB=<bent leg>] HOST=<col>"
#     makes bent dowels (legs aimed outward from the column center):
#     vertical lap above the SFL plus straight-then-bent below, one good-bond
#     tension lap each way (bent leg HB=, else lap minus straight; straight
#     limited by the lower-slab depth; AT=TOP mirrors into the slab above with
#     the vertical leg hanging down).
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
'Length of Bar','H','bent_up_down','Long_length','Crank_step','Length of Lap',
'bond_condition',
'DC_Lap_Start','DC_Lap_Mid','DC_Tail_Length',
'c_length_a','c_length_b','length','double_hook',
'qty_x','spacing_x','qty_y','spacing_y','qty_z','spacing_z',
'offset_x','offset_y','offset_z','plan_rotation','feature',
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

TAG = re.compile(r'^\s*([BSTV]\w+|\d+)?\s*(?:H(\d+)|VERT\s*\d+\s*[x×]\s*H(\d+)|\bTIE\b|\bSTARTER\b)', re.I)
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
TYPEW = re.compile(r'\b(BENT|LINK_HOOK|LINK|C_LINK|HOOK|STRAIGHT|TIE|VERT|STARTER)\b', re.I)
VERTCOUNT = re.compile(r'\bVERT\s*(\d+)\s*[x×]\s*H(\d+)', re.I)
STARTERCOUNT = re.compile(r'\bSTARTER\s*(\d+)\s*[x×]\s*H(\d+)', re.I)
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
CONCTAG = re.compile(r'(C\w+)?\s*(SLAB|BEAM|COLUMN|WALL|FOOTING)?\s*(\S+)?\s*THK\s*=\s*([\d.]+).*?Z\s*=\s*([-\d.]+)', re.I)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('dxf'); ap.add_argument('--bond', default='auto', choices=['good','poor','auto'])
    ap.add_argument('--stock', type=float, default=12000)
    ap.add_argument('--cover', type=float, default=40)
    ap.add_argument('--gap', type=float, default=25)
    ap.add_argument('--out', default='')
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
        concretes.append({'id': cid.lower(), 'name': name,
            'lx': round(max(xs)-min(xs), 1), 'ly': round(max(ys)-min(ys), 1),
            'lz': thk, 'x': round(x0, 2), 'y': round(y0, 2), 'z': z,
            'covB': covB, 'covT': covT})
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
        if not vm:
            continue
        tm = TAG.search(ttxt); vmark = tm.group(1) if tm and tm.group(1) else None
        if not vmark:
            print(f'WARN VERT tag {ttxt[:44]!r} needs a mark like V1 — skipped')
            continue
        vn, vdia = max(1, int(vm.group(1))), int(vm.group(2))
        vslab = host_for(ttxt, tpos, vmark)
        if vslab is None:
            continue
        ins = max(1.0, vslab.get('covB', a.cover) + vdia/2)
        for i, (px, py) in enumerate(ring_pts(vslab, ins, vn)):
            bars.append(_VBar(f'REBAR-VERT-H{vdia}', px, py, i, vmark))
        print(f'{vmark}: {vn} vertical H{vdia} around {vslab["name"]} (inset {round(ins,1)})')
    for ttxt, tpos in texts:
        sm = STARTERCOUNT.search(ttxt)
        if not sm:
            continue
        tm = TAG.search(ttxt); smark = tm.group(1) if tm and tm.group(1) else None
        if not smark:
            print(f'WARN STARTER tag {ttxt[:44]!r} needs a mark like ST1 — skipped')
            continue
        sn, sdia = max(1, int(sm.group(1))), int(sm.group(2))
        col = host_for(ttxt, tpos, smark)
        if col is None:
            continue
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
        for i, (px, py) in enumerate(ring_pts(col, ins, sn)):
            prot = round((math.degrees(math.atan2(py-cy, px-cx)) + legO) % 360, 1)
            bars.append(_VBar(f'REBAR-VERT-H{sdia}', px, py, i, smark,
                {'starter': True, 'plane': 'XZ', 'rot': rotO,
                 'L': round(mainL, 1), 'H': round(hleg, 1),
                 'z': round(pz, 1), 'plan_rotation': prot}))
        shape = 'mirror' if (atop and upper is not None) else 'dowel-up'
        print(f'{smark}: {sn} starter H{sdia} at {"TOP" if atop else "BOT"} SFL={round(sfl,1)} [{shape}] '
              f'(vert {lap} + straight {round(sbelow,1)} + bent {round(hleg,1)})')

    rows = []; tag = 0
    odir = []  # (mark, rtype, ang, len, slabId) for the parity-orientation check
    for b in bars:
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
            if kw2 in ('VERT', 'STARTER') or (m2 and VERTCOUNT.search(t[0])):
                return 1e12
            if kw2 == 'TIE' and not (b.is_closed and 'LINK' in b.dxf.layer.upper()):
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
        if texts:
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
        if tword == 'BENT':
            rtype = 'bent'
        elif tword == 'STARTER':
            rtype = 'bent'  # only synthesized starter bars can pair these tags
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
        mnz = TIENZ.search(raw); tie_nz = int(mnz.group(1)) if (mnz and rtype == 'tie') else 0
        msz = TIESZ.search(raw); tie_sz = float(msz.group(1)) if (msz and rtype == 'tie') else 0.0
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
            if slab and slab['lz'] - slab.get('covT', 0) - slab.get('covB', 0) > 0:
                L, Lsrc = round(slab['lz'] - slab['covT'] - slab['covB'], 1), 'slab'
            elif b.is_closed:
                L, Lsrc = meas_rect()[0], 'rect'
        if rtype in ('c_link', 'c_link_with_hook') and b.is_closed:
            _, lega, legb = meas_rect()
            link_a = link_a or lega; link_b = link_b or legb
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
        if lyr is not None:
            idx, Lnum = lyr - 1, lyr
        elif num is not None:
            idx, Lnum = max(0, (num+1)//2 - 1), (num+1)//2
        else:
            idx, Lnum = 0, 1
        if zman is not None:
            z, zsrc = zman, 'tag'
        elif vert and slab is not None:
            z, zsrc = round(slab['z'] + slab['covB'] + dia/2, 1), 'auto-vertBot'
        elif vert:
            z, zsrc = round(a.cover + dia/2, 1), 'auto-no-slab'
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
        elif side and rtype == 'straight':
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
            z, zsrc = ov['z'], 'starter'
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
        elif side == 'B':
            bond_bar = 'good'
        elif side == 'T':
            bond_bar = 'poor'
        else:
            bond_bar = 'poor'
        # distribution: 2-axis grid from tag (EXT=wxh SP=sxsy) or 1-axis tick.
        # Closed link rects with no EXT= fall back to the drawn rectangle as
        # the zone (spacing from SP=, else H<dia>-<sp>, else 150) — keep EXT=
        # when the field is intentionally smaller than the rect.
        me = LEGEXT.search(raw); ms = LEGSP2.search(raw)
        ex2 = float(me.group(2)) if me and me.group(2) else 0.0
        s2 = float(ms.group(2)) if ms and ms.group(2) else 0.0
        ex1 = float(me.group(1)) if me else 0.0
        s1 = float(ms.group(1)) if ms else 0.0
        ext_src = 'tag' if (ex2 and s2) else ''
        if not (ex2 and s2) and rtype in ('c_link', 'c_link_with_hook') and b.is_closed:
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
        if vert or (ov and ov.get('starter')):
            # generated bars stand alone (no distribution, no tick)
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
            qx,sx,qy,sy = (n,spacing,1,0) if vertical else (1,0,n,spacing)
            # center copies on the line: tick straddles it, app copies don't
            ox = round(-(qx-1)*sx/2, 1) if qx > 1 else 0.0
            oy = round(-(qy-1)*sy/2, 1) if qy > 1 else 0.0
            width_txt = ext_txt
        lap = 0 if rtype in ('c_link', 'c_link_with_hook', 'tie') else (lap_len(dia, bond_bar) if L > a.stock else 0)

        # split > stock into lapped pieces (verticals split upward in Z)
        segs = []; s = 0.0
        if L <= a.stock: segs = [(0.0, L, 0)]
        else:
            while L - s > a.stock:
                segs.append((s, a.stock, lap)); s += a.stock - lap
            segs.append((s, L - s, lap))

        vmark = getattr(b, '_vert_idx', None)
        bmark = f'{mark}-{vmark+1}' if vmark is not None else mark
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
                row['H'] = (ov['H'] if ov and 'H' in ov else leg_h); row['bent_up_down'] = updown or 'up'
                if ov and 'plan_rotation' in ov:
                    row['plan_rotation'] = ov['plan_rotation']
            if rtype in ('c_link', 'c_link_with_hook'):
                row['length'] = round(seglen,1); row['c_length_a'] = link_a; row['c_length_b'] = link_b
                row.pop('Length of Bar', None)
            if rtype == 'tie':
                # closed loop: length = X-side, c_length_a = Y-side; vertical
                # stacking via qty_z (NZ=/auto from host height)
                row['length'] = round(seglen,1); row['c_length_a'] = link_b or tie_h
                row.pop('Length of Bar', None)
                t_sz = tie_sz or spacing or 150
                if tie_nz:
                    row['qty_z'], row['spacing_z'] = tie_nz, t_sz
                elif slab and slab['lz'] - slab.get('covT', 0) - slab.get('covB', 0) > 0:
                    hint = slab['lz'] - slab['covT'] - slab['covB']
                    row['qty_z'], row['spacing_z'] = max(1, int(hint//t_sz)+1), t_sz
                else:
                    row['qty_z'], row['spacing_z'] = 1, 0
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
