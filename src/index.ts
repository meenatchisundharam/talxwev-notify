// src/index.ts
type ToastType = "info" | "success" | "error" | "warning";
type Position =
  | "top-right"
  | "top-left"
  | "bottom-right"
  | "bottom-left"
  | "top-center"
  | "bottom-center";

export interface NotifyOptions {
  id?: string;
  title?: string;
  message?: string;
  type?: ToastType;
  duration?: number; // ms, 0 = sticky
  closable?: boolean;
  pauseOnHover?: boolean;
  position?: Position;
  containerClass?: string;
  toastClass?: string;
  injectStyles?: boolean; // default true
  onClose?: () => void;
  render?: (opts: Required<Pick<NotifyOptions, "id" | "title" | "message" | "type">>) => HTMLElement | string;
}

interface InternalToast {
  id: string;
  el: HTMLElement;
  timeoutId?: number;
  opts: Required<NotifyOptions>;
}

const DEFAULTS: Required<NotifyOptions> = {
  id: "",
  title: "",
  message: "",
  type: "info",
  duration: 4000,
  closable: true,
  pauseOnHover: true,
  position: "top-right",
  containerClass: "",
  toastClass: "",
  injectStyles: true,
  onClose: () => {},
  render: null as any
};

const TOASTS = new Map<string, InternalToast>();
const CONTAINERS = new Map<string, HTMLElement>();
let globalConfig: Partial<NotifyOptions> = {};

const STYLE_ID = "talxwev-notify-styles";

const DEFAULT_CSS = `:root{
  --talx-bg-info:#3182ce;
  --talx-bg-success:#16a34a;
  --talx-bg-error:#dc2626;
  --talx-bg-warning:#d97706;
  --talx-text:#ffffff;
  --talx-radius:8px;
  --talx-gap:8px;
}
.talx-container{
  position: fixed;
  z-index: 999999;
  pointer-events: none;
  display:flex;
  flex-direction:column;
  gap:var(--talx-gap);
  max-width:calc(100% - 2rem);
}
.talx-container--top-right{top:1rem; right:1rem; align-items:flex-end;}
.talx-container--top-left{top:1rem; left:1rem; align-items:flex-start;}
.talx-container--bottom-right{bottom:1rem; right:1rem; align-items:flex-end;}
.talx-container--bottom-left{bottom:1rem; left:1rem; align-items:flex-start;}
.talx-container--top-center{top:1rem; left:50%; transform:translateX(-50%); align-items:center;}
.talx-container--bottom-center{bottom:1rem; left:50%; transform:translateX(-50%); align-items:center;}

.talx-toast{
  pointer-events:auto; /* keep this, but we also force inline as a fallback */
  min-width:200px;
  max-width:420px;
  background:var(--talx-bg-info);
  color:var(--talx-text);
  padding:12px 14px;
  border-radius:var(--talx-radius);
  box-shadow:0 8px 24px rgba(0,0,0,0.12);
  transform-origin:right top;
  transition:transform .18s cubic-bezier(.2,.9,.2,1), opacity .18s ease;
  opacity:1;
  display:flex;
  gap:12px;
  align-items:flex-start;
  font-family:system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial;
}
.talx-toast--hide{opacity:0; transform:translateY(-10px) scale(.99);}
.talx-toast--success{background:var(--talx-bg-success);}
.talx-toast--error{background:var(--talx-bg-error);}
.talx-toast--warning{background:var(--talx-bg-warning);}
.talx-content{flex:1 1 auto;}
.talx-title{font-weight:700; margin-bottom:4px; font-size:14px;}
.talx-message{font-size:13px; line-height:1.2;}
.talx-close{border:0; background:transparent; color:inherit; cursor:pointer; font-size:16px; padding:4px; line-height:1; opacity:0.9;}
.talx-close:focus{outline:2px solid rgba(255,255,255,0.2);}
`;

// helpers
function isBrowser() {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function injectDefaultStyles() {
  if (!isBrowser()) return;
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = DEFAULT_CSS;
  document.head.appendChild(s);
}

function containerFor(position: Position, containerClass = ""): HTMLElement | null {
  if (!isBrowser()) return null;
  const key = position + (containerClass ? `|${containerClass}` : "");
  let c = CONTAINERS.get(key);
  if (c) return c;
  c = document.createElement("div");
  c.className = `talx-container talx-container--${position}` + (containerClass ? ` ${containerClass}` : "");
  // ensure the container does not block clicks except on toasts
  c.style.pointerEvents = "none";
  document.body.appendChild(c);
  CONTAINERS.set(key, c);
  return c;
}

function makeId() {
  return "t_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

function buildToastElement(id: string, opts: Required<NotifyOptions>): HTMLElement {
  const toast = document.createElement("div");
  toast.className = `talx-toast talx-toast--${opts.type}` + (opts.toastClass ? ` ${opts.toastClass}` : "");
  toast.setAttribute("data-tid", id);
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");

  // Force clickable area inline so missing/overridden CSS won't break clicks
  toast.style.pointerEvents = "auto";

  let contentEl: HTMLElement;
  if (opts.render) {
    const out = opts.render({ id, title: opts.title, message: opts.message, type: opts.type });
    if (typeof out === "string") {
      contentEl = document.createElement("div");
      contentEl.className = "talx-content";
      contentEl.innerHTML = out;
    } else {
      contentEl = out;
    }
  } else {
    contentEl = document.createElement("div");
    contentEl.className = "talx-content";
    if (opts.title) {
      const t = document.createElement("div");
      t.className = "talx-title";
      t.textContent = opts.title;
      contentEl.appendChild(t);
    }
    if (opts.message) {
      const m = document.createElement("div");
      m.className = "talx-message";
      m.textContent = opts.message;
      contentEl.appendChild(m);
    }
  }

  toast.appendChild(contentEl);

  if (opts.closable) {
    const btn = document.createElement("button");
    btn.className = "talx-close";
    btn.setAttribute("aria-label", "Close notification");
    btn.innerHTML = "✕";

    // Also force the button to be clickable inline
    btn.style.pointerEvents = "auto";

    btn.addEventListener("click", () => dismiss(id));
    toast.appendChild(btn);
  }

  return toast;
}

function setAutoDismiss(internal: InternalToast) {
  if (internal.opts.duration === 0) return;
  clearTimeout(internal.timeoutId);
  internal.timeoutId = window.setTimeout(() => dismiss(internal.id), internal.opts.duration);
}

export function notify(messageOrOpts: string | NotifyOptions, maybeOpts?: NotifyOptions): string | null {
  if (!isBrowser()) {
    return null;
  }
  const optsBase = typeof messageOrOpts === "string" ? { message: messageOrOpts, ...(maybeOpts || {}) } : messageOrOpts;
  const opts: Required<NotifyOptions> = Object.assign({}, DEFAULTS, globalConfig, optsBase) as any;
  if (!opts.id) opts.id = makeId();

  if (opts.injectStyles) injectDefaultStyles();

  const container = containerFor(opts.position, opts.containerClass);
  if (!container) return null;

  const el = buildToastElement(opts.id, opts);
  const internal: InternalToast = { id: opts.id, el, opts };
  TOASTS.set(opts.id, internal);
  container.appendChild(el);

  // small tick so transitions can apply
  requestAnimationFrame(() => {
    el.classList.remove("talx-toast--hide");
  });

  if (opts.pauseOnHover) {
    let remaining = opts.duration;
    let start = Date.now();
    el.addEventListener("mouseenter", () => {
      if (internal.timeoutId) {
        clearTimeout(internal.timeoutId);
        remaining = Math.max(0, remaining - (Date.now() - start));
      }
    });
    el.addEventListener("mouseleave", () => {
      if (remaining > 0) {
        start = Date.now();
        internal.timeoutId = window.setTimeout(() => dismiss(opts.id), remaining);
      }
    });
  }

  setAutoDismiss(internal);
  return opts.id;
}

export function success(msgOrOpts: string | NotifyOptions, maybe?: NotifyOptions) {
  const base = typeof msgOrOpts === "string" ? { message: msgOrOpts, ...(maybe || {}) } : msgOrOpts;
  return notify({ ...(base as NotifyOptions), type: "success" });
}

export function error(msgOrOpts: string | NotifyOptions, maybe?: NotifyOptions) {
  const base = typeof msgOrOpts === "string" ? { message: msgOrOpts, ...(maybe || {}) } : msgOrOpts;
  return notify({ ...(base as NotifyOptions), type: "error" });
}

export function info(msgOrOpts: string | NotifyOptions, maybe?: NotifyOptions) {
  const base = typeof msgOrOpts === "string" ? { message: msgOrOpts, ...(maybe || {}) } : msgOrOpts;
  return notify({ ...(base as NotifyOptions), type: "info" });
}

export function warning(msgOrOpts: string | NotifyOptions, maybe?: NotifyOptions) {
  const base = typeof msgOrOpts === "string" ? { message: msgOrOpts, ...(maybe || {}) } : msgOrOpts;
  return notify({ ...(base as NotifyOptions), type: "warning" });
}

export function dismiss(id: string) {
  if (!isBrowser()) return;
  const internal = TOASTS.get(id);
  if (!internal) return;
  const el = internal.el;
  el.classList.add("talx-toast--hide");
  if (internal.timeoutId) clearTimeout(internal.timeoutId);
  setTimeout(() => {
    const parent = el.parentElement;
    try { parent && parent.removeChild(el); } catch {}
    TOASTS.delete(id);
    internal.opts.onClose && internal.opts.onClose();
  }, 220);
}

export function clear() {
  if (!isBrowser()) return;
  Array.from(TOASTS.keys()).forEach((id) => dismiss(id));
}

export function configure(options: Partial<NotifyOptions>) {
  globalConfig = Object.assign({}, globalConfig, options);
}

const API = {
  notify,
  success,
  error,
  info,
  warning,
  dismiss,
  clear,
  configure
};

export default API;
