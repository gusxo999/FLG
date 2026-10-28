# 형태-전수.md §13 — 머신 한 대의 한 면에 줄 셋이 닿는 형태를 게임 규칙만으로 전부 센다.
# 범위: 팔 길이 1 · 세로줄 하나(거리 2, 가장 바깥이라 그 옆 칸이 늘 비어 있다) · 틈 없음 · 3x3 · 머신 5대 — 가운데 머신 2 가 그 머신.
# 팔 길이 1 이면 한 행에 인서터 하나라, 줄 셋이 닿으려면 머신 2 의 세 행이 세 줄에 하나씩 간다. 줄마다 품목 하나.
# 줄의 종류(머신 2 에서 본 것). ↓ 아래로 흐른다 · ↑ 위로 흐른다 · in 입력 · out 출력
#   D   한 대만 — 머신 2 의 그 행으로 가로로 들어와 끝난다
#   P   지나간다 — 머신 0~4 를 다 지난다
#   E   머신 2 에서 끝난다 — 머신 2 와 한쪽 이웃 둘을 지난다. 입력이면 멈추고, 출력이면 옆으로 나간다
#   B   머신 2 에서 시작한다 — 머신 2 와 한쪽 이웃 둘을 지난다. 출력이면 인서터가 처음 싣고, 입력이면 옆에서 들어온다
# 게임 규칙(형태-전수 §1 · §0.4):
#   칸 하나에 땅 위 물건 하나. 땅속 구간은 입구~출구 거리 ≤ 사거리(노랑 5 · 빨강 7 · 파랑 9).
#   같은 종류 · 같은 방향의 땅속 구간은 다른 줄끼리 겹치지 않는다(반대 방향이면 무관).
#   두 땅속 구간 사이의 땅 위 칸은 출구와 입구가 따로라 2칸 이상.
#   줄의 흐름 끝 칸 — 넷 가운데 하나
#     옆으로 꺾는다(벨트가 바깥을 향한다. 입력이면 그 앞 칸이 비어 멈추고, 출력이면 나간다) — 꺾인 칸은 가로를 향하므로 남이 흘려 넣으면 옆으로 실린다(안 된다)
#     짝 없는 입구(입력만) — 앞쪽 사거리 안에 같은 종류 · 같은 방향의 땅속 구간이 없어야 한다
#     벨트나 출구가 줄 방향 그대로 끝난다 — 앞 칸이 비었거나 반대 방향이거나 같은 방향의 출구(뒤가 덮개라 안 받는다)여야 한다.
#       같은 방향의 벨트 · 입구면 섞이고, 가로(D · 꺾인 칸)면 옆으로 실린다
#     출구는 꺾지 못하므로, 땅속에서 나온 출구 한 칸으로 끝나는 출력은 기둥 맨 끝 행에서만 된다
# 지하벨트의 덮개 쪽 반(입구의 앞 · 출구의 뒤)으로는 벨트 흐름이 못 들어간다(2026-10-21 사용자 — 형태-전수 §0.4 ㄴ).
#   그 전에는 출구의 뒤로 들어간다고 조심스럽게 봤다 — 고쳐 다시 센 455 경우의 결과는 같았다.
# 조심스럽게 둔 것: 짝 없는 입구 앞(사거리 안)의 같은 종류 · 방향 입구도 안 된다고 본다(형태-전수 §15 — 모른다).
# 쓰는 법:  python 한면-줄셋.py            줄 종류 셋의 모든 조합 — 되나 · 지하벨트 몇 종류
#           python 한면-줄셋.py 행         줄 종류마다 머신 2 의 어느 행에 설 수 있나
#           python 한면-줄셋.py P↓in D D   그 조합 하나의 칸 그림
import itertools, sys, collections
RANGES = {"노랑": 5, "빨강": 7, "파랑": 9}
N = 5; F = 2; ROWS = 3 * N; FR = [3 * F, 3 * F + 1, 3 * F + 2]
mach = lambda r: r // 3

def kinds():
    out = {"D": dict(k="D")}
    for d, s in ((+1, "↓"), (-1, "↑")):
        for io in ("in", "out"):
            out[f"P{s}{io}"] = dict(k="V", dir=d, io=io, served=set(range(N)), up=None, down=None)
        above, below = set(range(0, F + 1)), set(range(F, N))
        # E: 머신 2 에서 끝난다 — 흐름의 끝이 머신 2
        out[f"E{s}in"] = dict(k="V", dir=d, io="in", served=above if d > 0 else below, up=None, down="F")
        out[f"E{s}out"] = dict(k="V", dir=d, io="out", served=above if d > 0 else below, up=None, down="F")
        # B: 머신 2 에서 시작한다 — 흐름의 처음이 머신 2
        out[f"B{s}in"] = dict(k="V", dir=d, io="in", served=below if d > 0 else above, up="F", down=None)
        out[f"B{s}out"] = dict(k="V", dir=d, io="out", served=below if d > 0 else above, up="F", down=None)
    return out
K = kinds()

def runs_of(rows):
    rows = sorted(rows); out = []
    for r in rows:
        if out and out[-1][1] == r - 1: out[-1][1] = r
        else: out.append([r, r])
    return [tuple(x) for x in out]

def structure(lines, owner):
    """줄마다 토막 · 땅속 구간 · 끝 칸의 가능한 꼴. 안 되면 None"""
    info = []
    for i, L in enumerate(lines):
        if L["k"] == "D": info.append(None); continue
        own = [r for r in range(ROWS) if owner[r] == i]
        if not own: return None
        for m in L["served"]:
            if not any(mach(r) == m for r in own): return None
        rs = runs_of(own); d = L["dir"]
        flow = rs if d > 0 else rs[::-1]
        up_cell = flow[0][0] if d > 0 else flow[0][1]
        down_cell = flow[-1][1] if d > 0 else flow[-1][0]
        if L["up"] == "F" and up_cell != L["_frow"]: return None
        if L["down"] == "F" and down_cell != L["_frow"]: return None
        spans = []
        for j, (a, b) in enumerate(flow):
            first, last = j == 0, j == len(flow) - 1
            if not first and not last and b - a + 1 < 2: return None
        for j in range(len(flow) - 1):
            a = flow[j][1] if d > 0 else flow[j][0]
            b = flow[j + 1][0] if d > 0 else flow[j + 1][1]
            if abs(b - a) > max(RANGES.values()): return None
            spans.append((i, min(a, b), max(a, b), d))
        endlen = flow[-1][1] - flow[-1][0] + 1
        endexit = len(flow) > 1 and endlen == 1          # 끝 칸이 출구
        edge = (down_cell == ROWS - 1) if d > 0 else (down_cell == 0)
        if L["io"] == "out":
            modes = ["plain"] if edge else (["side"] if not endexit else [])
        else:
            modes = ["plain"] if endexit else ["side", "stop", "plain"]
        if not modes: return None
        exits = {(a if d > 0 else b) for (a, b) in flow[1:]}  # 땅속에서 나온 출구 칸
        info.append(dict(spans=spans, down=down_cell, up=up_cell, modes=modes, dir=d, exits=exits))
    return info

def facing(lines, info, mode, i, r):
    """줄 i 의 칸 r 이 향하는 쪽: +1 · -1(세로) 또는 0(가로)"""
    L = lines[i]
    if L["k"] == "D": return 0
    if r == info[i]["down"] and mode[i] == "side": return 0
    return info[i]["dir"]

def check(lines, owner):
    info = structure(lines, owner)
    if info is None: return None
    vs = [i for i, L in enumerate(lines) if L["k"] == "V"]
    out = []
    for combo in itertools.product(*[info[i]["modes"] for i in vs]):
        mode = dict(zip(vs, combo)); ok = True
        for i in vs:
            if mode[i] != "plain": continue
            d = info[i]["dir"]; nxt = info[i]["down"] + d
            if not (0 <= nxt < ROWS): continue
            o = owner.get(nxt)
            if o is None: continue
            f = facing(lines, info, mode, o, nxt)
            if f == d and lines[o]["k"] == "V" and nxt in info[o]["exits"]: continue  # 출구의 뒤는 덮개라 안 받는다
            if f != -d: ok = False; break
        if ok:
            spans = [sp for i in vs for sp in info[i]["spans"]]
            stops = [(i, info[i]["down"], info[i]["dir"]) for i in vs if mode[i] == "stop"]
            out.append((spans, stops, mode))
    return out or None

def typable(cands, types):
    for spans, stops, mode in cands:
        items = [("span",) + sp for sp in spans] + [("stop",) + st for st in stops]
        order = sorted(range(len(items)), key=lambda k: items[k][2])
        chosen = {}
        def extent(k, t):
            it = items[k]
            if it[0] == "span": return it[2], it[3]
            _, i, r, d = it
            return (r, r + RANGES[t]) if d > 0 else (r - RANGES[t], r)
        def rec(idx):
            if idx == len(order): return True
            k = order[idx]; it = items[k]; i, d = it[1], it[-1]
            for t in types:
                if it[0] == "span" and RANGES[t] < it[3] - it[2]: continue
                lo, hi = extent(k, t); bad = False
                for k2, t2 in chosen.items():
                    it2 = items[k2]
                    if t2 != t or it2[1] == i or it2[-1] != d: continue
                    lo2, hi2 = extent(k2, t2)
                    if not (hi2 < lo or hi < lo2): bad = True; break
                if bad: continue
                chosen[k] = t
                if rec(idx + 1): return True
                del chosen[k]
            return False
        if rec(0):
            return {"spans": spans, "stops": stops, "mode": mode, "types": {k: chosen[k] for k in chosen}, "items": items}
    return None

def solve(names, types):
    found = []
    for perm in set(itertools.permutations(range(3))):
        lines = [dict(K[n]) for n in names]
        for i, L in enumerate(lines): L["_frow"] = FR[perm[i]]
        owner = {}
        for i in range(3): owner[FR[perm[i]]] = i
        other = [r for r in range(ROWS) if r not in owner]
        cands0 = []
        for r in other:
            c = [None] + [i for i, L in enumerate(lines) if L["k"] == "V" and mach(r) in L["served"]]
            cands0.append(c)
        def dfs(k):
            if k == len(other):
                cands = check(lines, owner)
                if cands is None: return False
                t = typable(cands, types)
                if t is None: return False
                found.append((perm, dict(owner), t)); return True
            r = other[k]
            for c in cands0[k]:
                owner[r] = c
                # 가지치기: 줄마다 땅 위 칸 사이가 사거리를 넘으면 안 된다
                ok = True
                if c is not None:
                    prev = [rr for rr in range(r) if owner.get(rr) == c]
                    if prev and r - prev[-1] - 1 > max(RANGES.values()) - 1: ok = False
                # 가지치기: 머신의 마지막 행을 정했으면 그 머신을 지나는 줄마다 칸이 하나 이상
                if ok and r % 3 == 2:
                    m = mach(r)
                    for i, L in enumerate(lines):
                        if L["k"] == "V" and m in L["served"] and not any(owner.get(rr) == i for rr in (3*m, 3*m+1, 3*m+2)): ok = False; break
                # 가지치기: 사이 토막이 한 칸이면 안 된다(줄의 처음 · 끝 토막은 끝에서 따진다)
                if ok:
                    for i, L in enumerate(lines):
                        if L["k"] != "V": continue
                        own = [rr for rr in range(r + 1) if owner.get(rr) == i]
                        rs = runs_of(own)
                        # 닫힌 토막 가운데 처음도 아니고 지금 열린 것도 아닌 것
                        closed = rs[1:-1] if rs and rs[-1][1] == r else rs[1:]
                        if any(b - a + 1 < 2 for a, b in closed if rs and not (rs[-1][1] < r and (a, b) == rs[-1])): ok = False; break
                if ok and dfs(k + 1): return True
            del owner[r]
            return False
        dfs(0)
        if found: return found
    return found

def solve_fixed(names, perm, types):
    lines = [dict(K[n]) for n in names]
    for i, L in enumerate(lines): L["_frow"] = FR[perm[i]]
    owner = {FR[perm[i]]: i for i in range(3)}
    other = [r for r in range(ROWS) if r not in owner]
    cands = [[None] + [i for i, L in enumerate(lines) if L["k"] == "V" and mach(r) in L["served"]] for r in other]
    found = []
    def dfs(k):
        if k == len(other):
            cc = check(lines, owner)
            if cc is None: return False
            t = typable(cc, types)
            if t is None: return False
            found.append((perm, dict(owner), t)); return True
        r = other[k]
        for c in cands[k]:
            owner[r] = c; ok = True
            if c is not None:
                prev = [rr for rr in range(r) if owner.get(rr) == c]
                if prev and r - prev[-1] - 1 > max(RANGES.values()) - 1: ok = False
            if ok and r % 3 == 2:
                m = mach(r)
                for i, L in enumerate(lines):
                    if L["k"] == "V" and m in L["served"] and not any(owner.get(rr) == i for rr in (3*m, 3*m+1, 3*m+2)): ok = False; break
            if ok and dfs(k + 1): return True
        del owner[r]; return False
    dfs(0)
    return found
def cells(names, sol):
    perm, owner, T = sol
    mode = T["mode"]; items = T["items"]; types = T["types"]
    lines = [dict(K[n]) for n in names]
    out = {}
    for i, L in enumerate(lines):
        if L["k"] == "D":
            r = [r for r, o in owner.items() if o == i][0]; out[r] = f"{'XYZ'[i]} 한 대(가로로 들어와 끝)"; continue
        own = sorted(r for r, o in owner.items() if o == i)
        rs = runs_of(own); d = L["dir"]; flow = rs if d > 0 else rs[::-1]
        arrow = "↓" if d > 0 else "↑"
        for j, (a, b) in enumerate(flow):
            seq = list(range(a, b + 1)) if d > 0 else list(range(b, a - 1, -1))
            for k, r in enumerate(seq):
                first, last = k == 0, k == len(seq) - 1
                if first and j > 0: kind = "출구"
                elif last and j < len(flow) - 1: kind = "입구"
                elif first and j == 0: kind = "시작(옆에서)" if L["io"] == "in" else "시작(인서터가 싣는다)"
                elif last and j == len(flow) - 1:
                    md = mode[i]
                    if md == "side": kind = "끝 — 옆으로 꺾어 " + ("멈춤" if L["io"] == "in" else "나간다")
                    elif md == "stop": kind = "끝 — 짝 없는 입구(" + [types[k] for k, it in enumerate(items) if it[0] == "stop" and it[1] == i][0] + ")"
                    else: kind = "끝 — 벨트" + (", 앞 칸이 반대 방향" if L["io"] == "in" else ", 기둥 밖으로")
                else: kind = "벨트"
                if first and last and j > 0 and j == len(flow) - 1: kind = "출구 — 여기서 멈춘다(앞 칸이 비었거나 반대 방향)" if L["io"] == "in" else "출구 — 기둥 밖으로"
                if first and last and j == 0 and j < len(flow) - 1: kind = "입구(" + ("옆에서 실린다" if L["io"] == "in" else "인서터가 싣는다") + ")"
                out[r] = f"{'XYZ'[i]}{arrow} {kind}"
    under = {}
    for k, it in enumerate(items):
        if it[0] != "span": continue
        _, i, lo, hi, d = it
        for r in range(lo + 1, hi):
            under.setdefault(r, []).append(f"{'XYZ'[i]}{'↓' if d > 0 else '↑'}({types[k]})")
    for r in range(ROWS):
        print(f"  행 {r:2d} 머신 {mach(r)}{'*' if mach(r) == F else ' '} │ {out.get(r, '.'):34s} │ 땅속 {' '.join(under.get(r, []))}")

def rows_mode():
    ALL = ("노랑", "빨강", "파랑")
    POS = ["위", "가운데", "아래"]
    kinds_v = [k for k in K if k != "D"]
    # 줄 하나 + D 둘
    print("== 트렁크 하나 + 한 대 줄 둘: 트렁크가 설 수 있는 행")
    for k in kinds_v:
        ok = [POS[p] for p in range(3) if solve_fixed((k, "D", "D"), (p, (p+1)%3, (p+2)%3), ALL)]
        print(f"  {k:6s} {' · '.join(ok)}")
    print("== 트렁크 둘 + 한 대 줄 하나: 한 대 줄이 설 수 있는 행 · 두 트렁크의 행")
    seen = collections.defaultdict(set)
    for a, b in itertools.combinations_with_replacement(kinds_v, 2):
        for perm in itertools.permutations(range(3)):
            if solve_fixed((a, b, "D"), perm, ALL):
                seen[(a, b)].add((POS[perm[0]], POS[perm[1]], POS[perm[2]]))
    cnt = collections.Counter()
    for (a, b), s in seen.items():
        for pa, pb, pd in s: cnt[pd] += 1
    print("  한 대 줄의 행:", dict(cnt))
    for key in [("P↓in", "P↑in"), ("P↓in", "P↓in"), ("P↓in", "E↓in"), ("P↓in", "B↓in"), ("E↓in", "E↑in"), ("P↓in", "E↑in")]:
        print("  ", key, sorted(seen.get(key, [])))

if __name__ == "__main__":
    a = sys.argv[1:]
    if a == ["행"]:
        rows_mode()
    elif len(a) == 3:
        for types in (("노랑",), ("노랑", "빨강"), ("노랑", "빨강", "파랑")):
            s = solve(tuple(a), types)
            if s: print(tuple(a), "→", " · ".join(types)); cells(tuple(a), s[0]); break
        else: print(tuple(a), "안 된다")
    else:
        for c in itertools.combinations_with_replacement(list(K), 3):
            res = None
            for types in (("노랑",), ("노랑", "빨강"), ("노랑", "빨강", "파랑")):
                if solve(c, types): res = types; break
            print(" + ".join(c), "→", " · ".join(res) if res else "안 된다")
