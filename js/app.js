import { parseDxf } from './dxf-parser.js';
import { parseDwg } from './dwg.js';
import { tessellate, detect, fixOpen, fixCross, deleteShapes, bboxOf } from './geometry.js';
import { exportDxf } from './dxf-writer.js';
import { Renderer } from './renderer.js';
import { SAMPLE_DXF } from './sample.js';

const $ = id => document.getElementById(id);
const canvas = $('canvas');
const renderer = new Renderer(canvas);

const state = {
  entities: [],
  fileName: '',
  result: null,
  tolOverride: null,
  undoStack: [],
  selectedIssue: null
};

/* ---------------- 工具 ---------------- */

let toastTimer = null;
function toast(msg, isError = false) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.toggle('error', isError);
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), isError ? 6000 : 3500);
}

function setLoading(on, text) {
  $('loading').classList.toggle('hidden', !on);
  if (text) $('loadingText').textContent = text;
}

function autoTol() {
  const pts = state.entities.flatMap(e => e.pts || []);
  if (!pts.length) return 0.01;
  const b = bboxOf(pts);
  const diag = Math.hypot(b.x1 - b.x0, b.y1 - b.y0) || 1;
  return Number((diag * 1e-4).toPrecision(3));
}

/* ---------------- 载入 ---------------- */

async function loadFile(file) {
  const name = file.name || 'drawing';
  const ext = name.toLowerCase().split('.').pop();
  try {
    if (ext === 'dwg') {
      setLoading(true, '正在加载 DWG 解析引擎（首次约 8 MB）…');
      const buf = await file.arrayBuffer();
      setLoading(true, '正在解析 DWG…');
      await new Promise(r => setTimeout(r, 30));
      applyResult(await parseDwg(buf), name);
    } else if (ext === 'dxf') {
      setLoading(true, '正在解析 DXF…');
      const text = await file.text();
      applyResult(parseDxf(text), name);
    } else {
      toast('仅支持 .dxf / .dwg 文件', true);
    }
  } catch (err) {
    console.error(err);
    toast('解析失败：' + (err.message || err), true);
  } finally {
    setLoading(false);
  }
}

function applyResult({ entities, skipped }, name) {
  if (!entities.length) {
    toast('文件中没有可检测的图形实体（支持直线、多段线、圆、圆弧、椭圆、样条线）', true);
    return;
  }
  entities.forEach((e, i) => { e.id = 'e' + i; tessellate(e); });
  state.entities = entities;
  state.fileName = name;
  state.undoStack = [];
  state.tolOverride = null;
  state.selectedIssue = null;
  $('fileName').textContent = name;
  $('empty').classList.add('hidden');
  $('stageTools').classList.remove('hidden');
  $('stageStats').classList.remove('hidden');
  $('panelControls').classList.remove('hidden');
  $('btnExport').disabled = false;
  $('tolInput').value = autoTol();
  refresh();
  renderer.fit();
  if (skipped) toast(`已忽略 ${skipped} 个暂不支持的实体（如文字、块引用、标注）`);
}

/* ---------------- 检测与刷新 ---------------- */

function refresh() {
  const tol = state.tolOverride ?? autoTol();
  state.result = detect(state.entities, tol);
  renderer.selected = null;
  renderer.setData(state.entities, state.result.shapes, state.result.issues);
  renderPanel();
  $('btnUndo').disabled = state.undoStack.length === 0;
}

function shapeLabel(sid) {
  const s = state.result.shapes[sid];
  const e = state.entities.find(en => en.id === s.entityIds[0]);
  return `图形#${sid}（${e?.layer || '0'} 层）`;
}

function renderPanel() {
  const { shapes, issues } = state.result;
  const nOpen = issues.filter(i => i.kind === 'open').length;
  const nContain = issues.filter(i => i.kind === 'contain').length;
  const nCross = issues.filter(i => i.kind === 'cross').length;
  $('nClosed').textContent = shapes.filter(s => s.closed).length;
  $('nOpen').textContent = nOpen;
  $('nContain').textContent = nContain;
  $('nCross').textContent = nCross;
  $('stEntities').textContent = state.entities.length;
  $('stShapes').textContent = shapes.length;
  $('stClosed').textContent = shapes.filter(s => s.closed).length;
  $('btnFixAll').disabled = issues.length === 0;

  const list = $('issueList');
  list.innerHTML = '';
  if (!issues.length) {
    const div = document.createElement('div');
    div.className = 'all-clear';
    div.innerHTML = '<span class="big">✓</span>所有图形均通过检测：<br>闭合、无包含、无相交。可以导出文件。';
    list.appendChild(div);
    return;
  }

  const groups = [
    ['open', '未闭合图形', nOpen],
    ['contain', '闭合图形包含关系', nContain],
    ['cross', '线条相交', nCross]
  ];
  for (const [kind, title, count] of groups) {
    if (!count) continue;
    const g = document.createElement('div');
    g.className = 'issue-group';
    const h = document.createElement('h3');
    h.innerHTML = `<span class="dot ${kind}"></span>${title}（${count}）`;
    g.appendChild(h);
    for (const issue of issues.filter(i => i.kind === kind)) {
      g.appendChild(issueCard(issue));
    }
    list.appendChild(g);
  }
}

function issueCard(issue) {
  const card = document.createElement('div');
  card.className = 'issue';
  card.dataset.kind = issue.kind;
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', '定位异常');

  const title = document.createElement('div');
  title.className = 'title';
  const detail = document.createElement('div');
  detail.className = 'detail';
  const actions = document.createElement('div');
  actions.className = 'actions';

  const btn = (label, cls, fn, disabled = false, tip = '') => {
    const b = document.createElement('button');
    b.className = 'btn small ' + cls;
    b.textContent = label;
    b.disabled = disabled;
    if (tip) b.title = tip;
    b.addEventListener('click', ev => { ev.stopPropagation(); fn(); });
    actions.appendChild(b);
  };

  if (issue.kind === 'open') {
    title.textContent = shapeLabel(issue.shapeIds[0]) + ' 未闭合';
    detail.textContent = `首尾缺口 ${issue.gap.toPrecision(4)}（图纸单位）`;
    btn('修复·连接首尾', 'fix', () => applyFix(issue, 'open'));
    btn('删除图形', 'danger', () => applyDelete(issue.shapeIds));
  } else if (issue.kind === 'contain') {
    title.textContent = shapeLabel(issue.outerId) + ' 包含 ' + shapeLabel(issue.innerId);
    detail.textContent = '内层图形完全位于外层图形内部（包含关系需删除其中一方解除）';
    btn('删除内层', 'danger', () => applyDelete([issue.innerId]));
    btn('删除外层', 'danger', () => applyDelete([issue.outerId]));
  } else {
    const [a, b] = issue.shapeIds;
    title.textContent = shapeLabel(a) + ' 与 ' + shapeLabel(b) + ' 相交';
    detail.textContent = `${issue.points.length} 个交点`;
    const sA = state.result.shapes[a], sB = state.result.shapes[b];
    const repairable = sA.closed || sB.closed;
    btn('修复·裁剪合并', 'fix', () => applyFix(issue, 'cross'), !repairable,
      repairable ? '在交点处裁剪并合并轮廓' : '两条开放线条相交暂不支持自动修复，请删除其中一条');
    btn('删除图形#' + a, 'danger', () => applyDelete([a]));
    btn('删除图形#' + b, 'danger', () => applyDelete([b]));
  }

  card.append(title, detail, actions);
  const locate = () => {
    state.selectedIssue = issue.id;
    renderer.selected = issue.id;
    renderer.draw();
    renderer.fit(issue.bbox);
    document.querySelectorAll('.issue.selected').forEach(el => el.classList.remove('selected'));
    card.classList.add('selected');
  };
  card.addEventListener('click', locate);
  card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); locate(); } });
  return card;
}

/* ---------------- 修复 / 删除 / 撤销 ---------------- */

function pushUndo() {
  state.undoStack.push(structuredClone(state.entities));
  if (state.undoStack.length > 30) state.undoStack.shift();
}

function applyFix(issue, kind) {
  const { shapes, eps } = state.result;
  let next = null;
  if (kind === 'open') {
    next = fixOpen(state.entities, shapes, issue);
  } else {
    next = fixCross(state.entities, shapes, issue, eps);
    if (!next) {
      toast('自动修复失败：交点过于复杂，无法拼出闭合轮廓，请选择删除其中一方', true);
      return;
    }
  }
  pushUndo();
  state.entities = next;
  refresh();
  toast(kind === 'open' ? '已连接首尾，图形闭合' : '已在交点处裁剪并合并轮廓');
}

function applyDelete(shapeIds) {
  pushUndo();
  state.entities = deleteShapes(state.entities, state.result.shapes, shapeIds);
  refresh();
  toast('已删除所选图形');
}

function fixAll() {
  let fixed = 0, failed = 0;
  pushUndo();
  for (let round = 0; round < 200; round++) {
    const tol = state.tolOverride ?? autoTol();
    const result = detect(state.entities, tol);
    const issue = result.issues.find(i => i.kind === 'open')
      || result.issues.find(i => i.kind === 'cross' &&
          (result.shapes[i.shapeIds[0]].closed || result.shapes[i.shapeIds[1]].closed))
      || result.issues.find(i => i.kind === 'contain');
    if (!issue) break;
    let next = null;
    if (issue.kind === 'open') next = fixOpen(state.entities, result.shapes, issue);
    else if (issue.kind === 'cross') next = fixCross(state.entities, result.shapes, issue, result.eps);
    else next = deleteShapes(state.entities, result.shapes, [issue.innerId]);
    if (!next) { failed++; break; }
    state.entities = next;
    fixed++;
  }
  refresh();
  const remain = state.result.issues.length;
  toast(`批量处理完成：已处理 ${fixed} 项` +
    (remain ? `，剩余 ${remain} 项需手动选择删除` : '，全部通过检测') +
    (failed ? '（存在无法自动修复的相交）' : ''), remain > 0);
}

/* ---------------- 导出 ---------------- */

function doExport() {
  if (!state.entities.length) {
    toast('没有可导出的图形', true);
    return;
  }
  const text = exportDxf(state.entities);
  const blob = new Blob([text], { type: 'application/dxf' });
  const a = document.createElement('a');
  const base = (state.fileName || 'drawing').replace(/\.(dxf|dwg)$/i, '');
  a.href = URL.createObjectURL(blob);
  a.download = base + '-checked.dxf';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast('已导出 ' + a.download);
}

/* ---------------- 事件绑定 ---------------- */

$('btnOpen').addEventListener('click', () => $('fileInput').click());
$('btnPick').addEventListener('click', () => $('fileInput').click());
$('fileInput').addEventListener('change', e => {
  if (e.target.files[0]) loadFile(e.target.files[0]);
  e.target.value = '';
});

const loadSample = () => {
  applyResult(parseDxf(SAMPLE_DXF), '示例图纸.dxf');
  toast('示例已载入：包含未闭合、包含、相交三类异常，试试逐项处理');
};
$('btnSample').addEventListener('click', loadSample);
$('btnSample2').addEventListener('click', loadSample);

$('btnUndo').addEventListener('click', () => {
  if (!state.undoStack.length) return;
  state.entities = state.undoStack.pop();
  refresh();
  toast('已撤销上一步操作');
});
$('btnExport').addEventListener('click', doExport);
$('btnFixAll').addEventListener('click', fixAll);

$('tolInput').addEventListener('change', e => {
  const v = parseFloat(e.target.value);
  state.tolOverride = Number.isFinite(v) && v >= 0 ? v : null;
  if (state.entities.length) refresh();
});

$('btnZoomIn').addEventListener('click', () => renderer.zoomAt(1.3, renderer.w / 2, renderer.h / 2));
$('btnZoomOut').addEventListener('click', () => renderer.zoomAt(1 / 1.3, renderer.w / 2, renderer.h / 2));
$('btnFit').addEventListener('click', () => renderer.fit());

const stage = $('stage');
stage.addEventListener('dragover', e => { e.preventDefault(); stage.classList.add('dragover'); });
stage.addEventListener('dragleave', () => stage.classList.remove('dragover'));
stage.addEventListener('drop', e => {
  e.preventDefault();
  stage.classList.remove('dragover');
  if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
});

new ResizeObserver(() => renderer.resize()).observe(stage);