// 导出 ASCII DXF (R12)：未修改实体按原类型写出，修复生成的图形以 POLYLINE 写出

export function exportDxf(entities) {
  const out = [];
  const push = (code, value) => { out.push(String(code), String(value)); };

  push(0, 'SECTION'); push(2, 'HEADER');
  push(9, '$ACADVER'); push(1, 'AC1009');
  push(9, '$INSUNITS'); push(70, 4);
  push(0, 'ENDSEC');

  const layers = [...new Set(entities.map(e => e.layer || '0'))];
  push(0, 'SECTION'); push(2, 'TABLES');
  push(0, 'TABLE'); push(2, 'LTYPE'); push(70, 1);
  push(0, 'LTYPE'); push(2, 'CONTINUOUS'); push(70, 0); push(3, 'Solid line'); push(72, 65); push(73, 0); push(40, 0);
  push(0, 'ENDTAB');
  push(0, 'TABLE'); push(2, 'LAYER'); push(70, layers.length);
  for (const name of layers) {
    push(0, 'LAYER'); push(2, name); push(70, 0); push(62, 7); push(6, 'CONTINUOUS');
  }
  push(0, 'ENDTAB');
  push(0, 'ENDSEC');

  push(0, 'SECTION'); push(2, 'ENTITIES');
  for (const e of entities) writeEntity(e, push);
  push(0, 'ENDSEC');
  push(0, 'EOF');
  return out.join('\r\n') + '\r\n';
}

function common(e, push) {
  push(8, e.layer || '0');
  if (e.color !== undefined && e.color !== 256 && e.color >= 0) push(62, e.color);
}

function writePolyline(pts, closed, push) {
  push(0, 'POLYLINE');
  push(66, 1);
  push(70, closed ? 1 : 0);
  push(10, 0); push(20, 0); push(30, 0);
  const n = closed && pts.length > 1 ? pts.length - 1 : pts.length;
  for (let i = 0; i < n; i++) {
    push(0, 'VERTEX');
    push(10, fmt(pts[i].x)); push(20, fmt(pts[i].y)); push(30, 0);
  }
  push(0, 'SEQEND');
}

function writeEntity(e, push) {
  const r = e.raw;
  switch (e.type) {
    case 'LINE':
      push(0, 'LINE'); common(e, push);
      push(10, fmt(r.x1)); push(20, fmt(r.y1)); push(30, 0);
      push(11, fmt(r.x2)); push(21, fmt(r.y2)); push(31, 0);
      break;
    case 'CIRCLE':
      push(0, 'CIRCLE'); common(e, push);
      push(10, fmt(r.cx)); push(20, fmt(r.cy)); push(30, 0);
      push(40, fmt(r.r));
      break;
    case 'ARC':
      push(0, 'ARC'); common(e, push);
      push(10, fmt(r.cx)); push(20, fmt(r.cy)); push(30, 0);
      push(40, fmt(r.r)); push(50, fmt(r.start)); push(51, fmt(r.end));
      break;
    case 'LWPOLYLINE': {
      push(0, 'POLYLINE'); common(e, push);
      push(66, 1); push(70, r.closed ? 1 : 0);
      push(10, 0); push(20, 0); push(30, 0);
      for (const v of r.vertices) {
        push(0, 'VERTEX');
        push(10, fmt(v.x)); push(20, fmt(v.y)); push(30, 0);
        if (v.bulge) push(42, fmt(v.bulge));
      }
      push(0, 'SEQEND');
      break;
    }
    case 'POLYLINE': {
      push(0, 'POLYLINE'); common(e, push);
      push(66, 1); push(70, r.closed ? 1 : 0);
      push(10, 0); push(20, 0); push(30, 0);
      for (const v of r.vertices) {
        push(0, 'VERTEX');
        push(10, fmt(v.x)); push(20, fmt(v.y)); push(30, 0);
        if (v.bulge) push(42, fmt(v.bulge));
      }
      push(0, 'SEQEND');
      break;
    }
    // ELLIPSE / SPLINE / CHAIN：R12 不支持或为修复结果，以折线写出
    default:
      if (e.pts && e.pts.length >= 2) {
        push(0, 'POLYLINE'); common(e, push);
        push(66, 1); push(70, e.closedSrc ? 1 : 0);
        push(10, 0); push(20, 0); push(30, 0);
        const n = e.closedSrc && e.pts.length > 1 ? e.pts.length - 1 : e.pts.length;
        for (let i = 0; i < n; i++) {
          push(0, 'VERTEX');
          push(10, fmt(e.pts[i].x)); push(20, fmt(e.pts[i].y)); push(30, 0);
        }
        push(0, 'SEQEND');
      }
  }
}

function fmt(n) {
  return Number(n.toFixed(9)).toString();
}