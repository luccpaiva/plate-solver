// One chart form, used twice: lines on two logarithmic axes, where a power law
// is a straight line and its exponent is the slope. Plain SVG; hovering reads
// the nearest sample of every series.

const svg = (width, height, body) => `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img">${body}</svg>`;

// 1, 2 and 5 in each decade, thinned to the decades when that is too many.
function ticks(low, high) {
  const out = [];
  for (let power = Math.floor(Math.log10(low)); power <= Math.ceil(Math.log10(high)); power++) {
    for (const step of [1, 2, 5]) {
      const value = step * 10 ** power;
      if (value >= low * 0.999 && value <= high * 1.001) out.push(value);
    }
  }
  const decades = out.filter((value) => Math.abs(Math.log10(value) - Math.round(Math.log10(value))) < 1e-9);
  return out.length > 7 && decades.length > 1 ? decades : out;
}

// series: [{ name, colour, points: [[x, y]] }]; `guide` is a faint line of a
// given slope from one point, named a third of the way along. An axis may
// name its own ticks.
export function logChart(host, { width, height, x, y, series, guide, empty }) {
  const pad = { left: 58, right: 96, top: 28, bottom: 40 };
  const points = series.flatMap((one) => one.points);
  if (!points.length) {
    host.innerHTML = `<div class="pl-chart-empty">${empty}</div>`;
    return;
  }
  const bounds = (pick, floor) => {
    const values = points.map(pick).filter((value) => value > 0);
    return [Math.min(...values) / floor, Math.max(...values) * floor];
  };
  const [x0, x1] = x.range ?? bounds((point) => point[0], 1.12), [y0, y1] = y.range ?? bounds((point) => point[1], 1.5);
  const sx = (value) => pad.left + (Math.log(value / x0) / Math.log(x1 / x0)) * (width - pad.left - pad.right);
  const sy = (value) => height - pad.bottom - (Math.log(Math.max(value, y0) / y0) / Math.log(y1 / y0)) * (height - pad.top - pad.bottom);
  const path = (list) => list.map(([px, py], index) => `${index ? "L" : "M"}${sx(px).toFixed(1)} ${sy(py).toFixed(1)}`).join("");

  const grid = (y.ticks ?? ticks(y0, y1)).map((value) => `
    <path class="grid" d="M${pad.left} ${sy(value).toFixed(1)}H${width - pad.right}"/>
    <text class="tick" x="${pad.left - 8}" y="${(sy(value) + 4).toFixed(1)}" text-anchor="end">${y.format(value)}</text>`).join("")
    + (x.ticks ?? ticks(x0, x1)).map((value) => `
    <path class="grid" d="M${sx(value).toFixed(1)} ${pad.top}V${height - pad.bottom}"/>
    <text class="tick" x="${sx(value).toFixed(1)}" y="${height - pad.bottom + 16}" text-anchor="middle">${x.format(value)}</text>`).join("");

  let guideLine = "";
  if (guide) {
    const [gx, gy] = guide.from, along = (at) => gy * (at / gx) ** guide.slope, third = gx * (guide.to / gx) ** 0.3;
    // the name sits on the open side of the line: above a falling one, below a rising one
    guideLine = `<path class="guide" d="${path([[gx, gy], [guide.to, along(guide.to)]])}"/>
      <text class="guide-label" x="${(sx(third) + 8).toFixed(1)}" y="${(sy(along(third)) + (guide.slope < 0 ? -7 : 16)).toFixed(1)}">${guide.label}</text>`;
  }

  // Each line is named where it ends. Names that would touch are moved apart.
  const ends = series.filter((one) => one.points.length).map((one) => ({ one, at: sy(one.points.at(-1)[1]) })).sort((a, b) => a.at - b.at);
  for (let i = 1; i < ends.length; i++) if (ends[i].at - ends[i - 1].at < 15) ends[i].at = ends[i - 1].at + 15;
  const lines = series.map((one) => `
    <path class="line" d="${path(one.points)}" stroke="${one.colour}"/>
    ${one.points.map(([px, py]) => `<circle class="dot" cx="${sx(px).toFixed(1)}" cy="${sy(py).toFixed(1)}" r="4" fill="${one.colour}"/>`).join("")}`).join("");
  const names = ends.map(({ one, at }) => `<text class="end" x="${(sx(one.points.at(-1)[0]) + 10).toFixed(1)}" y="${(at + 4).toFixed(1)}">${one.name}</text>`).join("");

  // two or more series get a key as well; one is named by the chart's own title
  const key = series.length > 1 ? series.map((one, index) => `
    <circle cx="${pad.left + 150 + index * 112}" cy="8" r="4" fill="${one.colour}"/><text class="tick" x="${pad.left + 159 + index * 112}" y="12">${one.name}</text>`).join("") : "";

  host.innerHTML = svg(width, height, `
    ${grid}${key}
    <text class="axis" x="${(pad.left + width - pad.right) / 2}" y="${height - 4}" text-anchor="middle">${x.label}</text>
    <text class="axis" x="${pad.left - 44}" y="12">${y.label}</text>
    ${guideLine}${lines}${names}
    <path class="cursor" d="M0 ${pad.top}V${height - pad.bottom}" visibility="hidden"/>`)
    + '<div class="pl-chart-tip" hidden></div>';

  // hover: the sample nearest in x, for every series at once
  const picture = host.querySelector("svg"), cursor = host.querySelector(".cursor"), tip = host.querySelector(".pl-chart-tip");
  const samples = [...new Set(points.map((point) => point[0]))].sort((a, b) => a - b);
  picture.addEventListener("pointermove", (event) => {
    const frame = picture.getBoundingClientRect(), at = ((event.clientX - frame.left) / frame.width) * width;
    const near = samples.reduce((best, value) => (Math.abs(sx(value) - at) < Math.abs(sx(best) - at) ? value : best));
    cursor.setAttribute("transform", `translate(${sx(near).toFixed(1)} 0)`);
    cursor.setAttribute("visibility", "visible");
    tip.hidden = false;
    tip.innerHTML = `<b>${x.detail(near)}</b>` + series.map((one) => {
      const hit = one.points.find((point) => point[0] === near);
      return hit ? `<span><i style="background: ${one.colour}"></i>${one.name}<em>${y.detail(hit[1])}</em></span>` : "";
    }).join("");
    tip.style.left = `${Math.min(width - 170, sx(near) + 12)}px`;
    tip.style.top = `${pad.top + 4}px`;
  });
  picture.addEventListener("pointerleave", () => {
    cursor.setAttribute("visibility", "hidden");
    tip.hidden = true;
  });
}
