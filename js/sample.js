// 内置示例图纸：包含全部三类异常与正常图形
// 正常：左下三角形、右侧 D 形（直线+圆弧连链闭合）
// 未闭合：中部带 2mm 缺口的矩形
// 包含：右上矩形内含圆
// 相交：上方两个重叠矩形

function lwpolyline(layer, closed, vertices) {
  const out = ['0', 'LWPOLYLINE', '8', layer, '70', closed ? '1' : '0', '90', String(vertices.length)];
  for (const [x, y] of vertices) out.push('10', String(x), '20', String(y));
  return out;
}

export const SAMPLE_DXF = [
  '0', 'SECTION', '2', 'ENTITIES',
  ...lwpolyline('OUTLINE', true, [[20, 20], [70, 20], [45, 60]]),
  ...lwpolyline('OUTLINE', false, [[100, 20], [150, 20], [150, 60], [100, 60], [100, 22]]),
  ...lwpolyline('OUTLINE', true, [[180, 20], [260, 20], [260, 80], [180, 80]]),
  '0', 'CIRCLE', '8', 'HOLES', '10', '220', '20', '50', '40', '15',
  ...lwpolyline('OUTLINE', true, [[30, 100], [110, 100], [110, 160], [30, 160]]),
  ...lwpolyline('OUTLINE', true, [[80, 130], [160, 130], [160, 190], [80, 190]]),
  '0', 'LINE', '8', 'OUTLINE', '10', '200', '20', '120', '11', '250', '21', '120',
  '0', 'ARC', '8', 'OUTLINE', '10', '225', '20', '120', '40', '25', '50', '0', '51', '180',
  '0', 'ENDSEC', '0', 'EOF', ''
].join('\n');