// Line icons drawn on a 24-unit grid; `svg.i` in the stylesheet sets the stroke.
const icon = (body, extra = "") => `<svg class="i ${extra}" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;

const bodies = {
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  warning: '<path d="M12 4.5l8.5 15h-17z"/><path d="M12 10.5v4M12 17.4v.1"/>',
  checkCircle: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.3l2.4 2.4 4.6-5"/>',
};

export const icons = Object.fromEntries(Object.entries(bodies).map(([name, body]) => [name, (extra = "") => icon(body, extra)]));
