// DWG 支持：懒加载 libredwg-web (WASM)，将 DwgDatabase 实体映射为内部模型

let libPromise = null;

async function getLib() {
  if (!libPromise) {
    libPromise = import('../vendor/libredwg-web.js').then(async mod => {
      const lib = await mod.LibreDwg.create();
      return { lib, Dwg_File_Type: mod.Dwg_File_Type };
    });
  }
  return libPromise;
}

const RAD2DEG = 180 / Math.PI;

export async function parseDwg(buffer) {
  const { lib, Dwg_File_Type } = await getLib();
  const dwg = lib.dwg_read_data(buffer, Dwg_File_Type.DWG);
  if (!dwg) throw new Error('DWG 解析失败：文件可能损坏或版本不受支持');
  let db;
  try {
    db = lib.convert(dwg);
  } finally {
    lib.dwg_free(dwg);
  }

  const entities = [];
  let skipped = 0;
  for (const ent of db.entities || []) {
    const mapped = mapEntity(ent);
    if (mapped) entities.push(mapped);
    else skipped++;
  }
  return { entities, skipped };
}

function base(ent, type) {
  return {
    type,
    layer: ent.layer || '0',
    color: typeof ent.colorIndex === 'number' ? ent.colorIndex : 256,
    modified: false
  };
}

function mapEntity(ent) {
  switch (ent.type) {
    case 'LINE':
      return {
        ...base(ent, 'LINE'),
        raw: { x1: ent.startPoint.x, y1: ent.startPoint.y, x2: ent.endPoint.x, y2: ent.endPoint.y }
      };
    case 'LWPOLYLINE':
      return {
        ...base(ent, 'LWPOLYLINE'),
        raw: {
          vertices: (ent.vertices || []).map(v => ({ x: v.x, y: v.y, bulge: v.bulge || 0 })),
          closed: (ent.flag & 1) === 1
        }
      };
    case 'POLYLINE2D':
      return {
        ...base(ent, 'POLYLINE'),
        raw: {
          vertices: (ent.vertices || []).map(v => ({
            x: v.x, y: v.y, bulge: v.bulge || 0
          })),
          closed: (ent.flag & 1) === 1
        }
      };
    case 'CIRCLE':
      return {
        ...base(ent, 'CIRCLE'),
        raw: { cx: ent.center.x, cy: ent.center.y, r: ent.radius }
      };
    case 'ARC':
      return {
        ...base(ent, 'ARC'),
        raw: {
          cx: ent.center.x, cy: ent.center.y, r: ent.radius,
          start: ent.startAngle * RAD2DEG, end: ent.endAngle * RAD2DEG
        }
      };
    case 'ELLIPSE':
      return {
        ...base(ent, 'ELLIPSE'),
        raw: {
          cx: ent.center.x, cy: ent.center.y,
          mx: ent.majorAxisEndPoint.x, my: ent.majorAxisEndPoint.y,
          ratio: ent.axisRatio, start: ent.startAngle, end: ent.endAngle
        }
      };
    case 'SPLINE':
      return {
        ...base(ent, 'SPLINE'),
        raw: {
          degree: ent.degree,
          knots: ent.knots || [],
          controlPoints: (ent.controlPoints || []).map(p => ({ x: p.x, y: p.y })),
          weights: ent.weights || [],
          fitPoints: (ent.fitPoints || []).map(p => ({ x: p.x, y: p.y })),
          closed: (ent.flag & 1) === 1
        }
      };
    default:
      return null;
  }
}