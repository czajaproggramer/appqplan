/* @ds-bundle: {"format":4,"namespace":"Ruled","components":[{"name":"Paper"},{"name":"Button"},{"name":"Checkbox"},{"name":"Task"},{"name":"Input"},{"name":"Schedule"}]} */
(function () {
  var React = window.React, h = React.createElement;
  function cx() { return Array.prototype.filter.call(arguments, Boolean).join(' '); }
  function omit(o, keys) { var r = {}; for (var k in o) if (keys.indexOf(k) < 0) r[k] = o[k]; return r; }

  function Paper(p) {
    var ruled = p.ruled !== false, margin = p.margin !== false;
    return h('section', Object.assign(omit(p, ['ruled', 'margin', 'stacked', 'className', 'children']), {
      className: cx('rl-paper', ruled && 'rl-paper--ruled', margin && 'rl-paper--margin', p.stacked && 'rl-paper--stacked', p.className)
    }), p.children);
  }

  function Button(p) {
    var variant = p.variant || 'quiet';
    return h('button', Object.assign({ type: 'button' }, omit(p, ['variant', 'icon', 'className', 'children']), {
      className: cx('rl-btn', 'rl-btn--' + variant, p.icon && !p.children && 'rl-btn--icon', p.className)
    }), p.icon ? h(Icon, { name: p.icon }) : null, p.children ? h('span', null, p.children) : null);
  }

  var ICONS = {
    plus: 'M10 4.2c.1 3.9-.1 7.8.1 11.6M4.3 10.1c3.8-.2 7.6.1 11.4-.1',
    trash: 'M4.5 6.1c3.7-.2 7.3.1 11-.1M8.2 5.9c0-1.1.1-1.7.2-2.2 1.1-.1 2.2 0 3.3-.1.1.6.1 1.3.1 2.2M5.9 6.4c.3 3.2.4 6.4.8 9.6 2.3.2 4.5 0 6.7.1.3-3.2.5-6.4.7-9.6',
    settings: 'M10 3.3v2M10 14.7v2M3.3 10h2M14.7 10h2M5.3 5.3l1.4 1.4M13.3 13.3l1.4 1.4M5.3 14.7l1.4-1.4M13.3 6.7l1.4-1.4M10 7.3c1.6-.1 2.8 1.2 2.7 2.8-.1 1.5-1.3 2.6-2.8 2.6-1.5-.1-2.6-1.3-2.5-2.8.1-1.4 1.2-2.6 2.6-2.6z'
  };
  function Icon(p) {
    return h('svg', { className: 'rl-icon', viewBox: '0 0 20 20', width: 20, height: 20, 'aria-hidden': true },
      h('path', { d: ICONS[p.name] || '', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }));
  }

  var BOX = 'M3.2 2.7c4.5-.4 9.4.3 14-.2.4 4.9-.2 9.8.3 14.8-4.9.5-9.8-.2-14.7.3-.4-5 .3-9.9.4-14.9z';
  var TICK = 'M5.4 10.4c1.3 1.1 2.4 2.5 3.3 4.1 2-4 4.6-7.4 8.3-10.6';
  function Checkbox(p) {
    var inputProps = omit(p, ['label', 'className', 'checked', 'defaultChecked', 'onChange']);
    var controlled = p.checked !== undefined;
    var st = React.useState(!!p.defaultChecked), inner = st[0], setInner = st[1];
    var on = controlled ? !!p.checked : inner;
    return h('label', { className: cx('rl-check', on && 'is-checked', p.disabled && 'is-disabled', p.className) },
      h('input', Object.assign({ type: 'checkbox', className: 'rl-check__input', checked: on, onChange: function (e) {
        if (!controlled) setInner(e.target.checked); if (p.onChange) p.onChange(e.target.checked, e);
      } }, inputProps)),
      h('svg', { className: 'rl-check__box', viewBox: '0 0 20 20', width: 22, height: 22, 'aria-hidden': true },
        h('path', { className: 'rl-check__frame', d: BOX }),
        h('path', { className: 'rl-check__tick', d: TICK, pathLength: 1 })),
      p.label ? h('span', { className: 'rl-check__label' }, p.label) : null);
  }

  function Task(p) {
    return h('div', { className: cx('rl-task', p.done && 'is-done', p.className) },
      h(Checkbox, { checked: !!p.done, onChange: p.onToggle, 'aria-label': typeof p.children === 'string' ? p.children : 'Done' }),
      h('span', { className: 'rl-task__text' }, p.children),
      p.meta ? h('span', { className: 'rl-task__meta' }, p.meta) : null,
      p.onDelete ? h(Button, { variant: 'ghost', icon: 'trash', 'aria-label': 'Delete task', className: 'rl-task__del', onClick: p.onDelete }) : null);
  }

  function Input(p) {
    return h('input', Object.assign({ type: 'text' }, omit(p, ['className']), { className: cx('rl-input', p.className) }));
  }

  function toMin(t) { if (typeof t === 'number') return t * 60; var a = String(t).split(':'); return (+a[0]) * 60 + (+(a[1] || 0)); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fmt(m) { return pad(Math.floor(m / 60)) + ':' + pad(m % 60); }
  function Schedule(p) {
    var start = p.start == null ? 8 : p.start, end = p.end == null ? 18 : p.end, span = (end - start) * 60, rows = [];
    for (var hr = start; hr < end; hr++) rows.push(h('div', { key: hr, className: 'rl-sched__hour' }, h('span', { className: 'rl-sched__label' }, pad(hr) + ':00')));
    var pct = function (m) { return ((m - start * 60) / span * 100) + '%'; };
    var events = (p.events || []).map(function (e, i) {
      var s = toMin(e.start), f = toMin(e.end), short = f - s <= 30;
      return h('div', { key: i, className: cx('rl-event', 'rl-event--' + (e.tone || 'yellow'), short && 'rl-event--short'), style: { top: pct(s), height: 'calc(' + ((f - s) / span * 100) + '% - 3px)' } },
        h('span', { className: 'rl-event__title' }, e.title),
        h('span', { className: 'rl-event__time' }, fmt(s) + ' – ' + fmt(f)));
    });
    var now = p.now != null ? toMin(p.now) : null;
    return h('div', { className: cx('rl-sched', p.className), style: { '--rl-hours': end - start } },
      rows,
      h('div', { className: 'rl-sched__lane' }, events,
        now != null && now >= start * 60 && now <= end * 60 ? h('div', { className: 'rl-sched__now', style: { top: pct(now) } }, h('span', null, fmt(now))) : null));
  }

  window.Ruled = Object.assign(window.Ruled || {}, { Paper: Paper, Button: Button, Checkbox: Checkbox, Task: Task, Input: Input, Schedule: Schedule, Icon: Icon });
})();
