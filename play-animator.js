// Animated half-court play diagrams.
// Court units are tenths of a foot: baseline at y=0, hoop at (250, 52.5), lane is x 170-330.
// Out of bounds (baseline side) is y < 0.
(function () {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const MOVE_MS = 1500;
  const HOLD_MS = 900;
  const LEAD_MS = 900;
  const PLAYER_R = 16;
  const BALL_OFFSET = [13, -13];

  function el(name, attrs, parent) {
    const node = document.createElementNS(SVG_NS, name);
    for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, v);
    if (parent) parent.appendChild(node);
    return node;
  }

  function html(tag, attrs, text) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, v);
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // Smooth curve through the points (quadratic segments through midpoints).
  function smoothPath(points) {
    let d = `M${points[0][0]} ${points[0][1]}`;
    if (points.length === 2) return d + ` L${points[1][0]} ${points[1][1]}`;
    for (let i = 1; i < points.length - 1; i++) {
      const [cx, cy] = points[i];
      const last = i === points.length - 2;
      const nx = last ? points[i + 1][0] : (cx + points[i + 1][0]) / 2;
      const ny = last ? points[i + 1][1] : (cy + points[i + 1][1]) / 2;
      d += ` Q${cx} ${cy} ${nx} ${ny}`;
    }
    return d;
  }

  function drawCourt(svg) {
    const g = el('g', { class: 'court' }, svg);
    el('rect', { x: -40, y: -80, width: 580, height: 80, class: 'oob' }, g);
    el('rect', { x: 0, y: 0, width: 500, height: 340, class: 'floor' }, g);
    el('rect', { x: 170, y: 0, width: 160, height: 190, class: 'paint' }, g);
    // Free throw circle: solid away from the hoop, dashed inside the lane.
    el('path', { d: 'M190 190 A60 60 0 0 0 310 190', class: 'line' }, g);
    el('path', { d: 'M190 190 A60 60 0 0 1 310 190', class: 'line dashed' }, g);
    // Lane block marks.
    for (const y of [70, 110, 140, 170]) {
      el('line', { x1: 162, y1: y, x2: 170, y2: y, class: 'line' }, g);
      el('line', { x1: 330, y1: y, x2: 338, y2: y, class: 'line' }, g);
    }
    // Three point line.
    el('path', { d: 'M52.5 0 L52.5 52.5 A197.5 197.5 0 0 0 447.5 52.5 L447.5 0', class: 'line' }, g);
    // Restricted arc, backboard, rim.
    el('path', { d: 'M210 52.5 A40 40 0 0 0 290 52.5', class: 'line' }, g);
    el('line', { x1: 220, y1: 40, x2: 280, y2: 40, class: 'backboard' }, g);
    el('line', { x1: 250, y1: 40, x2: 250, y2: 43.5, class: 'rim' }, g);
    el('circle', { cx: 250, cy: 52.5, r: 9, class: 'rim' }, g);
    // Court boundary.
    el('path', { d: 'M0 340 L0 0 L500 0 L500 340', class: 'line boundary' }, g);
    el('text', { x: 250, y: -52, class: 'court-label' }, g).textContent = 'OUT OF BOUNDS';
  }

  class PlayAnimator {
    constructor(container, play) {
      this.play = play;
      this.t = 0;
      this.speed = 1;
      this.playing = false;
      this.stopAt = null;
      this.lastFrame = null;

      this.buildDom(container);
      this.buildTimeline();
      this.render();
    }

    buildDom(container) {
      const play = this.play;
      container.classList.add('play-card');
      container.appendChild(html('h2', {}, play.name));
      container.appendChild(html('p', { class: 'play-meta' }, `${play.type} · ${play.set}`));
      if (play.description) container.appendChild(html('p', { class: 'play-desc' }, play.description));

      this.svg = el('svg', {
        viewBox: '-20 -80 540 420',
        role: 'img',
        'aria-label': `${play.name} play diagram`,
      });
      container.appendChild(this.svg);
      drawCourt(this.svg);
      this.trailLayer = el('g', { class: 'trails' }, this.svg);
      this.playerLayer = el('g', { class: 'players' }, this.svg);

      this.caption = html('p', { class: 'play-caption', 'aria-live': 'polite' });
      container.appendChild(this.caption);

      const controls = html('div', { class: 'play-controls' });
      this.restartBtn = html('button', { type: 'button', title: 'Restart' }, '⟲');
      this.prevBtn = html('button', { type: 'button', title: 'Previous step' }, '◀︎ Step');
      this.playBtn = html('button', { type: 'button', class: 'primary' }, '▶︎ Play');
      this.nextBtn = html('button', { type: 'button', title: 'Next step' }, 'Step ▶︎');
      this.speedSel = html('select', { 'aria-label': 'Speed' });
      for (const s of [0.5, 1, 1.5]) {
        const opt = html('option', { value: s }, `${s}×`);
        if (s === 1) opt.selected = true;
        this.speedSel.appendChild(opt);
      }
      controls.append(this.restartBtn, this.prevBtn, this.playBtn, this.nextBtn, this.speedSel);
      container.appendChild(controls);

      this.scrub = html('input', { type: 'range', min: 0, max: 1000, value: 0, class: 'play-scrub', 'aria-label': 'Timeline' });
      container.appendChild(this.scrub);

      this.stepList = html('ol', { class: 'play-steps' });
      const items = [{ caption: play.setup }].concat(play.steps);
      this.stepItems = items.map((step, i) => {
        const li = html('li', i === 1 ? { value: 1 } : {}, step.caption);
        li.addEventListener('click', () => this.jumpTo(i === 0 ? 0 : this.endOfMove(i - 1)));
        this.stepList.appendChild(li);
        return li;
      });
      container.appendChild(this.stepList);

      if (play.legend) container.appendChild(html('p', { class: 'play-legend' }, play.legend));

      this.restartBtn.addEventListener('click', () => this.jumpTo(0));
      this.playBtn.addEventListener('click', () => (this.playing ? this.pause() : this.start()));
      this.nextBtn.addEventListener('click', () => this.nextStep());
      this.prevBtn.addEventListener('click', () => this.prevStep());
      this.speedSel.addEventListener('change', () => (this.speed = parseFloat(this.speedSel.value)));
      this.scrub.addEventListener('input', () => this.jumpTo((this.scrub.value / 1000) * this.duration));
    }

    // Build paths for every move up front so any moment in the play can be rendered directly.
    buildTimeline() {
      const play = this.play;
      const pos = {};
      for (const [id, p] of Object.entries(play.players)) pos[id] = [p.x, p.y];
      let holder = play.ball;

      this.startPositions = { ...pos };
      this.startHolder = holder;

      this.steps = play.steps.map((step) => {
        const group = el('g', { class: 'step-trail' }, this.trailLayer);
        const actions = step.actions.map((a) => {
          if (a.type === 'pass') {
            const line = el('line', { class: 'trail pass' }, group);
            const action = { ...a, line };
            holder = a.to;
            return action;
          }
          const points = [pos[a.player]].concat(a.to);
          const path = el('path', { d: smoothPath(points), class: `trail ${a.type}` }, group);
          const length = path.getTotalLength();
          path.setAttribute('stroke-dasharray', `${length} ${length}`);
          const end = path.getPointAtLength(length);
          const before = path.getPointAtLength(Math.max(0, length - 6));
          const angle = (Math.atan2(end.y - before.y, end.x - before.x) * 180) / Math.PI;
          const head = el('g', { class: `trail-end ${a.type}`, transform: `translate(${end.x} ${end.y}) rotate(${angle})` }, group);
          if (a.type === 'screen') {
            el('line', { x1: 0, y1: -14, x2: 0, y2: 14 }, head);
          } else {
            el('path', { d: 'M0 0 L-13 -7 L-13 7 Z' }, head);
          }
          pos[a.player] = points[points.length - 1];
          return { ...a, path, length, head };
        });
        return { ...step, group, actions };
      });

      this.playerNodes = {};
      for (const [id, p] of Object.entries(play.players)) {
        const g = el('g', { class: 'player' }, this.playerLayer);
        el('circle', { r: PLAYER_R }, g);
        el('text', { y: 1 }, g).textContent = p.label || id;
        this.playerNodes[id] = g;
      }
      this.ballNode = el('circle', { r: 7, class: 'ball' }, this.playerLayer);

      this.duration = LEAD_MS + this.steps.length * (MOVE_MS + HOLD_MS);
    }

    stepStart(i) {
      return LEAD_MS + i * (MOVE_MS + HOLD_MS);
    }

    endOfMove(i) {
      return this.stepStart(i) + MOVE_MS;
    }

    render() {
      const t = this.t;
      const pos = { ...this.startPositions };
      let holder = this.startHolder;
      let ballAt = null;
      let current = -1;

      this.steps.forEach((step, i) => {
        const local = t - this.stepStart(i);
        const p = Math.min(1, Math.max(0, local / MOVE_MS));
        const eased = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        step.group.style.display = local > 0 ? '' : 'none';
        if (local < 0) return;
        current = i;

        for (const a of step.actions) {
          if (a.type === 'pass') {
            const from = pos[a.from];
            const to = pos[a.to];
            const sx = from[0] + BALL_OFFSET[0], sy = from[1] + BALL_OFFSET[1];
            const ex = to[0] + BALL_OFFSET[0], ey = to[1] + BALL_OFFSET[1];
            const bx = sx + (ex - sx) * eased, by = sy + (ey - sy) * eased;
            a.line.setAttribute('x1', sx);
            a.line.setAttribute('y1', sy);
            a.line.setAttribute('x2', bx);
            a.line.setAttribute('y2', by);
            if (p >= 1) holder = a.to;
            else if (p > 0) ballAt = [bx, by];
            continue;
          }
          const pt = a.path.getPointAtLength(eased * a.length);
          pos[a.player] = [pt.x, pt.y];
          a.path.setAttribute('stroke-dashoffset', a.length * (1 - eased));
          a.head.style.display = p >= 1 ? '' : 'none';
        }
      });

      this.steps.forEach((step, i) => step.group.classList.toggle('past', i < current));

      for (const [id, node] of Object.entries(this.playerNodes)) {
        node.setAttribute('transform', `translate(${pos[id][0]} ${pos[id][1]})`);
      }
      if (!ballAt) {
        const h = pos[holder];
        ballAt = [h[0] + BALL_OFFSET[0], h[1] + BALL_OFFSET[1]];
      }
      this.ballNode.setAttribute('cx', ballAt[0]);
      this.ballNode.setAttribute('cy', ballAt[1]);

      this.caption.textContent = current < 0 ? this.play.setup : this.steps[current].caption;
      this.stepItems.forEach((li, i) => li.classList.toggle('active', i === current + 1));
      this.scrub.value = Math.round((t / this.duration) * 1000);
      this.playBtn.textContent = this.playing ? '❚❚ Pause' : '▶︎ Play';
    }

    tick(now) {
      if (!this.playing) return;
      if (this.lastFrame !== null) this.t += (now - this.lastFrame) * this.speed;
      this.lastFrame = now;
      const limit = this.stopAt !== null ? this.stopAt : this.duration;
      if (this.t >= limit) {
        this.t = limit;
        this.playing = false;
        this.stopAt = null;
      }
      this.render();
      if (this.playing) requestAnimationFrame((n) => this.tick(n));
    }

    start(stopAt = null) {
      if (this.t >= this.duration) this.t = 0;
      this.stopAt = stopAt;
      this.playing = true;
      this.lastFrame = null;
      requestAnimationFrame((n) => this.tick(n));
    }

    pause() {
      this.playing = false;
      this.stopAt = null;
      this.render();
    }

    jumpTo(t) {
      this.playing = false;
      this.stopAt = null;
      this.t = Math.min(this.duration, Math.max(0, t));
      this.render();
    }

    completedSteps() {
      return this.steps.filter((_, i) => this.t >= this.endOfMove(i)).length;
    }

    nextStep() {
      const done = this.completedSteps();
      if (done >= this.steps.length) return;
      if (this.t < this.stepStart(done)) this.t = this.stepStart(done);
      this.start(this.endOfMove(done));
    }

    prevStep() {
      const done = this.completedSteps();
      this.jumpTo(done <= 1 ? 0 : this.endOfMove(done - 2));
    }
  }

  window.PlayAnimator = PlayAnimator;
})();
