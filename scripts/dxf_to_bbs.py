# dxf_to_bbs.py - DXF plan -> barbending rebar_scheduling.csv + *_bbs.json project
# Usage: py scripts/dxf_to_bbs.py inputs/bar_plan_bbs.dxf [--bond poor|good] [--stock 12000] [--out out.csv]
# Convention (written into bar_plan_bbs.dxf):
#   centerline LWPOLYLINE on REBAR-H<dia>  -> bar length + position (WCS mm)
#   cyan tick on REBAR-EXTENT, PERPENDICULAR -> its LENGTH = distribution width
#   TEXT tag  "B1 H32-150-T Z=1000 EXT=1800 HOST=GL23-Roof"
#     MARK H<dia>-<spacing>-<T/B> Z=<z> EXT=<width> HOST=<group>
#     Z = Pos_z (plan has no Z), EXT cross-checks the tick, T = straight top bar
#   closed LWPOLYLINE on CONC-* + tag "C1 SLAB GL23-Roof THK=1000 Z=0"
#     footprint from rect bbox (x/y/lx/ly), lz=THK, z=Z; name MUST equal bars' HOST
#   bent bars:  add "BENT H=<leg> UP|DOWN", e.g. "B3 H25-150-T BENT H=800 UP Z=500 EXT=1800"
#   links:      closed rect on REBAR-H<dia> + "LINK A=<a> B=<b>", e.g. "S1 H10-150 LINK A=400 B=600 Z=500 EXT=2000"
#   hooked links: "LINK_HOOK L=<spine> A=<a> B=<b> [DOUBLE]", e.g.
#     "B1155 H13 LINK_HOOK L=1120 A=160 B=110 SINGLE Z=696 EXT=900x4050 SP=300x450 HOST=C_Links_Hook VIEW=XZ ROT=90"
#     L=/A=/B= override measurement (geometry keeps Pos + direction only);
#     EXT=wxh + SP=sxsy gives a 2-axis grid (qty=round(w/s)+1 per axis);
#     VIEW= sets Plane (default XY), ROT= overrides Pos_Rotation; DOUBLE = hook both ends
#   grids are CENTERED on the drawn anchor via offset_x/offset_y (the app copies
#   one-sided from Pos, but the tick straddles the line / the grid sits mid-rect)
# Lap: stock 12 m max; EC2 table mirrors src/bbs/calc.js LAP_TABLE.
import argparse, csv, json, math, re, sys, time
import ezdxf

MASTER = ['Rebar_tag','Bar_mark','Rebar_Type','Shape_Code','Dia',
'Pos_x','Pos_y','Pos_z','Group','Pos_Rotation','Plane',
'Length of Bar','H','bent_up_down','Long_length','Crank_step','Length of Lap',
'DC_Lap_Start','DC_Lap_Mid','DC_Tail_Length',
'c_length_a','c_length_b','length','double_hook',
'qty_x','spacing_x','qty_y','spacing_y',
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

TAG = re.compile(r'(B\w+|S\w+)?\s*H(\d+)', re.I)
LEGSP = re.compile(r'H\d+\s*-\s*(\d+)', re.I)
TYPEW = re.compile(r'\b(BENT|LINK_HOOK|LINK|C_LINK|HOOK|STRAIGHT)\b', re.I)
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
    ap.add_argument('dxf'); ap.add_argument('--bond', default='poor', choices=['good','poor'])
    ap.add_argument('--stock', type=float, default=12000)
    ap.add_argument('--out', default='')
    a = ap.parse_args()

    doc = ezdxf.readfile(a.dxf); msp = doc.modelspace()
    texts = [(t.plain_text(), t.dxf.insert) for t in msp.query('TEXT MTEXT')
             if TAG.search(t.plain_text())]
    cticks = [(t.plain_text(), t.dxf.insert) for t in msp.query('TEXT MTEXT')
              if CONCTAG.search(t.plain_text()) and not TAG.search(t.plain_text())]
    ticks = [e for e in msp.query('LWPOLYLINE') if e.dxf.layer == 'REBAR-EXTENT']
    bars  = [e for e in msp.query('LWPOLYLINE') if e.dxf.layer.startswith('REBAR-H')]
    rects = [e for e in msp.query('LWPOLYLINE')
             if e.dxf.layer.startswith('CONC-') and e.is_closed]
    print(f'{len(bars)} centerlines, {len(ticks)} extent ticks, {len(texts)} bar tags, {len(rects)} concrete rects, {len(cticks)} concrete tags')

    # ---- concrete rects: bbox footprint + THK/Z tag -> app box member ----
    concretes = []
    for i, r in enumerate(rects):
        pts = [(p[0], p[1]) for p in r.vertices()]
        xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
        x0, y0 = min(xs), min(ys)
        cx, cy = (min(xs)+max(xs))/2, (min(ys)+max(ys))/2
        m = None
        if cticks:
            cs = min(cticks, key=lambda t: math.hypot(t[1][0]-cx, t[1][1]-cy))
            m = CONCTAG.search(cs[0])
        g = m.groups() if m else (None, None, None, None, None)
        cid = (g[0] or f'c{i+1}').strip()
        kind = (g[1] or r.dxf.layer.replace('CONC-', '') or 'Slab').strip()
        name = (g[2] or f'{kind} {cid}').strip()
        thk = float(g[3]) if g[3] else 0.0
        z = float(g[4]) if g[4] else 0.0
        concretes.append({'id': cid.lower(), 'name': name,
            'lx': round(max(xs)-min(xs), 1), 'ly': round(max(ys)-min(ys), 1),
            'lz': thk, 'x': round(x0, 2), 'y': round(y0, 2), 'z': z})
        print(f'{r.dxf.layer} bbox x={x0:.1f} y={y0:.1f} lx={max(xs)-min(xs):.1f} ly={max(ys)-min(ys):.1f} -> id={cid.lower()} name={name} lz={thk} z={z}')
    cmap = {c['id']: c['id'] for c in concretes} | {c['name'].lower(): c['id'] for c in concretes}

    rows = []; tag = 0
    for b in bars:
        pts = list(b.vertices()); (x1,y1),(x2,y2) = pts[0][:2], pts[1][:2]
        L = math.hypot(x2-x1, y2-y1)
        ang = round(math.degrees(math.atan2(y2-y1, x2-x1)), 1)
        ux, uy = ((x2-x1)/L, (y2-y1)/L) if L else (1,0)
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
        # with the layer (bars overlap in Y, so pure distance mis-pairs)
        lay_dia_n = int(lay_dia.group(1)) if lay_dia else 0
        def score(t):
            m2 = TAG.search(t[0])
            d = dseg(t[1][0], t[1][1])
            tag_dia = int(m2.group(2)) if m2 and m2.group(2) else 0
            return d + (0 if tag_dia == lay_dia_n else 5000)
        best = min(texts, key=score, default=None)
        raw = best[0] if best else ''
        m = TAG.search(raw) if best else None
        mark = (m.group(1) if m and m.group(1) else f'B{len(rows)+1}')
        dia = int(m.group(2)) if m and m.group(2) else int(lay_dia.group(1))
        sp0 = LEGSP.search(raw); spacing = int(sp0.group(1)) if sp0 else 150
        mz = LEGZ.search(raw); z = float(mz.group(1)) if mz else 0.0
        mhst = LEGHOST.search(raw); host = mhst.group(1) if mhst else ''
        mv = LEGVW.search(raw); plane = mv.group(1).upper() if mv else 'XY'
        mr = LEGROT.search(raw); rot = float(mr.group(1)) if mr else ang
        # shape keywords: BENT H=<leg> UP/DOWN | LINK A=<a> B=<b> | LINK_HOOK + DOUBLE
        tw = TYPEW.search(raw); tword = tw.group(1).upper() if tw else ''
        if tword == 'BENT':
            rtype = 'bent'
        elif tword in ('LINK_HOOK', 'HOOK'):
            rtype = 'c_link_with_hook'
        elif tword in ('LINK', 'C_LINK'):
            rtype = 'c_link'
        else:
            rtype = 'straight'
        dbl = bool(DOUBLEW.search(raw))
        mh = LEGH.search(raw); leg_h = float(mh.group(1)) if (mh and rtype == 'bent') else 0.0
        mu = UD.search(raw); updown = mu.group(1).lower() if (mu and rtype == 'bent') else ''
        ma = LEGE.search(raw); mb = LEGB.search(raw)
        link_a = float(ma.group(1)) if (ma and rtype in ('c_link', 'c_link_with_hook')) else 0.0
        link_b = float(mb.group(1)) if (mb and rtype in ('c_link', 'c_link_with_hook')) else 0.0
        ml = LEGLEN.search(raw); exp_len = float(ml.group(1)) if ml else 0.0
        if exp_len:
            L = exp_len  # explicit dims win; geometry keeps Pos + direction only
        if rtype in ('c_link', 'c_link_with_hook') and b.is_closed and not exp_len:
            # closed stirrup rect w x h -> spine L=w, legs A=B=h unless tag overrides
            q = [(p[0], p[1]) for p in b.vertices()]
            w = math.hypot(q[1][0]-q[0][0], q[1][1]-q[0][1])
            hside = math.hypot(q[2][0]-q[1][0], q[2][1]-q[1][1]) if len(q) > 2 else w
            spine, lega, legb = (w, hside, hside) if w >= hside else (hside, w, w)
            L = spine
            link_a = link_a or lega; link_b = link_b or legb
        # distribution: 2-axis grid from tag (EXT=wxh SP=sxsy) or 1-axis tick
        me = LEGEXT.search(raw); ms = LEGSP2.search(raw)
        ex2 = float(me.group(2)) if me and me.group(2) else 0.0
        s2 = float(ms.group(2)) if ms and ms.group(2) else 0.0
        ex1 = float(me.group(1)) if me else 0.0
        s1 = float(ms.group(1)) if ms else 0.0
        ext_tick = 0.0
        # Grids are CENTERED on the drawn anchor: the app copies one-sided
        # (Pos + ix*spacing) but drafters center the line in its zone (the cyan
        # tick straddles the bar), so emit negative offsets to recenter.
        # Closed rects: grid centered inside the rect (leftover splits evenly).
        ox, oy = 0.0, 0.0
        if ex2 and s2:
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
        lap = 0 if rtype in ('c_link', 'c_link_with_hook') else (lap_len(dia, a.bond) if L > a.stock else 0)

        # split > stock into lapped pieces
        segs = []; s = 0.0
        if L <= a.stock: segs = [(0.0, L, 0)]
        else:
            while L - s > a.stock:
                segs.append((s, a.stock, lap)); s += a.stock - lap
            segs.append((s, L - s, lap))

        for k,(off,seglen,ll) in enumerate(segs):
            tag += 1
            px, py = round(x1+ux*off,2), round(y1+uy*off,2)
            row = {'Rebar_tag':tag,'Bar_mark':mark if len(segs)==1 else f'{mark}-P{k+1}',
                'Rebar_Type':rtype,'Dia':dia,'Pos_x':px,'Pos_y':py,'Pos_z':z,
                'Group':host,'Pos_Rotation':rot,'Plane':plane,'Length of Bar':round(seglen,1),
                'Length of Lap':ll if len(segs)>1 else '',
                'qty_x':qx,'spacing_x':sx,'qty_y':qy,'spacing_y':sy,
                'offset_x':ox,'offset_y':oy,
                'qty':1,'Visible':1,
                'feature':f'stock-split {k+1}/{len(segs)} {a.bond} lap={ll}' if len(segs)>1 else f'EXT tick={round(ext_tick,0)} TXT={round(width_txt,0)} n={qx}x{qy}'}
            if rtype == 'bent':
                row['H'] = leg_h; row['bent_up_down'] = updown or 'up'
            if rtype in ('c_link', 'c_link_with_hook'):
                row['length'] = round(seglen,1); row['c_length_a'] = link_a; row['c_length_b'] = link_b
                row.pop('Length of Bar', None)
            if rtype == 'c_link_with_hook':
                row['double_hook'] = 'yes' if dbl else 'no'
            # direct host link so project JSON opens already hosted
            if host and host.lower() in cmap:
                row['host'] = cmap[host.lower()]
            rows.append(row)

        print(f'{b.dxf.layer} L={L:.1f} ang={ang} dia=H{dia} z={z} plane={plane} rot={rot} grid={qx}x{qy} @ {sx}x{sy} | lap({a.bond})={lap} -> {len(segs)} piece(s) [{rtype}]')

    out = a.out or a.dxf.rsplit('.',1)[0] + f'_{a.bond}.csv'
    with open(out,'w',newline='') as f:
        w = csv.DictWriter(f, fieldnames=MASTER, extrasaction='ignore'); w.writeheader(); w.writerows(rows)
    print('wrote', out, f'({len(rows)} rows)')
    # direct-import project file (FileBar -> import): bars + concrete + bond
    jout = out.rsplit('.',1)[0] + '_bbs.json'
    proj = {'v':1,'app':'barbending','savedAt':int(time.time()*1000),
            'bars':rows,'concretes':concretes,'refLines':[],
            'cover':40,'bond':a.bond,'selectedBar':0,
            'selectedBars':[0] if rows else []}
    with open(jout,'w') as f:
        json.dump(proj, f, indent=2)
    print('wrote', jout, f'({len(concretes)} concrete, {len(rows)} bars)')

if __name__ == '__main__':
    sys.exit(main())
