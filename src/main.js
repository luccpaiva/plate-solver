// Entry: starts the solver's worker and builds the workspace around it.
import "./styles.css";
import { createApp } from "./app.js";

// The worker behind one call: ask with a kind and a payload, get the answer.
const worker = new Worker(new URL("./solver.worker.js", import.meta.url), { type: "module" });
const waiting = new Map();
let sent = 0;
worker.onmessage = ({ data: { id, result, error } }) => {
  const { resolve, reject } = waiting.get(id);
  waiting.delete(id);
  if (error) reject(new Error(error));
  else resolve(result);
};
const solve = (type, payload) => new Promise((resolve, reject) => {
  waiting.set(++sent, { resolve, reject });
  worker.postMessage({ id: sent, type, payload });
});

const app = createApp(document.getElementById("shell"), solve);

// the view is drawn at the size it really has
new ResizeObserver(() => app.resize(1)).observe(document.getElementById("view"));
