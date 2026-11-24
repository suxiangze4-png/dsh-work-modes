import { browserPreference } from './ui-preferences.js'

const themeKey = 'work-modes-theme'
export const themeLabels = { system: '跟随 DSH', light: '浅色', dark: '深色' }

export function createThemePreference() {
  const saved = browserPreference(themeKey)
  let current = saved === 'light' || saved === 'dark' ? saved : 'system'
  const listeners = new Set()
  return {
    get: () => current,
    set(value) {
      current = value
      browserPreference(themeKey, value)
      for (const listener of listeners) listener()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

export const uiCss = `
.wm-ui {
  --wm-bg: var(--ds-bg-container, Canvas);
  --wm-text: var(--dsw-alias-label-primary, CanvasText);
  --wm-muted: color-mix(in srgb, var(--wm-text) 73%, var(--wm-bg));
  --wm-line: color-mix(in srgb, var(--wm-text) 16%, var(--wm-bg));
  --wm-control-line: color-mix(in srgb, var(--wm-text) 36%, var(--wm-bg));
  --wm-soft: color-mix(in srgb, var(--wm-text) 4%, var(--wm-bg));
  --wm-blue: #2455c7;
  --wm-blue-end: #16418f;
  --wm-focus: #3664d9;
  --wm-danger: #a52824;
  --wm-tint: color-mix(in srgb, var(--wm-focus) 10%, var(--wm-bg));
  --wm-hover: linear-gradient(115deg, var(--wm-tint), var(--wm-bg));
  color: var(--wm-text);
}
.wm-ui[data-wm-theme="light"] {
  color-scheme: light;
  --wm-bg: #fff;
  --wm-text: #1e2430;
}
.wm-ui[data-wm-theme="dark"] {
  --wm-bg: #1b1e24;
  --wm-text: #edf0f5;
}
.wm-ui[data-wm-theme="dark"],
body[data-ds-dark-theme] .wm-ui[data-wm-theme="system"] {
  color-scheme: dark;
  --wm-focus: #9bb9ff;
  --wm-danger: #ffaaa5;
}

.wm-ui :focus-visible { outline: 2px solid var(--wm-focus); outline-offset: 2px; }
.wm-ui :where(button, select, input:not([type="checkbox"]), textarea) {
  max-width: 100%;
  min-width: 0;
  font: inherit;
  color: inherit;
  background: var(--wm-bg);
  border: 1px solid var(--wm-control-line);
  border-radius: 7px;
}
.wm-ui button, .wm-ui select { min-height: 36px; padding: 6px 10px; }
.wm-ui button { cursor: pointer; }
.wm-ui button:disabled, .wm-ui select:disabled { opacity: .55; cursor: default; }
.wm-ui button:not(:disabled):hover {
  background-image: var(--wm-hover);
  border-color: var(--wm-focus);
}
.wm-ui button.primary {
  background: var(--wm-blue);
  border-color: var(--wm-blue);
  color: #fff;
}
.wm-ui button.primary:not(:disabled):hover {
  background-image: linear-gradient(115deg, var(--wm-blue), var(--wm-blue-end));
}
.wm-ui input::placeholder, .wm-ui textarea::placeholder { color: var(--wm-muted); opacity: 1; }

@supports (appearance: base-select) and selector(::picker(select)) {
  .wm-ui select, .wm-ui select::picker(select) { appearance: base-select; }
  .wm-ui select::picker(select) {
    max-width: min(440px, calc(100vw - 24px));
    margin-top: 4px;
    padding: 4px;
    color: var(--wm-text);
    background: var(--wm-bg);
    border: 1px solid var(--wm-control-line);
    border-radius: 8px;
    box-shadow: 0 6px 18px rgb(0 0 0 / .16);
    opacity: 0;
    translate: 0 -5px;
    transition: opacity 150ms ease, translate 150ms ease, display 150ms allow-discrete, overlay 150ms allow-discrete;
  }
  .wm-ui select:open::picker(select) { opacity: 1; translate: 0 0; }
  @starting-style {
    .wm-ui select:open::picker(select) { opacity: 0; translate: 0 -5px; }
  }
  .wm-ui select::picker-icon { color: var(--wm-muted); transition: rotate 150ms ease; }
  .wm-ui select:open::picker-icon { rotate: 180deg; }
  .wm-ui select option { padding: 7px 9px; border-radius: 4px; overflow-wrap: anywhere; }
  .wm-ui select option:checked, .wm-ui select option:hover { background: var(--wm-tint); }
}

@media (prefers-reduced-motion: reduce) {
  .wm-ui .wm-switch::before { transition: none; }
  .wm-ui select::picker(select), .wm-ui select::picker-icon { transition: none; }
}
`
