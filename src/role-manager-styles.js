export const libraryCss = `
.wm-library {
  box-sizing: border-box;
  height: 100%;
  min-width: 0;
  overflow: auto;
  padding: 20px clamp(12px, 3%, 24px);
  background: var(--wm-bg);
  font: inherit;
  font-size: 13px;
  line-height: 1.5;
  container-type: inline-size;
}
.wm-library *, .wm-library *::before { box-sizing: border-box; }
.wm-library header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 12px 18px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--wm-line);
}
.wm-library h1, .wm-library h2 { margin: 0; overflow-wrap: anywhere; }
.wm-library h1 { font-size: 22px; }
.wm-library h2 { font-size: 16px; }
.wm-library p { margin: 6px 0; }
.wm-library .toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.wm-library .wm-subtext, .wm-library small { color: var(--wm-muted); font-size: 12px; font-weight: 400; }
.wm-library a { color: var(--wm-focus); }
.wm-library :where(input:not([type="checkbox"]), textarea) { min-height: 36px; padding: 6px 10px; }
.wm-library .layout {
  display: grid;
  grid-template-columns: minmax(205px, 245px) minmax(0, 1fr);
  gap: 20px;
  padding-top: 16px;
}
.wm-library aside { min-width: 0; border-right: 1px solid var(--wm-line); padding-right: 16px; }
.wm-library .wm-filters { display: grid; gap: 8px; margin: 10px 0 12px; }
.wm-library .wm-filter-row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
.wm-library .wm-filters input[type="search"], .wm-library .wm-filter-row select { width: 100%; }
.wm-library .wm-switch-label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  cursor: pointer;
}
.wm-library .wm-switch {
  appearance: none;
  display: inline-flex;
  align-items: center;
  flex: none;
  width: 32px;
  height: 19px;
  margin: 0;
  padding: 2px;
  border: 1px solid var(--wm-control-line);
  border-radius: 10px;
  background: var(--wm-soft);
  cursor: inherit;
}
.wm-library .wm-switch::before {
  content: "";
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: var(--wm-muted);
  transition: translate 150ms ease;
}
.wm-library .wm-switch:checked { background: var(--wm-blue); border-color: var(--wm-blue); }
.wm-library .wm-switch:checked::before { background: #fff; translate: 13px 0; }
.wm-library .wm-switch:disabled { opacity: .55; cursor: default; }
.wm-library .wm-mode { margin: 12px 0; padding: 4px 10px 8px; border: 1px solid var(--wm-line); border-radius: 7px; }
.wm-library .wm-mode .wm-switch-label { font-weight: 600; }
.wm-library .wm-mode p { margin: 0; }
.wm-library .wm-role-list { list-style: none; padding: 2px; margin: 0; }
.wm-library .wm-role-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: start; gap: 2px; }
.wm-library .role-item {
  display: grid;
  gap: 2px;
  width: 100%;
  margin-bottom: 4px;
  padding: 7px 9px;
  text-align: start;
  border-color: transparent;
  overflow-wrap: anywhere;
}
.wm-library .role-item[aria-pressed="true"] {
  background-color: var(--wm-tint);
  border-color: var(--wm-focus);
}
.wm-library .wm-role-detail { display: flex; align-items: baseline; flex-wrap: wrap; gap: 2px 8px; }
.wm-library .wm-role-description { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
.wm-library small.wm-pin { color: var(--wm-focus); }
.wm-library .wm-role-more { width: 30px; min-height: 30px; padding: 0; border-color: transparent; font-size: 17px; }
.wm-library .wm-role-menu {
  position: fixed;
  inset: auto;
  margin: 0;
  min-width: 140px;
  max-width: calc(100vw - 16px);
  padding: 4px;
  border: 1px solid var(--wm-control-line);
  border-radius: 8px;
  background: var(--wm-bg);
  color: var(--wm-text);
  box-shadow: 0 6px 18px rgb(0 0 0 / .16);
}
.wm-library .wm-role-menu:popover-open { display: grid; }
.wm-library .wm-role-menu button { min-height: 32px; border-color: transparent; text-align: start; }
.wm-library .editor { min-width: 0; }
.wm-library .meta { display: flex; flex-wrap: wrap; gap: 6px 12px; margin-top: 6px; }
.wm-library .fields { display: grid; gap: 12px; margin: 12px 0; }
.wm-library .fields label, .wm-library .wm-field { display: grid; gap: 4px; min-width: 0; font-weight: 600; }
.wm-library .fields :where(input, textarea, select), .wm-library .wm-field :where(input, textarea, select) { font-weight: 400; }
.wm-library .wm-field p { margin: 0; }
.wm-library .wm-field-help { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 12px; }
.wm-library .wm-field-help .at-limit { color: var(--wm-danger); font-weight: 600; }
.wm-library textarea {
  resize: vertical;
  width: 100%;
  min-height: clamp(190px, 36dvh, 360px);
  padding: 9px 11px;
  font-family: ui-monospace, Consolas, monospace;
  font-size: 13px;
  line-height: 1.65;
  tab-size: 2;
}
.wm-library .wm-actions { justify-content: space-between; padding-top: 12px; border-top: 1px solid var(--wm-line); }
.wm-library .wm-danger { color: var(--wm-danger); }
.wm-library .notice {
  margin: 8px 0;
  padding: 8px 10px;
  border-inline-start: 3px solid var(--wm-focus);
  background: var(--wm-tint);
  overflow-wrap: anywhere;
}
.wm-library .notice.error { border-color: var(--wm-danger); }
.wm-library details { font-size: 12px; margin-top: 12px; }
.wm-library summary { cursor: pointer; }
.wm-library .storage { overflow-wrap: anywhere; }
.wm-library .wm-import-input { display: none; }
.wm-library .prompt {
  position: fixed;
  width: min(470px, 90vw);
  max-width: 90vw;
  margin: auto;
  padding: 18px;
  border: 1px solid var(--wm-control-line);
  border-radius: 9px;
  background: var(--wm-bg);
  color: var(--wm-text);
}
.wm-library .prompt p { margin: 0 0 14px; }
.wm-library .prompt::backdrop { background: rgb(0 0 0 / .45); }
.wm-library .empty { padding: 12px 2px; color: var(--wm-muted); }
@container (max-width: 680px) {
  .wm-library .layout { grid-template-columns: minmax(0, 1fr); gap: 14px; }
  .wm-library aside { padding: 0 0 12px; border-right: 0; border-bottom: 1px solid var(--wm-line); }
  .wm-library .wm-role-list { max-height: clamp(100px, 25dvh, 205px); overflow: auto; }
}
@media (forced-colors: active) {
  .wm-library .wm-switch:checked { border-color: Highlight; }
  .wm-library .wm-switch::before { background: ButtonText; }
}
`
