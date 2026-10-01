# 장기요양등급판정기준 고시(HWP5) [별표1] 8개 서비스군 수형분석도 복원기 (외부 패키지 없음)
# 사용: python tools/hwp_trees.py
#   입력: sources_raw/05_장기요양등급판정기준_고시_2018-08-01.hwp (읽기 전용)
#   출력: data/grading_trees.json, docs/trees_review.md
# 방법:
#   - 청결·행동변화대응: 묶음 도형(gso 컨테이너) → 사각형(텍스트 상자)·직선 좌표
#   - 배설·식사: 개별 도형(용지 기준 절대 위치) → 사각형·직선 좌표
#   - 기능보조·간접지원·간호처치·재활훈련: 삽입 그림(WMF) → Rectangle·MoveTo/LineTo·ExtTextOut 좌표
#   공통: 직선을 끝점 근접으로 연결해 '부모 마디 아래 → 자식 마디 위' 연결선을 찾고,
#         분할 변수(부모 아래 라벨)와 분할 조건(자식 위 라벨)을 좌표로 배정한다.
import struct, zlib, re, json, os, sys, glob
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HWP = glob.glob(os.path.join(ROOT, 'sources_raw', '05_*.hwp'))[0]

# ---------------------------------------------------------------- CFB / HWP records
data = open(HWP, 'rb').read()
ss = 1 << struct.unpack_from('<H', data, 0x1E)[0]; mss = 1 << struct.unpack_from('<H', data, 0x20)[0]
nfat, dir0 = struct.unpack_from('<II', data, 0x2C); cutoff, mf0, nmf, dif0, ndif = struct.unpack_from('<IIIII', data, 0x38)
def sec(n): return data[512 + n * ss:512 + (n + 1) * ss]
difat = list(struct.unpack_from('<109I', data, 0x4C))
n = dif0
while n not in (0xFFFFFFFE, 0xFFFFFFFF) and ndif:
    v = struct.unpack('<%dI' % (ss // 4), sec(n)); difat += v[:-1]; n = v[-1]; ndif -= 1
fat = []
for f in difat[:nfat]: fat += struct.unpack('<%dI' % (ss // 4), sec(f))
def chain(n):
    out = b''
    while n < 0xFFFFFFFA: out += sec(n); n = fat[n]
    return out
dirs = chain(dir0); ents = []
for i in range(len(dirs) // 128):
    e = dirs[i * 128:(i + 1) * 128]; nl = struct.unpack_from('<H', e, 0x40)[0]
    st, sz = struct.unpack_from('<IQ', e, 0x74)
    ents.append((e[:max(nl - 2, 0)].decode('utf-16le'), e[0x42], st, sz & 0xffffffff))
ministream = chain(ents[0][2]); mfat = []
if nmf:
    m = chain(mf0); mfat = list(struct.unpack('<%dI' % (len(m) // 4), m))
def read(e):
    _, _, st, sz = e
    if sz < cutoff:
        out = b''; n = st
        while n < 0xFFFFFFFA: out += ministream[n * mss:(n + 1) * mss]; n = mfat[n]
        return out[:sz]
    return chain(st)[:sz]
E = {e[0]: e for e in ents}
compressed = read(E['FileHeader'])[36] & 1
def records(d):
    i = 0
    while i + 4 <= len(d):
        h = struct.unpack_from('<I', d, i)[0]; i += 4
        size = (h >> 20) & 0xfff
        if size == 0xfff: size = struct.unpack_from('<I', d, i)[0]; i += 4
        yield h & 0x3ff, (h >> 10) & 0x3ff, d[i:i + size]; i += size
REC = []
for e in sorted([e for e in ents if e[0].startswith('Section') and e[1] == 2], key=lambda e: int(e[0][7:])):
    d = read(e)
    if compressed: d = zlib.decompress(d, -15)
    REC += list(records(d))
def ptext(b):
    t = []; j = 0
    while j + 1 < len(b):
        c = struct.unpack_from('<H', b, j)[0]
        if c in {1,2,3,4,5,6,7,8,9,11,12,14,15,16,17,18,19,20,21,22,23}: j += 16; continue
        if c >= 32: t.append(chr(c))
        j += 2
    return ''.join(t)

# ---------------------------------------------------------------- geometry helpers
def mat_mul(a, b):
    return [a[0]*b[0] + a[1]*b[3], a[0]*b[1] + a[1]*b[4], a[0]*b[2] + a[1]*b[5] + a[2],
            a[3]*b[0] + a[4]*b[3], a[3]*b[1] + a[4]*b[4], a[3]*b[2] + a[4]*b[5] + a[5]]
def apply(m, x, y): return (m[0]*x + m[1]*y + m[2], m[3]*x + m[4]*y + m[5])
def shape_matrix(b):
    top = b[:4] == b[4:8]
    o = (8 if top else 4) + 8 + 4 + 16 + 4 + 2 + 8
    cnt, = struct.unpack_from('<H', b, o); o += 2
    M = list(struct.unpack_from('<6d', b, o)); o += 48
    for _ in range(cnt):
        S = list(struct.unpack_from('<6d', b, o)); o += 48
        R = list(struct.unpack_from('<6d', b, o)); o += 48
        M = mat_mul(M, mat_mul(S, R))
    return M
def subtree(k):
    lvl = REC[k][1]; j = k + 1
    while j < len(REC) and REC[j][1] > lvl: j += 1
    return range(k, j)

def gso_primitives(k, off):
    """gso 컨트롤 하나의 사각형(텍스트)·직선을 절대 좌표로. off=(x,y) 용지 기준 오프셋"""
    rects, lines, pics = [], [], []
    mstack = {}; cur = None
    for j in subtree(k):
        tag, lvl, b = REC[j]
        if tag == 76:
            M = shape_matrix(b)
            parent = [mstack[L] for L in sorted(mstack) if L < lvl]
            if parent: M = mat_mul(parent[-1], M)
            for L in [L for L in mstack if L >= lvl]: del mstack[L]
            mstack[lvl] = M; cur = {'M': M, 'text': []}
        elif tag == 67 and cur is not None:
            t = ptext(b).strip()
            if t: cur['text'].append(t)
        elif tag == 79 and cur is not None:
            p = struct.unpack_from('<8i', b, 1)
            P = [apply(cur['M'], p[i], p[i + 1]) for i in range(0, 8, 2)]
            xs = [q[0] + off[0] for q in P]; ys = [q[1] + off[1] for q in P]
            rects.append({'box': (min(xs), min(ys), max(xs), max(ys)), 'lines': cur['text']})
        elif tag == 78 and cur is not None:
            x1, y1, x2, y2 = struct.unpack_from('<4i', b, 0)
            a = apply(cur['M'], x1, y1); c = apply(cur['M'], x2, y2)
            lines.append(((a[0] + off[0], a[1] + off[1]), (c[0] + off[0], c[1] + off[1])))
        elif tag == 85:
            bid = struct.unpack_from('<H', b, 71)[0]
            pics.append(bid)
    return rects, lines, pics

# ---------------------------------------------------------------- WMF
def wmf_primitives(d):
    o = 22 if struct.unpack_from('<I', d, 0)[0] == 0x9AC6CDD7 else 0
    o += 18
    rects, lines, texts = [], [], []
    pos = (0, 0); fh = 50
    while o + 6 <= len(d):
        size, fn = struct.unpack_from('<IH', d, o)
        if size == 0: break
        r = d[o + 6:o + size * 2]
        if fn == 0x0416:  # Rectangle: bottom, right, top, left
            b_, r_, t_, l_ = struct.unpack_from('<hhhh', r, 0)
            rects.append({'box': (min(l_, r_), min(t_, b_), max(l_, r_), max(t_, b_)), 'lines': []})
        elif fn == 0x0214:
            y, x = struct.unpack_from('<hh', r, 0); pos = (x, y)
        elif fn == 0x0213:
            y, x = struct.unpack_from('<hh', r, 0); lines.append((pos, (x, y))); pos = (x, y)
        elif fn == 0x0a32:
            y, x, n, opts = struct.unpack_from('<hhhH', r, 0)
            p = 8 + (8 if opts & 6 else 0)
            raw_s = r[p:p + n].decode('cp949', 'replace')
            s = raw_s.strip()
            if s:
                lead = (len(raw_s) - len(raw_s.lstrip())) * fh / 2
                w = sum(fh if ord(ch) > 127 else fh / 2 for ch in s)
                texts.append({'x': x + lead, 'y': y, 'text': s, 'w': w, 'h': fh})
        elif fn == 0x02fb:  # CreateFontIndirect: 글자 높이
            h_ = abs(struct.unpack_from('<h', r, 0)[0])
            if h_ > 20: fh = h_
        o += size * 2
    return rects, lines, texts

# ---------------------------------------------------------------- collect primitives per tree
TREE_ORDER = ['청결', '배설', '식사', '기능보조', '행동변화대응', '간접지원', '간호처치', '재활훈련']
headings = []
for k, (tag, lvl, b) in enumerate(REC):
    if tag == 67 and lvl == 1:
        m = re.match(r'\[(\S+) 수형분석도\]', ptext(b).strip())
        if m: headings.append((k, m.group(1)))
assert [h[1] for h in headings] == TREE_ORDER, headings

gsos = [k for k, (tag, lvl, b) in enumerate(REC) if tag == 71 and b[:4][::-1] == b'gso ']
prim = {t: {'rects': [], 'lines': [], 'texts': [], 'kind': None} for t in TREE_ORDER}
bindata = {}
for k in gsos:
    b = REC[k][2]
    attr, voff, hoff = struct.unpack_from('<Iii', b, 4)
    before = [h for h in headings if h[0] < k]
    if not before: continue
    idx = TREE_ORDER.index(before[-1][1])
    # 묶음·그림 트리가 이미 채워진 제목 뒤의 개별 도형은 다음 트리의 것 (앵커 문단이 제목보다 앞에 있음)
    if prim[TREE_ORDER[idx]]['kind'] in ('group', 'picture') and idx + 1 < len(TREE_ORDER): idx += 1
    tree = TREE_ORDER[idx]
    is_group = any(REC[j][0] == 76 and REC[j][1] > REC[k][1] + 1 for j in subtree(k))
    rects, lines, pics = gso_primitives(k, (0, 0) if is_group else (hoff, voff))
    P = prim[tree]
    if pics:
        name = 'BIN%04X.wmf' % pics[0]
        name = [n_ for n_ in E if n_.upper() == name.upper()][0]
        raw = read(E[name])
        try: raw = zlib.decompress(raw, -15)
        except zlib.error: pass
        r2, l2, t2 = wmf_primitives(raw)
        P.update(kind='picture', source=name); P['rects'] += r2; P['lines'] += l2; P['texts'] += t2
    else:
        if P['kind'] is None: P['kind'] = 'group' if is_group else 'loose'
        P['rects'] += rects; P['lines'] += lines

# ---------------------------------------------------------------- build tree from primitives
NODE_RE = re.compile(r'마디\s*(\d+)')
SCORE_RE = re.compile(r'^(\d+(?:\.\d+)?)\s*점$')
def inside(pt, box, tol=0):
    return box[0] - tol <= pt[0] <= box[2] + tol and box[1] - tol <= pt[1] <= box[3] + tol

def normalize(P):
    """→ nodes[{num,score,box}], labels[{text,box}], lines"""
    nodes, labels = [], []
    rects = P['rects']
    if P['kind'] == 'picture':
        # 텍스트 조각을 사각형에 배정
        for t in P['texts']:
            owners = [r for r in rects if inside((t['x'], t['y']), r['box'], 3)]
            if owners:
                owner = min(owners, key=lambda r: (r['box'][2] - r['box'][0]) * (r['box'][3] - r['box'][1]))
                owner['lines'].append(t['text'])
                owner.setdefault('tboxes', []).append((t['x'], t['y'], t['x'] + t['w'], t['y'] + t['h']))
            else:
                labels.append({'text': t['text'], 'box': (t['x'], t['y'], t['x'] + t['w'], t['y'] + t['h']), 'free': True})
    for r in rects:
        txt = ' '.join(r['lines']).strip()
        m = NODE_RE.search(txt)
        if m:
            sc = [SCORE_RE.match(x.strip()) for x in r['lines']]
            sc = [float(s.group(1)) for s in sc if s]
            nodes.append({'num': int(m.group(1)), 'score': sc[0] if sc else None, 'box': r['box']})
        elif txt:
            tb = r.get('tboxes')  # WMF: 상자 대신 실제 글자 범위 (공백으로 채운 넓은 상자 대비)
            box = (min(b[0] for b in tb), min(b[1] for b in tb), max(b[2] for b in tb), max(b[3] for b in tb)) if tb else r['box']
            labels.append({'text': txt, 'box': box})
    # 원문 마디 번호 중복 보정: 같은 번호가 2개이고 빠진 번호가 정확히 1개면, 같은 줄에서 오른쪽 것을 빠진 번호로 (검토 필요 표시)
    corrections = []
    from collections import Counter
    cnt = Counter(n['num'] for n in nodes)
    dups = [k for k, v in cnt.items() if v > 1]
    missing = sorted(set(range(max(cnt) + 1)) - set(cnt))
    if len(dups) == 1 and cnt[dups[0]] == 2 and len(missing) == 1 and missing[0] == dups[0] + 1:
        a, b = sorted([n for n in nodes if n['num'] == dups[0]], key=lambda n: n['box'][0])
        b['num'] = missing[0]
        corrections.append(f'원문 그림에 "마디 {dups[0]}" 이(가) 두 번 표기되고 "마디 {missing[0]}" 이(가) 없음 → 오른쪽 상자(점수 {b["score"]})를 마디 {missing[0]} 로 보정 (원문 표기 오류로 추정, 사람 확인 필요)')
    P['corrections'] = corrections
    # 자유 텍스트 조각 중 가까운 것끼리 합치기 (WMF 줄바꿈 라벨)
    free = [l for l in labels if l.get('free')]; fixed = [l for l in labels if not l.get('free')]
    free.sort(key=lambda l: (l['box'][1], l['box'][0]))
    merged = []
    for l in free:
        for m_ in merged:
            hh = l['box'][3] - l['box'][1]
            if abs(m_['box'][0] - l['box'][0]) < hh and -hh * 0.2 <= l['box'][1] - m_['box'][3] < hh * 0.4:
                m_['text'] += ' ' + l['text']; m_['box'] = (min(m_['box'][0], l['box'][0]), m_['box'][1], max(m_['box'][2], l['box'][2]), l['box'][3]); break
        else: merged.append(dict(l))
    return nodes, fixed + merged, P['lines']

def seg_dist(p, a, b):
    ax, ay = a; bx, by = b; px, py = p
    dx, dy = bx - ax, by - ay; L = dx * dx + dy * dy
    t = 0 if L == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / L))
    return ((px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2) ** 0.5

def build(tree):
    nodes, labels, lines = normalize(prim[tree])
    h = sorted(n['box'][3] - n['box'][1] for n in nodes)[len(nodes) // 2]
    tol = 0.07 * h
    lines = [l for l in lines if (l[0][0] - l[1][0]) ** 2 + (l[0][1] - l[1][1]) ** 2 > (tol / 2) ** 2]
    # 상자 테두리를 따라 그린 선(WMF)은 연결선이 아님
    def on_border(l, box):
        x0, y0, x1, y1 = box
        def edge(p):
            inx = x0 - tol <= p[0] <= x1 + tol; iny = y0 - tol <= p[1] <= y1 + tol
            return (inx and (abs(p[1] - y0) < tol or abs(p[1] - y1) < tol)) or (iny and (abs(p[0] - x0) < tol or abs(p[0] - x1) < tol))
        same_edge = abs(l[0][0] - l[1][0]) < tol or abs(l[0][1] - l[1][1]) < tol
        return same_edge and edge(l[0]) and edge(l[1]) and (
            (abs(l[0][1] - l[1][1]) < tol and min(abs(l[0][1] - y0), abs(l[0][1] - y1)) < tol) or
            (abs(l[0][0] - l[1][0]) < tol and min(abs(l[0][0] - x0), abs(l[0][0] - x1)) < tol))
    boxes = [n['box'] for n in nodes] + [l['box'] for l in labels]
    lines = [l for l in lines if not any(on_border(l, b) for b in boxes)]
    # 직선 연결 요소
    parent = list(range(len(lines)))
    def find(i):
        while parent[i] != i: parent[i] = parent[parent[i]]; i = parent[i]
        return i
    def cross(a, b):  # 세로·가로 선이 서로 관통 (T/十자)
        (ax0, ay0), (ax1, ay1) = a; (bx0, by0), (bx1, by1) = b
        def ccw(p, q, r): return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
        return ccw(a[0], a[1], b[0]) * ccw(a[0], a[1], b[1]) < 0 and ccw(b[0], b[1], a[0]) * ccw(b[0], b[1], a[1]) < 0
    for i, a in enumerate(lines):
        for j, b in enumerate(lines):
            if i < j and (min(seg_dist(p, *b) for p in a) < tol or min(seg_dist(p, *a) for p in b) < tol or cross(a, b)):
                parent[find(i)] = find(j)
    # 라벨 상자에서 끊긴 세로 연결선 잇기 (WMF 는 텍스트 상자 위아래로 선이 나뉘어 그려짐)
    for lb in labels:
        x0, y0, x1, y1 = lb['box']
        above = [(i, p) for i, l in enumerate(lines) for p in l if x0 - tol <= p[0] <= x1 + tol and abs(p[1] - y0) < 2 * tol]
        below = [(i, p) for i, l in enumerate(lines) for p in l if x0 - tol <= p[0] <= x1 + tol and abs(p[1] - y1) < 2 * tol]
        for i, p in above:
            for j, q in below:
                if abs(p[0] - q[0]) < tol: parent[find(i)] = find(j)
    # 같은 x 에서 짧게 끊긴 세로선 잇기 (간격 < 마디 높이의 절반 — 마디 상자를 건너 이을 수는 없음)
    vert = [(i, l) for i, l in enumerate(lines) if abs(l[0][0] - l[1][0]) < tol]
    for i, a in vert:
        for j, b in vert:
            if i < j and abs(a[0][0] - b[0][0]) < tol:
                a0, a1 = sorted([a[0][1], a[1][1]]); b0, b1 = sorted([b[0][1], b[1][1]])
                gap = max(b0 - a1, a0 - b1)
                if 0 <= gap < 0.5 * h: parent[find(i)] = find(j)
    comp = defaultdict(list)
    for i in range(len(lines)): comp[find(i)].append(i)
    def touches(node, edge):
        x0, y0, x1, y1 = node['box']; y = y1 if edge == 'bottom' else y0
        hits = []
        for i, l in enumerate(lines):
            for p in l:
                if x0 - tol <= p[0] <= x1 + tol and abs(p[1] - y) < 2.5 * tol:
                    hits.append((find(i), p))
        return hits
    by_num = {n['num']: n for n in nodes}
    out_c = {n['num']: touches(n, 'bottom') for n in nodes}
    in_c = {n['num']: touches(n, 'top') for n in nodes}
    children = defaultdict(list); parents = defaultdict(list)
    for pn, hits in out_c.items():
        cids = {c for c, _ in hits}
        for cn, hits2 in in_c.items():
            if cn != pn and cids & {c for c, _ in hits2} and cn not in children[pn]:
                children[pn].append(cn); parents[cn].append(pn)
    out = {'tree': tree, 'nodes': {}, 'problems': [], 'corrections': prim[tree].get('corrections', [])}
    used = set()
    for pn, ch in children.items():
        P_ = by_num[pn]; ch.sort(key=lambda c: by_num[c]['box'][0])
        comp_ids = {c for c, _ in out_c[pn]}
        pts = [p for c in comp_ids for i in comp[c] for p in lines[i]]
        px = sum(p[0] for c, p in out_c[pn]) / len(out_c[pn])
        ctop = min(by_num[c]['box'][1] for c in ch)
        horiz = [lines[i] for c in comp_ids for i in comp[c] if abs(lines[i][0][1] - lines[i][1][1]) < tol
                 and P_['box'][3] < lines[i][0][1] < ctop]
        bar = max(horiz, key=lambda l: abs(l[0][0] - l[1][0]))[0][1] if horiz else (P_['box'][3] + ctop) / 2
        cy = lambda l: (l['box'][1] + l['box'][3]) / 2
        cx = lambda l: (l['box'][0] + l['box'][2]) / 2
        cand = [l for l in labels if P_['box'][3] - tol <= cy(l) <= bar + tol and not NODE_RE.search(l['text'])]
        split = min(cand, key=lambda l: abs(cx(l) - px) + (0 if l['box'][0] - tol <= px <= l['box'][2] + tol else 1e6), default=None)
        conds = {}
        split_y = cy(split) if split else P_['box'][3]
        for c in ch:
            ix = [p for cc, p in in_c[c] if cc in comp_ids]
            x = sum(p[0] for p in ix) / len(ix)
            cc_ = [l for l in labels if split_y < cy(l) <= by_num[c]['box'][1] + tol and l is not split]
            best = min(cc_, key=lambda l: min(abs(l['box'][0] - x), abs(l['box'][2] - x), 0 if l['box'][0] <= x <= l['box'][2] else 1e9), default=None)
            conds[c] = best['text'] if best else None
            if best is not None:
                if id(best) in used: out['problems'].append(f'라벨 "{best["text"]}" 이(가) 여러 조건에 사용됨 (마디 {c})')
                used.add(id(best))
        out['nodes'][pn] = {'split_label': split['text'] if split else None, 'children': ch, 'conds': conds}
    return nodes, children, parents, out

# ---------------------------------------------------------------- label → predicate
ITEMS = json.load(open(os.path.join(ROOT, 'data', 'assessment_items.json'), encoding='utf-8'))['items']
def key(s): return re.sub(r'[\s∙·․,、\.]', '', s).replace('관절', '관절')
ITEM_BY_NAME = {}
for it in ITEMS:
    if not it['in_v52']: continue
    nm = it['official_item_name']
    ITEM_BY_NAME[key(nm)] = it['id']
    if nm.startswith('운동장애-') or nm.startswith('관절제한-'):
        short = nm.split('-', 1)[1]
        ITEM_BY_NAME[key(short)] = it['id']
        ITEM_BY_NAME[key(short.replace('관절', ''))] = it['id']
ITEM_BY_NAME[key('의미없거나 부적절한 행동')] = 'BEH-11'
ITEM_BY_NAME[key('불규칙수면주야혼돈')] = 'BEH-04'
DOMAIN = {'신체기능': 'PHY', '인지기능': 'COG', '행동변화': 'BEH', '간호처치': 'NUR', '재활': 'REH'}
def parse_var(label):
    if label is None: return None
    if '환산' in label:
        for k_, v_ in DOMAIN.items():
            if label.replace(' ', '').startswith(k_): return {'type': 'domain', 'domain': v_}
        return None
    k_ = key(label)
    if k_ in ITEM_BY_NAME: return {'type': 'item', 'item': ITEM_BY_NAME[k_]}
    for nm, iid in ITEM_BY_NAME.items():
        if nm and (nm in k_ or k_ in nm) and len(k_) >= 3: return {'type': 'item', 'item': iid}
    return None
LEVEL_WORDS = [('완전자립', 1), ('부분도움', 2), ('완전도움', 3),
               ('운동장애없음', 1), ('불완전운동장애', 2), ('완전운동장애', 3),
               ('제한없음', 1), ('한쪽관절제한', 2), ('양관절제한', 3), ('양쪽관절제한', 3)]
def parse_cond(label, var):
    if label is None or var is None: return None
    s = label.replace(' ', '').replace('점', '')
    if var['type'] == 'domain':
        s = s.replace(',', '')
        nums = [float(x) for x in re.findall(r'\d+(?:\.\d+)?', s)]
        m = re.fullmatch(r'(\d+(?:\.\d+)?)초과(\d+(?:\.\d+)?)이하', s)
        if m: return {'gt': float(m.group(1)), 'le': float(m.group(2))}
        m = re.fullmatch(r'(\d+(?:\.\d+)?)(이하|초과|미만|이상)', s)
        if m:
            return {{'이하': 'le', '초과': 'gt', '미만': 'lt', '이상': 'ge'}[m.group(2)]: float(m.group(1))}
        m = re.fullmatch(r'(\d+(?:\.\d+)?)', s)
        if m: return {'eq': float(m.group(1))}
        return None
    iid = var['item']
    if iid.startswith(('PHY', 'REH')):
        vals = set()
        rest = s
        for w, v_ in sorted(LEVEL_WORDS, key=lambda x: -len(x[0])):
            if w in rest: vals.add(v_); rest = rest.replace(w, '')
        if re.sub(r'[,또는및]', '', rest): return None
        return {'in': sorted(vals)} if vals else None
    if s in ('유', '있음', '예', '있다', '증상있음'): return {'eq': 1}
    if s in ('무', '없음', '아니오', '없다', '증상없음'): return {'eq': 0}
    return None

# ---------------------------------------------------------------- validation targets (고시 본문)
RAW = open(os.path.join(ROOT, 'data', 'raw_text', '05_등급판정기준_고시_본문.txt'), encoding='utf-8').read()
def text_targets(tree):
    sect = RAW.split('[별표1]')[1]
    m = re.search(tree + r'\s*서비스\s*군\s*수형분석(.*?)\[' + tree + r' 수형분석도\]', sect, re.S)
    body = m.group(1)
    leaves = int(re.search(r'(\d+)개\s*(?:의\s*)?최종마디', body).group(1))
    m2 = re.search(r'(\d+)개 마디 중 (\d+)번 마디.*?나타난\s*(\d+(?:\.\d+)?)점', body, re.S)
    return {'leaves': leaves, 'total': int(m2.group(1)), 'example_node': int(m2.group(2)), 'example_score': float(m2.group(3)), 'text': body.strip()}
# 본문 가)~라)의 첫 분할 (사람이 본문을 읽고 옮긴 대조표)
FIRST_SPLITS = {
    '청결': {0: ('domain:PHY', [1, 2]), 1: ('domain:PHY', [3, 4]), 2: ('item:PHY-03', [5, 6])},
    '배설': {0: ('item:PHY-06', [1, 2]), 1: ('item:PHY-12', [3, 4, 5]), 2: ('item:PHY-05', [6, 7])},
    '식사': {0: ('item:PHY-05', [1, 2]), 1: ('item:PHY-03', [3, 4]), 2: ('domain:REH', [5, 6])},
    '기능보조': {0: ('domain:PHY', [1, 2]), 1: ('domain:PHY', [3, 4]), 2: ('item:PHY-03', [5, 6])},
    '행동변화대응': {0: ('domain:BEH', [1, 2]), 1: ('domain:BEH', [3, 4]), 2: ('domain:COG', [5, 6])},
    '간접지원': {0: ('domain:PHY', [1, 2]), 1: ('domain:PHY', [3, 4]), 2: ('item:BEH-09', [5, 6])},
    '간호처치': {0: ('item:NUR-04', [1, 2]), 1: ('domain:NUR', [3, 4, 5]), 2: ('item:PHY-05', [6, 7])},
    '재활훈련': {0: ('domain:REH', [1, 2, 3]), 1: ('item:BEH-07', [4, 5]), 2: ('item:PHY-02', [6, 7]), 3: ('item:BEH-03', [8, 9])},
}
CONV = json.load(open(os.path.join(ROOT, 'data', 'grading_formula.json'), encoding='utf-8'))['conversion_tables']
DOMAIN_VALUES = {'PHY': sorted(CONV['신체기능'].values()), 'COG': sorted(CONV['인지기능'].values()), 'BEH': sorted(CONV['행동변화'].values()),
                 'NUR': sorted(CONV['간호처치'].values()), 'REH': sorted(CONV['재활'].values())}
def holds(c, x):
    ok = True
    if 'eq' in c: ok &= abs(x - c['eq']) < 1e-9
    if 'in' in c: ok &= x in c['in']
    if 'le' in c: ok &= x <= c['le'] + 1e-9
    if 'lt' in c: ok &= x < c['lt'] - 1e-9
    if 'ge' in c: ok &= x >= c['ge'] - 1e-9
    if 'gt' in c: ok &= x > c['gt'] + 1e-9
    return ok
def var_domain(var):
    if var['type'] == 'domain': return DOMAIN_VALUES[var['domain']]
    return [1, 2, 3] if var['item'].startswith(('PHY', 'REH')) else [0, 1]

# ---------------------------------------------------------------- run
result = {'_meta': {
    'title': '장기요양등급판정기준 고시 [별표1] 8개 서비스군 수형분석도 (HWP 도형·WMF 좌표에서 자동 복원)',
    'source': 'sources_raw/05_장기요양등급판정기준_고시_2018-08-01.hwp',
    'generator': 'tools/hwp_trees.py',
    'status': 'RECONSTRUCTED_UNVERIFIED',
    'status_note': '자동 검증(마디 수·최종마디 수·본문 예시 점수·본문 첫 분할·조건 상호배타/완전성·부모 점수 범위)을 통과했더라도, 사람이 원문 그림과 docs/trees_review.md 를 대조하기 전까지 RECONSTRUCTED_UNVERIFIED. 대조 후 status 를 OFFICIAL_VERIFIED 로 바꾸면 채점 엔진이 트리 점수를 주 추정치로 사용한다.',
    'predicate_format': "split.var = {type:'domain', domain:PHY|COG|BEH|NUR|REH} (영역별 100점 환산점수) 또는 {type:'item', item:항목ID} (신체·재활 항목=1/2/3 척도, 인지·행동·간호 항목=1(예/있다)/0). cond 는 {le|lt|ge|gt|eq: 값} 또는 {in: [척도값]}",
}, 'trees': {}}
review = ['# 수형분석도 복원 검토표', '',
          '> 생성: `python tools/hwp_trees.py` · 원문: `sources_raw/05_장기요양등급판정기준_고시_2018-08-01.hwp` [별표1]',
          '> 상태: **RECONSTRUCTED_UNVERIFIED** — 아래 표를 한글(HWP) 원문 그림과 한 줄씩 대조한 뒤 `data/grading_trees.json` 의 `_meta.status` 와 각 트리 `status` 를 `OFFICIAL_VERIFIED` 로 바꾸세요.', '']
all_ok = True
for tree in TREE_ORDER:
    nodes, children, parents, info = build(tree)
    tgt = text_targets(tree)
    nums = sorted(n['num'] for n in nodes)
    by = {n['num']: n for n in nodes}
    checks = []; problems = list(info['problems'])
    def chk(name, ok, detail=''):
        checks.append({'check': name, 'ok': bool(ok), 'detail': detail})
    chk('마디 번호 0..N 연속·중복 없음', nums == list(range(len(nums))), f'{len(nums)}개, 최대 {max(nums)}')
    chk(f'마디 수 = 본문 {tgt["total"]}개', max(nums) == tgt['total'] or len(nums) == tgt['total'], f'번호 최대 {max(nums)}, 개수 {len(nums)}')
    leaves = [n for n in nums if n not in children]
    if info['corrections']:
        # 원문 그림의 번호 중복(같은 번호 2개) 때문에 본문은 '서로 다른 번호' 기준으로 센 것으로 보임 → 보정된 마디(최종마디)를 빼고 비교
        fixed = [int(re.search(r'마디 (\d+) 로 보정', c).group(1)) for c in info['corrections']]
        distinct_leaves = [n for n in leaves if n not in fixed]
        chk(f'최종마디 수 = 본문 {tgt["leaves"]}개 (원문 번호 중복 보정 반영)', len(distinct_leaves) == tgt['leaves'],
            f'복원 {len(leaves)}개 = 서로 다른 원문 번호 {len(distinct_leaves)}개 + 보정 마디 {fixed}')
    else:
        chk(f'최종마디 수 = 본문 {tgt["leaves"]}개', len(leaves) == tgt['leaves'], f'복원 {len(leaves)}개')
    chk(f'본문 예시: 마디 {tgt["example_node"]} = {tgt["example_score"]}점 (최종마디)', tgt['example_node'] in leaves and by.get(tgt['example_node'], {}).get('score') == tgt['example_score'],
        f'복원 {by.get(tgt["example_node"], {}).get("score")}')
    chk('부모 1개씩, 뿌리=마디 0', all(len(parents[n]) == 1 for n in nums if n != 0) and not parents[0], str({n: parents[n] for n in nums if len(parents[n]) != (0 if n == 0 else 1)}))
    chk('모든 마디 점수 있음', all(by[n]['score'] is not None for n in nums))
    # 분할 해석
    tjson = {'status': 'RECONSTRUCTED_UNVERIFIED', 'source_kind': prim[tree]['kind'], 'source': prim[tree].get('source', 'HWP 본문 도형'), 'text_targets': {k: v for k, v in tgt.items() if k != 'text'}, 'nodes': {}}
    first_ok = True; excl_ok = True; mean_ok = True
    for n in nums:
        node = {'score': by[n]['score']}
        if n in children:
            s = info['nodes'][n]; var = parse_var(s['split_label'])
            node['split'] = {'label': s['split_label'], 'var': var}
            node['children'] = []
            for c in s['children']:
                cond = parse_cond(s['conds'][c], var)
                node['children'].append({'node': c, 'label': s['conds'][c], 'cond': cond})
                if cond is None: problems.append(f'마디 {n}→{c}: 조건 "{s["conds"][c]}" 해석 실패 (분할 "{s["split_label"]}")')
            if var is None: problems.append(f'마디 {n}: 분할 변수 "{s["split_label"]}" 해석 실패')
            if n in FIRST_SPLITS[tree]:
                want_var, want_ch = FIRST_SPLITS[tree][n]
                got_var = None if var is None else (f'domain:{var["domain"]}' if var['type'] == 'domain' else f'item:{var["item"]}')
                if got_var != want_var or [c['node'] for c in node['children']] != want_ch:
                    first_ok = False; problems.append(f'마디 {n}: 본문 첫 분할 {want_var}→{want_ch} 과 다름 (복원 {got_var}→{[c["node"] for c in node["children"]]})')
            cs = [by[c]['score'] for c in s['children']]
            if by[n]['score'] is not None and None not in cs and not (min(cs) - 0.05 <= by[n]['score'] <= max(cs) + 0.05):
                mean_ok = False; problems.append(f'마디 {n}: 점수 {by[n]["score"]} 이 자식 점수 범위 {cs} 밖 (평균이어야 함)')
        tjson['nodes'][str(n)] = node
    # 상호배타·완전성: 뿌리부터 내려가며, 조상에서 이미 좁혀진 값 범위 안에서 검사
    def vkey(var): return var['domain'] if var['type'] == 'domain' else var['item']
    stack = [(0, {})]
    while stack:
        n, allowed = stack.pop()
        nd = tjson['nodes'].get(str(n), {})
        if 'split' not in nd or nd['split']['var'] is None: continue
        var = nd['split']['var']; k = vkey(var)
        dom = allowed.get(k, var_domain(var))
        conds = [ch['cond'] for ch in nd['children']]
        if not all(conds): continue
        for x in dom:
            cnt_ = sum(holds(c, x) for c in conds)
            if cnt_ != 1: excl_ok = False; problems.append(f'마디 {n}: 값 {x} 에서 조건 {cnt_}개 성립 (상호배타·완전성 위반)')
        for ch in nd['children']:
            sub = [x for x in dom if holds(ch['cond'], x)]
            if not sub: excl_ok = False; problems.append(f'마디 {n}→{ch["node"]}: 도달 가능한 값이 없음')
            stack.append((ch['node'], {**allowed, k: sub}))
    chk('본문 가)~라) 첫 분할과 일치', first_ok)
    # 본문 '그 다음 단계(…)' 에 나열된 분할 변수 집합 = 첫 분할 이후 복원된 분할 변수 집합
    m_next = re.search(r'그 다음 단계\((.*?)\)에서도', tgt['text'], re.S)
    if m_next:
        names = [re.sub(r'^[가-힣]-[①-⑳]\s*', '', x.strip()) for x in re.split(r',\s*(?=[가-힣]-[①-⑳]|\S+ 영역)', m_next.group(1))]
        names = [re.sub(r'\d+\)$', '', x).strip() for x in names]
        want = set(); bad = []
        for nm in names:
            v_ = parse_var(nm)
            if v_ is None: bad.append(nm)
            else: want.add(vkey(v_))
        got = {vkey(nd['split']['var']) for k_, nd in tjson['nodes'].items() if 'split' in nd and nd['split']['var'] and int(k_) not in FIRST_SPLITS[tree]}
        chk('본문 "그 다음 단계" 변수 목록 = 복원된 하위 분할 변수', want == got and not bad, f'본문 {sorted(want)} / 복원 {sorted(got)}' + (f' / 해석 못한 본문 이름 {bad}' if bad else ''))
    chk('각 분할 조건이 모든 값에서 정확히 하나만 성립', excl_ok)
    chk('부모 점수가 자식 점수 범위 안 (평균 성질)', mean_ok)
    chk('해석 실패 없음', not any('해석 실패' in p for p in problems))
    tjson['checks'] = checks; tjson['problems'] = problems; tjson['corrections'] = info['corrections']
    tjson['all_checks_passed'] = all(c['ok'] for c in checks) and not problems
    all_ok &= tjson['all_checks_passed']
    result['trees'][tree] = tjson
    # review markdown
    review += [f'## {tree} ({"그림 " + prim[tree]["source"] if prim[tree]["kind"] == "picture" else "HWP 도형"}) — {"✅ 자동 검증 통과" if tjson["all_checks_passed"] else "⚠️ 문제 있음"}', '']
    review += ['| 자동 검증 | 결과 | 내용 |', '|---|---|---|'] + [f'| {c["check"]} | {"✅" if c["ok"] else "❌"} | {c["detail"]} |' for c in checks] + ['']
    if problems: review += ['**문제:**'] + [f'- {p}' for p in problems] + ['']
    if info['corrections']: review += ['**자동 보정 (반드시 원문 확인):**'] + [f'- {p}' for p in info['corrections']] + ['']
    review += ['| 마디 | 점수 | 분할 변수(원문 라벨) | 자식 마디 ← 조건(원문 라벨) |', '|---|---|---|---|']
    for n in nums:
        nd = tjson['nodes'][str(n)]
        if 'split' in nd:
            review.append(f'| {n} | {nd["score"]} | {nd["split"]["label"]} | ' + '<br>'.join(f'{c["node"]} ← {c["label"]}' for c in nd['children']) + ' |')
        else:
            review.append(f'| {n} | **{nd["score"]}** | (최종마디) | |')
    review += ['', '<details><summary>고시 본문 설명</summary>', '', tgt['text'], '', '</details>', '']
    print(f'{tree}: nodes={len(nums)} leaves={len(leaves)} checks={"OK" if tjson["all_checks_passed"] else "FAIL"}')
    for p in problems: print('   -', p)
    for c in checks:
        if not c['ok']: print('   x', c['check'], c['detail'])

result['_meta']['all_automatic_checks_passed'] = bool(all_ok)
os.makedirs(os.path.join(ROOT, 'docs'), exist_ok=True)
json.dump(result, open(os.path.join(ROOT, 'data', 'grading_trees.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
open(os.path.join(ROOT, 'docs', 'trees_review.md'), 'w', encoding='utf-8').write('\n'.join(review) + '\n')
print('all automatic checks passed:', all_ok)
