// 解析 ASCII DXF 的 ENTITIES 段，输出内部实体模型
// 支持 LINE / LWPOLYLINE / POLYLINE / CIRCLE / ARC / ELLIPSE / SPLINE

const SUPPORTED = new Set(['LINE', 'LWPOLYLINE', 'POLYLINE', 'CIRCLE', 'ARC', 'ELLIPSE', 'SPLINE']);

export function parseDxf(text) {
  if (text.startsWith('AutoCAD Binary DXF')) {
    throw new Error('暂不支持二进制 DXF，请在 CAD 中另存为 ASCII 格式 DXF');
  }
  const lines = text.split(/\r\n|\r|\n/);
  const pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    if (Number.isNaN(code)) continue;
    pairs.push({ code, value: lines[i + 1].trim() });
  }

  const entities = [];
  let skipped = 0;
  let inEntities = false;
  let cur = null;          // 当前普通实体
  let poly = null;         // 当前 POLYLINE
  let lastVertex = null;

  const flush = () => {
    if (cur) { entities.push(cur); cur = null; }
  };
  const flushPoly = () => {
    if (poly) { entities.push(poly); poly = null; lastVertex = null; }
  };

  for (let i = 0; i < pairs.length; i++) {
    const { code, value } = pairs[i];
    if (code === 0) {
      if (value === 'SECTION') {
        const name = pairs[i + 1] && pairs[i + 1].code === 2 ? pairs[i + 1].value : '';
        inEntities = name === 'ENTITIES';
        continue;
      }
      if (value === 'ENDSEC') { flush(); flushPoly(); inEntities = false; continue; }
      if (value === 'EOF') break;
      if (!inEntities) continue;

      flush();
      if (value === 'VERTEX' && poly) {
        lastVertex = { x: 0, y: 0, bulge: 0 };
        poly.raw.vertices.push(lastVertex);
        continue;
      }
      if (value === 'SEQEND') { flushPoly(); continue; }
      if (poly && value !== 'VERTEX') flushPoly();

      if (SUPPORTED.has(value)) {
        cur = makeEntity(value);
        if (value === 'POLYLINE') { poly = cur; cur = null; }
      } else {
        skipped++;
      }
      continue;
    }
    if (!inEntities) continue;
    const target = cur || lastVertex || poly;
    if (!target) continue;
    applyCode(target, code, value);
  }
  flush(); flushPoly();

  return { entities, skipped };
}

function makeEntity(type) {
  const base = { type, layer: '0', color: 256, modified: false };
  switch (type) {
    case 'LINE':
      return { ...base, raw: { x1: 0, y1: 0, x2: 0, y2: 0 } };
    case 'LWPOLYLINE':
      return { ...base, raw: { vertices: [], closed: false } };
    case 'POLYLINE':
      return { ...base, raw: { vertices: [], closed: false } };
    case 'CIRCLE':
      return { ...base, raw: { cx: 0, cy: 0, r: 0 } };
    case 'ARC':
      return { ...base, raw: { cx: 0, cy: 0, r: 0, start: 0, end: 360 } };
    case 'ELLIPSE':
      return { ...base, raw: { cx: 0, cy: 0, mx: 1, my: 0, ratio: 1, start: 0, end: Math.PI * 2 } };
    case 'SPLINE':
      return { ...base, raw: { degree: 3, knots: [], controlPoints: [], weights: [], fitPoints: [], closed: false } };
  }
}

function applyCode(target, code, value) {
  const n = parseFloat(value);
  const r = target.raw;
  if (code === 8) { target.layer = value; return; }
  if (code === 62) { target.color = n; return; }

  if (target.type === 'LINE') {
    if (code === 10) r.x1 = n; else if (code === 20) r.y1 = n;
    else if (code === 11) r.x2 = n; else if (code === 21) r.y2 = n;
    return;
  }
  if (target.type === 'CIRCLE' || target.type === 'ARC') {
    if (code === 10) r.cx = n; else if (code === 20) r.cy = n;
    else if (code === 40) r.r = n;
    else if (code === 50) r.start = n; else if (code === 51) r.end = n;
    return;
  }
  if (target.type === 'ELLIPSE') {
    if (code === 10) r.cx = n; else if (code === 20) r.cy = n;
    else if (code === 11) r.mx = n; else if (code === 21) r.my = n;
    else if (code === 40) r.ratio = n;
    else if (code === 41) r.start = n; else if (code === 42) r.end = n;
    return;
  }
  if (target.type === 'LWPOLYLINE') {
    if (code === 70) r.closed = (n & 1) === 1;
    else if (code === 10) r.vertices.push({ x: n, y: 0, bulge: 0 });
    else if (code === 20 && r.vertices.length) r.vertices[r.vertices.length - 1].y = n;
    else if (code === 42 && r.vertices.length) r.vertices[r.vertices.length - 1].bulge = n;
    return;
  }
  if (target.type === 'POLYLINE') {
    if (code === 70) r.closed = (n & 1) === 1;
    return;
  }
  if (target.type === 'VERTEX' || (target.x !== undefined && target.bulge !== undefined && !target.type)) {
    if (code === 10) target.x = n; else if (code === 20) target.y = n;
    else if (code === 42) target.bulge = n;
    return;
  }
  if (target.type === 'SPLINE') {
    if (code === 70) r.closed = (n & 1) === 1;
    else if (code === 71) r.degree = n;
    else if (code === 40) r.knots.push(n);
    else if (code === 41) r.weights.push(n);
    else if (code === 10) r.controlPoints.push({ x: n, y: 0 });
    else if (code === 20 && r.controlPoints.length) r.controlPoints[r.controlPoints.length - 1].y = n;
    else if (code === 11) r.fitPoints.push({ x: n, y: 0 });
    else if (code === 21 && r.fitPoints.length) r.fitPoints[r.fitPoints.length - 1].y = n;
  }
}