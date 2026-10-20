import sys, json, re, os
sys.path.insert(0, os.path.dirname(__file__))
from pb import parse
FONT = re.compile(r'^\W*(Menlo|Helvetica|SF|Avenir|Times|Georgia|Arial|\.SF)[\w-]*\W*$')
def strings(b, depth=0, out=None):
    out = [] if out is None else out
    try: fs = parse(b)
    except Exception: return out
    for f, t, v in fs:
        if t != 'b' or not v: continue
        txt = None
        try:
            txt = v.decode('utf-8')
        except UnicodeDecodeError: pass
        sub = None
        if depth < 12:
            try: sub = parse(v)
            except Exception: sub = None
        if txt is not None and sum(ch.isalpha() for ch in txt) >= 2 and (sub is None or sum(ch.isalpha() or ch == ' ' for ch in txt) > len(txt) * .6):
            if not FONT.match(txt.strip()): out.append(txt)
        elif sub is not None:
            strings(v, depth + 1, out)
    return out
def load(path):
    d = open(path, 'rb').read()
    top = parse(d)[0][2]; X = [v for f, t, v in parse(top) if f == 2][0]; Y = parse(X)
    items = parse(Y[0][2])
    nodes, parent, children = {}, {}, {}
    for f, t, v in items:
        if f == 2:
            e = parse(v); nid = e[0][2].hex()
            body = [x for x in e if x[0] == 2]
            txt = []
            if body:
                for ff, tt, vv in parse(body[0][2]):
                    if ff == 11: txt = strings(vv)
            nodes[nid] = ' '.join(s.strip() for s in txt).strip()
        elif f == 3:
            for ff, tt, vv in parse(v):
                if ff != 2: continue
                try: e = parse(vv)
                except Exception: continue
                ids = {}
                for a, b2, c in e:
                    if b2 == 'b' and len(c) == 16: ids.setdefault(a, []).append(c.hex())
                if 1 in ids:
                    me = ids[1][0]
                    if 2 in ids: parent[me] = ids[2][0]
                    children[me] = ids.get(3, [])
    return nodes, parent, children
def outline(nodes, parent, children):
    roots = [n for n in children if n not in parent or parent[n] not in children]
    lines, seen = [], set()
    def walk(n, d):
        if n in seen: return
        seen.add(n)
        t = nodes.get(n, '')
        if t: lines.append('  ' * d + '- ' + t.replace('\n', ' / '))
        for c in children.get(n, []): walk(c, d + (1 if t else 0))
    for r in roots: walk(r, 0)
    return lines, len(seen), sum(1 for n in nodes if nodes[n])
if __name__ == '__main__':
    nodes, parent, children = load(sys.argv[1])
    lines, reached, texted = outline(nodes, parent, children)
    print(re.sub(r'[\x00-\x08\x0b-\x1f\x7f]', '', '\n'.join(lines)))
    print(f'\n<!-- nodes {len(nodes)} with text {texted} reached {reached} -->', file=sys.stderr)
