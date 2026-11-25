// 几何引擎：实体离散化、端点连链、封闭性/包含/相交检测与修复

const TAU = Math.PI * 2;

export function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

/* ---------------- 离散化 ---------------- */

function arcPoints(cx, cy, r, startDeg, endDeg) {
  let sweep = ((endDeg - startDeg) % 360 + 360) % 360;
  if (sweep < 1e-9) sweep = 360;
  const n = Math.max(8, Math.ceil(sweep / 4));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = (startDeg + sweep * i / n) * Math.PI / 180;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return pts;
}

function bulgePoints(p1, p2, bulge) {
  if (!bulge || Math.abs(bulge) < 1e-12) return [p1, p2];
  const theta = 4 * Math.atan(bulge);
  const d = dist(p1, p2);
  if (d < 1e-12) return [p1, p2];
  const r = d / 2 / Math.sin(theta / 2);
  const ang = Math.atan2(p2.y - p1.y, p2.x - p1.x);
  const ca = ang + Math.PI / 2 - theta / 2;
  const cx = p1.x + r * Math.cos(ca);
  const cy = p1.y + r * Math.sin(ca);
  const start = Math.atan2(p1.y - cy, p1.x - cx);
  const n = Math.max(4, Math.ceil(Math.abs(theta) / (Math.PI / 24)));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = start + theta * i / n;
    pts.push({ x: cx + Math.abs(r) * Math.cos(a), y: cy + Math.abs(r) * Math.sin(a) });
  }
  pts[0] = { ...p1 };
  pts[n] = { ...p2 };
  return pts;
}

function polylinePoints(vertices, closed) {
  if (!vertices.length) return [];
  const pts = [{ x: vertices[0].x, y: vertices[0].y }];
  const count = closed ? vertices.length : vertices.length - 1;
  for (let i = 0; i < count; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    const seg = bulgePoints({ x: a.x, y: a.y }, { x: b.x, y: b.y }, a.bulge || 0);
    for (let j = 1; j < seg.length; j++) pts.push(seg[j]);
  }
  return pts;
}

function ellipsePoints(r) {
  const sweep = r.end - r.start;
  const full = Math.abs(Math.abs(sweep) - TAU) < 1e-6;
  const n = Math.max(16, Math.ceil(Math.abs(sweep) / TAU * 96));
  const mx = r.mx, my = r.my;
  const nx = -my * r.ratio, ny = mx * r.ratio;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = r.start + sweep * i / n;
    pts.push({ x: r.cx + mx * Math.cos(t) + nx * Math.sin(t), y: r.cy + my * Math.cos(t) + ny * Math.sin(t) });
  }
  return { pts, full };
}

function splinePoints(r) {
  const cp = r.controlPoints;
  if (!cp || cp.length < 2) {
    return { pts: (r.fitPoints || []).map(p => ({ x: p.x, y: p.y })), closed: r.closed };
  }
  const deg = Math.min(r.degree || 3, cp.length - 1);
  let knots = r.knots && r.knots.length === cp.length + deg + 1 ? r.knots.slice() : null;
  if (!knots) {
    knots = [];
    for (let i = 0; i < cp.length + deg + 1; i++) {
      knots.push(Math.min(Math.max(i - deg, 0), cp.length - deg));
    }
  }
  const weights = r.weights && r.weights.length === cp.length ? r.weights : cp.map(() => 1);
  const u0 = knots[deg], u1 = knots[cp.length];
  const n = Math.max(32, cp.length * 8);
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const u = u0 + (u1 - u0) * i / n;
    pts.push(deBoor(deg, knots, cp, weights, Math.min(u, u1 - 1e-10)));
  }
  const closed = r.closed || dist(pts[0], pts[pts.length - 1]) < 1e-6;
  return { pts, closed };
}

function deBoor(p, knots, cp, w, u) {
  let k = p;
  for (let i = p; i < cp.length; i++) {
    if (u >= knots[i] && u < knots[i + 1]) { k = i; break; }
    k = i;
  }
  const d = [];
  for (let j = 0; j <= p; j++) {
    const idx = k - p + j;
    d.push({ x: cp[idx].x * w[idx], y: cp[idx].y * w[idx], w: w[idx] });
  }
  for (let r = 1; r <= p; r++) {
    for (let j = p; j >= r; j--) {
      const i = k - p + j;
      const denom = knots[i + p - r + 1] - knots[i];
      const a = denom === 0 ? 0 : (u - knots[i]) / denom;
      d[j] = {
        x: (1 - a) * d[j - 1].x + a * d[j].x,
        y: (1 - a) * d[j - 1].y + a * d[j].y,
        w: (1 - a) * d[j - 1].w + a * d[j].w
      };
    }
  }
  return { x: d[p].x / d[p].w, y: d[p].y / d[p].w };
}

// 为实体生成折线点列与源闭合标记
export function tessellate(e) {
  const r = e.raw;
  switch (e.type) {
    case 'LINE':
      e.pts = [{ x: r.x1, y: r.y1 }, { x: r.x2, y: r.y2 }];
      e.closedSrc = false;
      break;
    case 'LWPOLYLINE':
    case 'POLYLINE':
      e.pts = polylinePoints(r.vertices, r.closed);
      e.closedSrc = r.closed;
      break;
    case 'CIRCLE':
      e.pts = arcPoints(r.cx, r.cy, r.r, 0, 360);
      e.closedSrc = true;
      break;
    case 'ARC': {
      e.pts = arcPoints(r.cx, r.cy, r.r, r.start, r.end);
      const sweep = ((r.end - r.start) % 360 + 360) % 360;
      e.closedSrc = sweep > 359.999;
      break;
    }
    case 'ELLIPSE': {
      const { pts, full } = ellipsePoints(r);
      e.pts = pts;
      e.closedSrc = full;
      break;
    }
    case 'SPLINE': {
      const { pts, closed } = splinePoints(r);
      e.pts = pts;
      e.closedSrc = closed;
      break;
    }
    case 'CHAIN': // 修复/合并生成的折线
      e.pts = r.vertices.map(p => ({ x: p.x, y: p.y }));
      e.closedSrc = r.closed;
      break;
    default:
      e.pts = [];
      e.closedSrc = false;
  }
  if (e.closedSrc && e.pts.length > 2) {
    // 闭合折线确保首尾点重合
    if (dist(e.pts[0], e.pts[e.pts.length - 1]) > 1e-9) e.pts.push({ ...e.pts[0] });
  }
  e.bbox = bboxOf(e.pts);
  return e;
}

export function bboxOf(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  return { x0, y0, x1, y1 };
}

/* ---------------- 连链成图 ---------------- */

// 将开放实体按端点邻接合并为“图形”
export function buildShapes(entities, tol) {
  const shapes = [];
  const open = [];
  for (const e of entities) {
    if (!e.pts || e.pts.length < 2) continue;
    if (e.closedSrc) {
      shapes.push({ entityIds: [e.id], pts: e.pts, closed: true });
    } else {
      open.push({ entityIds: [e.id], pts: e.pts.slice() });
    }
  }

  // 端点空间哈希
  const cell = Math.max(tol, 1e-9);
  const key = (x, y) => Math.round(x / cell) + ':' + Math.round(y / cell);
  const ends = new Map(); // key -> [{path, which}]
  const addEnd = (path, which) => {
    const p = which === 0 ? path.pts[0] : path.pts[path.pts.length - 1];
    const k = key(p.x, p.y);
    if (!ends.has(k)) ends.set(k, []);
    ends.get(k).push({ path, which });
  };
  const removeEnds = (path) => {
    for (const which of [0, 1]) {
      const p = which === 0 ? path.pts[0] : path.pts[path.pts.length - 1];
      const k = key(p.x, p.y);
      const arr = ends.get(k);
      if (arr) {
        const i = arr.findIndex(r => r.path === path);
        if (i >= 0) arr.splice(i, 1);
      }
    }
  };
  const findNear = (p, exclude) => {
    const cx = Math.round(p.x / cell), cy = Math.round(p.y / cell);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const arr = ends.get((cx + dx) + ':' + (cy + dy));
      if (!arr) continue;
      for (const rec of arr) {
        if (rec.path === exclude || consumed.has(rec.path)) continue;
        const q = rec.which === 0 ? rec.path.pts[0] : rec.path.pts[rec.path.pts.length - 1];
        if (dist(p, q) <= tol) return rec;
      }
    }
    return null;
  };

  for (const path of open) addEnd(path, 0), addEnd(path, 1);

  const merged = [];
  const consumed = new Set();
  for (const path of open) {
    if (consumed.has(path)) continue;
    let cur = path;
    // 向两端延伸
    for (const side of [1, 0]) {
      let guard = open.length + 1;
      while (guard-- > 0) {
        const endP = side === 1 ? cur.pts[cur.pts.length - 1] : cur.pts[0];
        // 自身首尾已闭合则停止
        if (cur.pts.length > 2 && dist(cur.pts[0], cur.pts[cur.pts.length - 1]) <= tol) break;
        const rec = findNear(endP, cur);
        if (!rec) break;
        const other = rec.path;
        consumed.add(other);
        removeEnds(other);
        removeEnds(cur);
        let otherPts = other.pts.slice();
        // 使 other 的连接端与 cur 的端点对齐
        const connectIdx = rec.which === 0 ? 0 : otherPts.length - 1;
        if (side === 1) {
          if (connectIdx !== 0) otherPts.reverse();
          cur.pts = cur.pts.concat(otherPts.slice(1));
          cur.entityIds = cur.entityIds.concat(other.entityIds);
        } else {
          if (connectIdx !== otherPts.length - 1) otherPts.reverse();
          cur.pts = otherPts.slice(0, -1).concat(cur.pts);
          cur.entityIds = other.entityIds.concat(cur.entityIds);
        }
        addEnd(cur, 0); addEnd(cur, 1);
      }
    }
    consumed.add(cur);
    merged.push(cur);
  }

  for (const path of merged) {
    const closed = path.pts.length > 2 && dist(path.pts[0], path.pts[path.pts.length - 1]) <= tol;
    if (closed) {
      path.pts[path.pts.length - 1] = { ...path.pts[0] };
      path.closed = true;
    } else {
      path.closed = false;
      path.gap = dist(path.pts[0], path.pts[path.pts.length - 1]);
    }
    shapes.push(path);
  }

  shapes.forEach((s, i) => {
    s.id = i;
    s.bbox = bboxOf(s.pts);
  });
  return shapes;
}

/* ---------------- 相交检测 ---------------- */

function orient(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

// 返回交点（真交叉）；端点相接返回 null
export function segIntersect(p1, p2, p3, p4, eps) {
  const d1 = orient(p3, p4, p1);
  const d2 = orient(p3, p4, p2);
  const d3 = orient(p1, p2, p3);
  const d4 = orient(p1, p2, p4);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    const t = d1 / (d1 - d2);
    const pt = { x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) };
    // 排除交点落在任一线段端点上的“相接”情形
    if (dist(pt, p1) <= eps || dist(pt, p2) <= eps ||
        dist(pt, p3) <= eps || dist(pt, p4) <= eps) return null;
    return pt;
  }
  return null;
}

function bboxOverlap(a, b, pad) {
  return a.x0 - pad <= b.x1 && b.x0 - pad <= a.x1 &&
         a.y0 - pad <= b.y1 && b.y0 - pad <= a.y1;
}

// 两图形间所有真交点（网格加速）
export function shapeIntersections(A, B, eps) {
  const cellSize = Math.max(
    (A.bbox.x1 - A.bbox.x0 + A.bbox.y1 - A.bbox.y0) / 40,
    (B.bbox.x1 - B.bbox.x0 + B.bbox.y1 - B.bbox.y0) / 40,
    eps * 10
  );
  const grid = new Map();
  const cellsOf = (p, q) => {
    const out = [];
    const x0 = Math.floor(Math.min(p.x, q.x) / cellSize), x1 = Math.floor(Math.max(p.x, q.x) / cellSize);
    const y0 = Math.floor(Math.min(p.y, q.y) / cellSize), y1 = Math.floor(Math.max(p.y, q.y) / cellSize);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push(x + ':' + y);
    return out;
  };
  for (let i = 0; i < B.pts.length - 1; i++) {
    for (const k of cellsOf(B.pts[i], B.pts[i + 1])) {
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(i);
    }
  }
  const points = [];
  const seen = new Set();
  for (let i = 0; i < A.pts.length - 1; i++) {
    const cand = new Set();
    for (const k of cellsOf(A.pts[i], A.pts[i + 1])) {
      const arr = grid.get(k);
      if (arr) for (const j of arr) cand.add(j);
    }
    for (const j of cand) {
      const pt = segIntersect(A.pts[i], A.pts[i + 1], B.pts[j], B.pts[j + 1], eps);
      if (pt) {
        const k = Math.round(pt.x / eps) + ':' + Math.round(pt.y / eps);
        if (!seen.has(k)) { seen.add(k); points.push(pt); }
      }
    }
  }
  return points;
}

/* ---------------- 包含检测 ---------------- */

export function pointInPolygon(p, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > p.y) !== (b.y > p.y) &&
        p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function bboxContains(outer, inner, eps) {
  return outer.x0 - eps <= inner.x0 && outer.y0 - eps <= inner.y0 &&
         outer.x1 + eps >= inner.x1 && outer.y1 + eps >= inner.y1;
}

/* ---------------- 总检测 ---------------- */

export function detect(entities, tol) {
  const shapes = buildShapes(entities, tol);
  let diag = 0;
  if (shapes.length) {
    const all = bboxOf(shapes.flatMap(s => s.pts));
    diag = Math.hypot(all.x1 - all.x0, all.y1 - all.y0) || 1;
  }
  const eps = Math.max(diag * 1e-7, 1e-9);
  const closed = shapes.filter(s => s.closed);
  const issues = [];

  // 1. 未闭合
  for (const s of shapes) {
    if (!s.closed) {
      issues.push({
        kind: 'open',
        shapeIds: [s.id],
        gap: s.gap,
        focus: [s.pts[0], s.pts[s.pts.length - 1]],
        bbox: s.bbox
      });
    }
  }

  // 图形两两关系（网格粗筛）
  const crossPairs = [];
  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      const A = shapes[i], B = shapes[j];
      if (!bboxOverlap(A.bbox, B.bbox, eps)) continue;
      const pts = shapeIntersections(A, B, eps);
      if (pts.length) {
        crossPairs.push([i, j]);
        issues.push({
          kind: 'cross',
          shapeIds: [i, j],
          points: pts,
          focus: pts,
          bbox: bboxOf([...A.pts, ...B.pts])
        });
      }
    }
  }

  // 2. 包含（仅闭合且互不相交的图形，取直接父级）
  const crossedSet = new Set(crossPairs.map(([i, j]) => i + ':' + j));
  const containPairs = [];
  for (const inner of closed) {
    let parent = null;
    for (const outer of closed) {
      if (outer === inner) continue;
      if (!bboxContains(outer.bbox, inner.bbox, eps)) continue;
      const pk = Math.min(inner.id, outer.id) + ':' + Math.max(inner.id, outer.id);
      if (crossedSet.has(pk)) continue;
      // 抽样点全部位于 outer 内
      const step = Math.max(1, Math.floor(inner.pts.length / 8));
      let allIn = true;
      for (let k = 0; k < inner.pts.length; k += step) {
        if (!pointInPolygon(inner.pts[k], outer.pts)) { allIn = false; break; }
      }
      if (!allIn) continue;
      if (!parent || areaOf(outer.bbox) < areaOf(parent.bbox)) parent = outer;
    }
    if (parent) containPairs.push([parent.id, inner.id]);
  }
  for (const [o, i] of containPairs) {
    issues.push({
      kind: 'contain',
      shapeIds: [o, i],
      outerId: o,
      innerId: i,
      focus: shapes[i].pts.slice(0, 1),
      bbox: shapes[o].bbox
    });
  }

  issues.forEach((it, i) => { it.id = i; });
  return { shapes, issues, eps, diag };
}

function areaOf(b) { return (b.x1 - b.x0) * (b.y1 - b.y0); }

/* ---------------- 修复 ---------------- */

let synthId = 1;
export function makeChainEntity(pts, closed, layer) {
  const e = {
    id: 'fix-' + (synthId++),
    type: 'CHAIN',
    layer: layer || '0',
    color: 256,
    modified: true,
    raw: { vertices: pts.map(p => ({ x: p.x, y: p.y, bulge: 0 })), closed }
  };
  return tessellate(e);
}

// 未闭合 → 连接首尾
export function fixOpen(entities, shapes, issue) {
  const s = shapes[issue.shapeIds[0]];
  const pts = s.pts.slice();
  pts.push({ ...pts[0] });
  const layer = entities.find(e => e.id === s.entityIds[0])?.layer;
  const next = entities.filter(e => !s.entityIds.includes(e.id));
  next.push(makeChainEntity(pts, true, layer));
  return next;
}

// 相交修复：闭合-闭合 → 裁剪合并（并集轮廓）；开放-闭合 → 删除开放图形位于闭合图形内的部分
export function fixCross(entities, shapes, issue, eps) {
  const A = shapes[issue.shapeIds[0]];
  const B = shapes[issue.shapeIds[1]];
  const pts = issue.points;
  if (A.closed && B.closed) {
    const partsA = splitRingAt(A.pts, pts, eps).filter(p => !insideOther(p, B.pts));
    const partsB = splitRingAt(B.pts, pts, eps).filter(p => !insideOther(p, A.pts));
    const ring = joinParts([...partsA, ...partsB], eps);
    if (!ring) return null;
    const layer = entities.find(e => e.id === A.entityIds[0])?.layer;
    const next = entities.filter(e => !A.entityIds.includes(e.id) && !B.entityIds.includes(e.id));
    next.push(makeChainEntity(ring, true, layer));
    return next;
  }
  const openS = A.closed ? B : A;
  const closedS = A.closed ? A : B;
  const parts = splitPathAt(openS.pts, pts, eps).filter(p => !insideOther(p, closedS.pts));
  if (!parts.length) return null;
  const layer = entities.find(e => e.id === openS.entityIds[0])?.layer;
  const next = entities.filter(e => !openS.entityIds.includes(e.id));
  for (const p of parts) {
    if (p.length >= 2) next.push(makeChainEntity(p, false, layer));
  }
  return next;
}

// 沿路径按弧长取 t 处的点
function pointAt(pts, t) {
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) total += dist(pts[i], pts[i + 1]);
  let target = total * t;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = dist(pts[i], pts[i + 1]);
    if (target <= d && d > 0) {
      const k = target / d;
      return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * k, y: pts[i].y + (pts[i + 1].y - pts[i].y) * k };
    }
    target -= d;
  }
  return pts[pts.length - 1];
}

// 多数表决判断子路径是否位于另一图形内部，避免采样点恰落边界
function insideOther(part, otherPts) {
  let votes = 0;
  for (const t of [0.25, 0.5, 0.75]) {
    if (pointInPolygon(pointAt(part, t), otherPts)) votes++;
  }
  return votes >= 2;
}

// 在交点处切开闭合环，返回若干子路径
function splitRingAt(pts, cuts, eps) {
  const path = pts.slice();
  if (dist(path[0], path[path.length - 1]) > eps) path.push({ ...path[0] });
  return splitPathAt(path, cuts, eps);
}

function splitPathAt(pts, cuts, eps) {
  // 将交点插入到对应线段上，然后按交点切分
  const items = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const on = [];
    for (const c of cuts) {
      const d = dist(a, b);
      if (d < 1e-12) continue;
      const t = ((c.x - a.x) * (b.x - a.x) + (c.y - a.y) * (b.y - a.y)) / (d * d);
      if (t <= 1e-9 || t >= 1 - 1e-9) continue;
      const proj = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
      if (dist(proj, c) <= eps * 20) on.push({ t, pt: c });
    }
    on.sort((u, v) => u.t - v.t);
    items.push(a, ...on.map(o => o.pt));
  }
  items.push(pts[pts.length - 1]);
  const cutKeys = new Set(cuts.map(c => Math.round(c.x / eps) + ':' + Math.round(c.y / eps)));
  const isCut = p => cutKeys.has(Math.round(p.x / eps) + ':' + Math.round(p.y / eps));
  const parts = [];
  let cur = [items[0]];
  for (let i = 1; i < items.length; i++) {
    cur.push(items[i]);
    if (isCut(items[i]) && i < items.length - 1) {
      if (cur.length >= 2) parts.push(cur);
      cur = [items[i]];
    }
  }
  if (cur.length >= 2) parts.push(cur);
  return parts;
}

// 将裁剪后的子路径按端点拼接成闭合环
function joinParts(parts, eps) {
  if (!parts.length) return null;
  const remaining = parts.slice();
  let ring = remaining.shift().slice();
  let guard = parts.length + 1;
  while (remaining.length && guard-- > 0) {
    const end = ring[ring.length - 1];
    if (dist(end, ring[0]) <= eps * 20 && ring.length > 2) break;
    const idx = remaining.findIndex(p => dist(p[0], end) <= eps * 20 || dist(p[p.length - 1], end) <= eps * 20);
    if (idx < 0) return null;
    let seg = remaining.splice(idx, 1)[0];
    if (dist(seg[seg.length - 1], end) <= eps * 20) seg = seg.slice().reverse();
    ring = ring.concat(seg.slice(1));
  }
  if (remaining.length) return null;
  if (dist(ring[0], ring[ring.length - 1]) > eps * 20) return null;
  ring[ring.length - 1] = { ...ring[0] };
  return ring;
}

export function deleteShapes(entities, shapes, shapeIds) {
  const ids = new Set();
  for (const sid of shapeIds) {
    for (const eid of shapes[sid].entityIds) ids.add(eid);
  }
  return entities.filter(e => !ids.has(e.id));
}