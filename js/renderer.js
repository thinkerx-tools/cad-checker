// Canvas 渲染：世界坐标 → 屏幕坐标，支持缩放/平移/异常高亮

const ACI = {
  1: '#ff5f5f', 2: '#ffd75f', 3: '#5fdf7f', 4: '#5fd7df', 5: '#6f8fdf',
  6: '#df6fdf', 7: '#c9d8ea', 8: '#6b7f99', 9: '#9fb2c9', 30: '#ff9f4f',
  40: '#ffd75f', 90: '#7fdf9f', 140: '#5f9fdf', 210: '#9f7fdf'
};

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.scale = 1;
    this.ox = 0;
    this.oy = 0;
    this.entities = [];
    this.shapes = [];
    this.issues = [];
    this.selected = null;
    this.colors = this.readColors();
    this.resize();
    this.bindInput();
  }

  readColors() {
    const cs = getComputedStyle(document.documentElement);
    const get = (name, fb) => cs.getPropertyValue(name).trim() || fb;
    return {
      fg: get('--site-fg', '#dbe7f4'),
      muted: get('--site-muted', '#7c93b5'),
      accent: get('--site-accent', '#3fd8c7'),
      danger: get('--danger', '#ff6161'),
      warn: get('--warn', '#ffb454'),
      cross: get('--cross', '#e07bff')
    };
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.w = rect.width;
    this.h = rect.height;
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  setData(entities, shapes, issues) {
    this.entities = entities;
    this.shapes = shapes;
    this.issues = issues;
    this.draw();
  }

  bounds() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const e of this.entities) {
      if (!e.bbox) continue;
      x0 = Math.min(x0, e.bbox.x0); y0 = Math.min(y0, e.bbox.y0);
      x1 = Math.max(x1, e.bbox.x1); y1 = Math.max(y1, e.bbox.y1);
    }
    if (!isFinite(x0)) return null;
    return { x0, y0, x1, y1 };
  }

  fit(bbox) {
    const b = bbox || this.bounds();
    if (!b) return;
    const bw = Math.max(b.x1 - b.x0, 1e-6);
    const bh = Math.max(b.y1 - b.y0, 1e-6);
    const pad = 0.12;
    this.scale = Math.min(this.w / (bw * (1 + pad * 2)), this.h / (bh * (1 + pad * 2)));
    this.ox = this.w / 2 - (b.x0 + b.x1) / 2 * this.scale;
    this.oy = this.h / 2 + (b.y0 + b.y1) / 2 * this.scale;
    this.draw();
  }

  zoomAt(factor, sx, sy) {
    const ns = Math.min(Math.max(this.scale * factor, 1e-6), 1e9);
    const k = ns / this.scale;
    this.ox = sx - (sx - this.ox) * k;
    this.oy = sy - (sy - this.oy) * k;
    this.scale = ns;
    this.draw();
  }

  sx(x) { return x * this.scale + this.ox; }
  sy(y) { return -y * this.scale + this.oy; }

  bindInput() {
    const c = this.canvas;
    let dragging = false, lx = 0, ly = 0;
    const pointers = new Map();
    let pinchDist = 0;

    c.addEventListener('pointerdown', e => {
      c.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        dragging = true; lx = e.clientX; ly = e.clientY;
        c.classList.add('dragging');
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      }
    });
    c.addEventListener('pointermove', e => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const rect = c.getBoundingClientRect();
        if (pinchDist > 0 && d > 0) {
          this.zoomAt(d / pinchDist, (a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top);
        }
        pinchDist = d;
      } else if (dragging) {
        this.ox += e.clientX - lx;
        this.oy += e.clientY - ly;
        lx = e.clientX; ly = e.clientY;
        this.draw();
      }
    });
    const up = e => {
      pointers.delete(e.pointerId);
      if (pointers.size === 0) {
        dragging = false;
        c.classList.remove('dragging');
      }
      pinchDist = 0;
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', e => {
      e.preventDefault();
      const rect = c.getBoundingClientRect();
      this.zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - rect.left, e.clientY - rect.top);
    }, { passive: false });
  }

  draw() {
    const ctx = this.ctx;
    this.colors = this.readColors();
    ctx.clearRect(0, 0, this.w, this.h);
    if (!this.entities.length) return;

    // 基础实体
    ctx.lineWidth = 1.3;
    ctx.lineJoin = 'round';
    for (const e of this.entities) {
      if (!e.pts || e.pts.length < 2) continue;
      ctx.strokeStyle = ACI[e.color] || this.colors.fg;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.moveTo(this.sx(e.pts[0].x), this.sy(e.pts[0].y));
      for (let i = 1; i < e.pts.length; i++) {
        ctx.lineTo(this.sx(e.pts[i].x), this.sy(e.pts[i].y));
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // 异常高亮
    for (const issue of this.issues) {
      const sel = this.selected === issue.id;
      const color = issue.kind === 'open' ? this.colors.danger
        : issue.kind === 'contain' ? this.colors.warn : this.colors.cross;
      ctx.strokeStyle = color;
      ctx.lineWidth = sel ? 2.6 : 1.6;
      ctx.setLineDash(issue.kind === 'contain' ? [7, 5] : []);
      ctx.globalAlpha = sel ? 1 : 0.75;
      for (const sid of issue.shapeIds) {
        const s = this.shapes[sid];
        if (!s) continue;
        ctx.beginPath();
        ctx.moveTo(this.sx(s.pts[0].x), this.sy(s.pts[0].y));
        for (let i = 1; i < s.pts.length; i++) ctx.lineTo(this.sx(s.pts[i].x), this.sy(s.pts[i].y));
        ctx.stroke();
      }
      ctx.setLineDash([]);

      if (issue.kind === 'open') {
        const [a, b] = issue.focus;
        this.marker(a.x, a.y, color, 5);
        this.marker(b.x, b.y, color, 5);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.4;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(this.sx(a.x), this.sy(a.y));
        ctx.lineTo(this.sx(b.x), this.sy(b.y));
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (issue.kind === 'cross') {
        for (const p of issue.points) this.cross(p.x, p.y, color, sel ? 8 : 6);
      }
      ctx.globalAlpha = 1;
    }
  }

  marker(x, y, color, r) {
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(this.sx(x), this.sy(y), r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  cross(x, y, color, r) {
    const ctx = this.ctx;
    const px = this.sx(x), py = this.sy(y);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(px - r, py - r); ctx.lineTo(px + r, py + r);
    ctx.moveTo(px + r, py - r); ctx.lineTo(px - r, py + r);
    ctx.stroke();
  }
}