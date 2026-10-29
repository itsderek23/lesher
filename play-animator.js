// Animated play diagrams.
// Court units are tenths of a foot: baseline at y=0, hoop at (250, 52.5), lane is x 170-330.
// Out of bounds (baseline side) is y < 0.
(function () {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const MOVE_MS = 1500;
  const HOLD_MS = 900;
  const LEAD_MS = 900;
  const PLAYER_R = 16;
  const BALL_OFFSET = [13, -13];
  const SCREEN_ANGLES = { right: 0, down: 90, left: 180, up: -90 };
  const STAR = 'M0.0 -30.0 L7.6 -10.5 L28.5 -9.3 L12.4 4.0 L17.6 24.3 L0.0 13.0 L-17.6 24.3 L-12.4 4.0 L-28.5 -9.3 L-7.6 -10.5 Z';
  // Baseline plays show the frontcourt below the baseline; sideline plays show it down to half court,
  // with the out of bounds area along the right sideline. Press plays show the backcourt (inbounding
  // under the opponent's basket) and past half court. Half court sets have no out of bounds area.
  const COURTS = {
    halfcourt: { viewBox: '-20 -20 540 390', depth: 350 },
    baseline: { viewBox: '-20 -80 540 420', depth: 340 },
    sideline: { viewBox: '-20 -30 610 520', depth: 470 },
    press: { viewBox: '-20 -80 540 670', depth: 580 },
  };

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

  // Eased progress (0-1) of an action at a point in its step. Actions can run over part of the
  // step (start/end are fractions) to stagger movement.
  function actionProgress(a, stepP) {
    const startAt = a.start || 0;
    const endAt = a.end || 1;
    const p = Math.min(1, Math.max(0, (stepP - startAt) / (endAt - startAt)));
    return { p, eased: p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2 };
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

  function drawCourt(svg, view) {
    const { depth } = COURTS[view];
    const g = el('g', { class: 'court' }, svg);
    el('rect', { x: 0, y: 0, width: 500, height: depth, class: 'floor' }, g);
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
    el('path', { d: `M0 ${depth} L0 0 L500 0 L500 ${depth}`, class: 'line boundary' }, g);
    if (view === 'sideline') {
      el('line', { x1: 0, y1: depth, x2: 500, y2: depth, class: 'line boundary' }, g);
      el('path', { d: `M190 ${depth} A60 60 0 0 1 310 ${depth}`, class: 'line' }, g);
      el('text', { x: 562, y: 140, class: 'court-label', transform: 'rotate(90 562 140)' }, g).textContent = 'OUT OF BOUNDS';
    } else if (view !== 'halfcourt') {
      el('text', { x: 250, y: -52, class: 'court-label' }, g).textContent = 'OUT OF BOUNDS';
    }
    if (view === 'press') {
      el('line', { x1: 0, y1: 470, x2: 500, y2: 470, class: 'line boundary' }, g);
      el('circle', { cx: 250, cy: 470, r: 60, class: 'line' }, g);
    }
  }

  class PlayAnimator {
    // A play can have variants (e.g. against man or zone), shown as tabs. Each variant has its own
    // setup and steps, and can override the play's players and ball.
    constructor(container, play) {
      this.play = play;
      this.variants = play.variants || [play];
      this.active = { ...play, ...this.variants[0] };
      this.t = 0;
      this.playing = false;
      this.stopAt = null;
      this.lastFrame = null;

      this.buildDom(container);
      this.buildTimeline();
      this.render();
    }

    buildDom(container) {
      const play = this.play;
      this.container = container;
      container.classList.add('play-card');
      container.appendChild(html('h2', {}, play.name));
      container.appendChild(html('p', { class: 'play-meta' }, `${play.type} · ${play.set}`));
      if (play.description) container.appendChild(html('p', { class: 'play-desc' }, play.description));

      if (this.variants.length > 1) {
        const tabs = html('div', { class: 'play-variants', role: 'tablist' });
        this.variantTabs = this.variants.map((v, i) => {
          const tab = html('button', { type: 'button', role: 'tab' }, v.name);
          tab.addEventListener('click', () => this.selectVariant(i));
          tabs.appendChild(tab);
          return tab;
        });
        this.variantTabs[0].classList.add('active');
        container.appendChild(tabs);
      }

      const view = play.court || 'baseline';
      this.svg = el('svg', {
        viewBox: COURTS[view].viewBox,
        role: 'img',
        'aria-label': `${play.name} play diagram`,
      });
      container.appendChild(this.svg);
      drawCourt(this.svg, view);
      this.trailLayer = el('g', { class: 'trails' }, this.svg);
      this.playerLayer = el('g', { class: 'players' }, this.svg);

      this.caption = html('p', { class: 'play-caption', 'aria-live': 'polite' });
      container.appendChild(this.caption);

      const controls = html('div', { class: 'play-controls' });
      this.restartBtn = html('button', { type: 'button', title: 'Restart' }, '⟲');
      this.prevBtn = html('button', { type: 'button', title: 'Previous step' }, '◀︎ Step');
      this.playBtn = html('button', { type: 'button', class: 'primary' }, '▶︎ Play');
      this.nextBtn = html('button', { type: 'button', title: 'Next step' }, 'Step ▶︎');
      this.fullBtn = html('button', { type: 'button', class: 'play-full' });
      this.setFullLabel('⛶', 'Full screen');
      controls.append(this.restartBtn, this.prevBtn, this.playBtn, this.nextBtn, this.fullBtn);
      container.appendChild(controls);

      this.scrub = html('input', { type: 'range', min: 0, max: 1000, value: 0, class: 'play-scrub', 'aria-label': 'Timeline' });
      container.appendChild(this.scrub);

      this.restartBtn.addEventListener('click', () => this.jumpTo(0));
      this.fullBtn.addEventListener('click', () => (this.isFull ? this.closeFull() : this.openFull()));
      this.svg.addEventListener('click', () => {
        if (!this.isFull) this.openFull();
        else if (this.playing) this.pause();
        else this.start();
      });
      document.addEventListener('fullscreenchange', () => {
        if (this.isFull && document.fullscreenElement !== this.container) this.closeFull();
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.isFull) this.closeFull();
      });
      this.playBtn.addEventListener('click', () => (this.playing ? this.pause() : this.start()));
      this.nextBtn.addEventListener('click', () => this.nextStep());
      this.prevBtn.addEventListener('click', () => this.prevStep());
      this.scrub.addEventListener('input', () => this.jumpTo((this.scrub.value / 1000) * this.duration));
    }

    // Build paths for every move up front so any moment in the play can be rendered directly.
    buildTimeline() {
      const play = this.active;
      this.trailLayer.replaceChildren();
      this.playerLayer.replaceChildren();
      const pos = {};
      for (const [id, p] of Object.entries(play.players)) pos[id] = [p.x, p.y];
      let holder = play.ball;

      this.startPositions = { ...pos };
      this.startHolder = holder;

      // A move with fills: <player> takes that player's spot. While the spot is empty it pulses,
      // like the tail lights of the player who left it.
      const spotLayer = el('g', { class: 'spots' }, this.trailLayer);
      this.steps = play.steps.map((step) => {
        const group = el('g', { class: 'step-trail' }, this.trailLayer);
        const stepStartPos = { ...pos };
        const actions = step.actions.map((a) => {
          // A pass is one dashed line; a handoff is drawn as a double line.
          if (a.type === 'pass' || a.type === 'handoff') {
            const lines = (a.type === 'handoff' ? [-4, 4] : [0]).map((offset) => ({
              offset,
              node: el('line', { class: `trail ${a.type}` }, group),
            }));
            holder = a.to;
            return { ...a, lines };
          }
          const points = [pos[a.player]].concat(a.to);
          const path = el('path', { d: smoothPath(points), class: `trail ${a.type}` }, group);
          const length = path.getTotalLength();
          path.setAttribute('stroke-dasharray', `${length} ${length}`);
          const end = path.getPointAtLength(length);
          const before = path.getPointAtLength(Math.max(0, length - 6));
          const angle = (Math.atan2(end.y - before.y, end.x - before.x) * 180) / Math.PI;
          const head = el('g', { class: `trail-end ${a.type}`, transform: `translate(${end.x} ${end.y}) rotate(${angle})` }, group);
          // Drawn just past the player's circle so it isn't hidden underneath.
          const tip = PLAYER_R + 6;
          if (a.type === 'screen') {
            el('line', { x1: tip, y1: -14, x2: tip, y2: 14 }, head);
          } else {
            el('path', { d: `M${tip + 4} 0 L${tip - 9} -7 L${tip - 9} 7 Z` }, head);
          }
          pos[a.player] = points[points.length - 1];
          const spot = a.fills && el('circle', { cx: stepStartPos[a.fills][0], cy: stepStartPos[a.fills][1], r: PLAYER_R + 4, class: 'vacated' }, spotLayer);
          return { ...a, path, length, head, spot };
        });
        for (const a of actions) {
          if (a.spot) a.vacater = actions.find((m) => m.path && String(m.player) === String(a.fills));
        }
        return { ...step, duration: step.duration || MOVE_MS, group, actions };
      });

      let t = LEAD_MS;
      this.starts = this.steps.map((step) => {
        const start = t;
        t += step.duration + HOLD_MS;
        return start;
      });
      this.duration = t;

      this.playerNodes = {};
      this.startScreens = {};
      // Defenders (defense: true) are drawn as an X with a dashed line to the player they guard,
      // their call (e.g. BALL, HELP, LOW) underneath, and a star when they're the low man.
      this.guardLines = {};
      this.calls = {};
      this.stars = {};
      const guardLayer = el('g', { class: 'guards' }, this.playerLayer);
      for (const [id, p] of Object.entries(play.players)) {
        if (p.guards) this.guardLines[id] = el('line', { class: 'guard' }, guardLayer);
        const g = el('g', { class: p.defense ? 'player defense' : 'player' }, this.playerLayer);
        if (p.defense) {
          this.stars[id] = el('path', { d: STAR, class: 'low-star' }, g);
          this.calls[id] = el('text', { y: PLAYER_R + 15, class: 'call' }, g);
        }
        // A player can start in a screen, with the bar on the given side (right, left, up, down).
        if (p.screen) {
          const bar = el('g', { class: 'trail-end', transform: `rotate(${SCREEN_ANGLES[p.screen]})` }, g);
          el('line', { x1: PLAYER_R + 6, y1: -14, x2: PLAYER_R + 6, y2: 14 }, bar);
          this.startScreens[id] = bar;
        }
        el('circle', { r: PLAYER_R }, g);
        el('text', { y: 1 }, g).textContent = p.label ?? id;
        this.playerNodes[id] = g;
      }
      this.ballNode = el('circle', { r: 7, class: 'ball' }, this.playerLayer);
      // A formation with no steps is a still diagram, so the play controls are hidden.
      this.container.classList.toggle('static', this.steps.length === 0);
    }

    selectVariant(i) {
      this.active = { ...this.play, ...this.variants[i] };
      this.variantTabs.forEach((tab, j) => tab.classList.toggle('active', i === j));
      this.buildTimeline();
      this.jumpTo(0);
    }

    stepStart(i) {
      return this.starts[i];
    }

    endOfMove(i) {
      return this.starts[i] + this.steps[i].duration;
    }

    render() {
      const t = this.t;
      const pos = { ...this.startPositions };
      let holder = this.startHolder;
      let ballAt = null;
      let current = -1;

      this.steps.forEach((step, i) => {
        const local = t - this.stepStart(i);
        const stepP = local / step.duration;
        step.group.style.display = local > 0 ? '' : 'none';
        for (const a of step.actions) {
          if (!a.spot) continue;
          const left = local > 0 && (!a.vacater || actionProgress(a.vacater, stepP).p > 0);
          a.spot.style.display = left && actionProgress(a, stepP).p < 1 ? '' : 'none';
        }
        if (local < 0) return;
        current = i;

        for (const a of step.actions) {
          const { p, eased } = actionProgress(a, stepP);

          if (a.lines) {
            // Passer and receiver may be moving in this step: use where they are when the ball
            // leaves and arrives, so the pass line stays put after the catch.
            const from = this.positionInStep(step, a.from, Math.min(stepP, a.start || 0), pos);
            const to = this.positionInStep(step, a.to, Math.min(stepP, a.end || 1), pos);
            // Handoffs are short, so draw them center to center where they're easier to see.
            const [ox, oy] = a.type === 'handoff' ? [0, 0] : BALL_OFFSET;
            const sx = from[0] + ox, sy = from[1] + oy;
            const ex = to[0] + ox, ey = to[1] + oy;
            const bx = sx + (ex - sx) * eased, by = sy + (ey - sy) * eased;
            const len = Math.hypot(ex - sx, ey - sy) || 1;
            const nx = -(ey - sy) / len, ny = (ex - sx) / len;
            for (const { offset, node } of a.lines) {
              node.setAttribute('x1', sx + nx * offset);
              node.setAttribute('y1', sy + ny * offset);
              node.setAttribute('x2', bx + nx * offset);
              node.setAttribute('y2', by + ny * offset);
            }
            if (p >= 1) holder = a.to;
            else if (p > 0) ballAt = [bx + BALL_OFFSET[0] - ox, by + BALL_OFFSET[1] - oy];
            continue;
          }
          a.path.setAttribute('stroke-dashoffset', a.length * (1 - eased));
          a.head.style.display = p >= 1 ? '' : 'none';
          // A move that hasn't started leaves the player where an earlier move in this step put them.
          if (p === 0) continue;
          const pt = a.path.getPointAtLength(eased * a.length);
          pos[a.player] = [pt.x, pt.y];
        }
      });

      this.steps.forEach((step, i) => step.group.classList.toggle('past', i < current));

      for (const [id, node] of Object.entries(this.playerNodes)) {
        node.setAttribute('transform', `translate(${pos[id][0]} ${pos[id][1]})`);
      }
      for (const [id, line] of Object.entries(this.guardLines)) {
        const man = pos[this.active.players[id].guards];
        line.setAttribute('x1', pos[id][0]);
        line.setAttribute('y1', pos[id][1]);
        line.setAttribute('x2', man[0]);
        line.setAttribute('y2', man[1]);
      }
      // Calls come from the latest step that sets them, or the play's starting calls.
      let calls = this.active.calls || {};
      for (let i = 0; i <= current; i++) calls = this.steps[i].calls || calls;
      for (const [id, text] of Object.entries(this.calls)) {
        text.textContent = calls[id] || '';
        this.stars[id].style.display = calls[id] === 'LOW' ? '' : 'none';
      }
      // A starting screen goes away once that player moves.
      for (const [id, bar] of Object.entries(this.startScreens)) {
        const [sx, sy] = this.startPositions[id];
        bar.style.display = pos[id][0] === sx && pos[id][1] === sy ? '' : 'none';
      }
      if (!ballAt) {
        const h = pos[holder];
        ballAt = [h[0] + BALL_OFFSET[0], h[1] + BALL_OFFSET[1]];
      }
      this.ballNode.setAttribute('cx', ballAt[0]);
      this.ballNode.setAttribute('cy', ballAt[1]);

      this.caption.textContent = current < 0 ? this.active.setup : this.steps[current].caption;
      this.scrub.value = Math.round((t / this.duration) * 1000);
      this.playBtn.textContent = this.playing ? '❚❚ Pause' : '▶︎ Play';
    }

    // Full screen uses the browser's fullscreen when available (not on iPhone), and otherwise
    // the card covers the page.
    openFull() {
      this.isFull = true;
      this.container.classList.add('fullscreen');
      document.body.style.overflow = 'hidden';
      this.setFullLabel('✕', 'Close');
      if (this.container.requestFullscreen) this.container.requestFullscreen().catch(() => {});
      this.jumpTo(0);
      this.start();
    }

    // The label text is hidden on narrow screens, leaving just the icon.
    setFullLabel(icon, label) {
      this.fullBtn.replaceChildren(icon, html('span', { class: 'label' }, ` ${label}`));
      this.fullBtn.setAttribute('aria-label', label);
    }

    closeFull() {
      this.isFull = false;
      this.container.classList.remove('fullscreen');
      document.body.style.overflow = '';
      this.setFullLabel('⛶', 'Full screen');
      if (document.fullscreenElement === this.container) document.exitFullscreen().catch(() => {});
    }

    positionInStep(step, id, stepP, pos) {
      const move = step.actions.find((m) => m.path && String(m.player) === String(id));
      if (!move) return pos[id];
      const pt = move.path.getPointAtLength(actionProgress(move, stepP).eased * move.length);
      return [pt.x, pt.y];
    }

    tick(now) {
      if (!this.playing) return;
      if (this.lastFrame !== null) this.t += now - this.lastFrame;
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
