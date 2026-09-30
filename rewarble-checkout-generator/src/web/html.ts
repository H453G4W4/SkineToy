export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const STYLE = `
:root{--bg:#f7f7f8;--fg:#18181b;--muted:#63636b;--card:#fff;--line:#e4e4e7;--accent:#2f5bea;--ok:#157f3b;--warn:#a15c00;--err:#b42318}
@media (prefers-color-scheme:dark){:root{--bg:#111113;--fg:#ededef;--muted:#a1a1aa;--card:#1b1b1f;--line:#2e2e33;--accent:#7c9cff;--ok:#4ade80;--warn:#fbbf24;--err:#f87171}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:480px;margin:0 auto;padding:32px 16px}h1{font-size:1.35rem;margin:0 0 20px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px;margin-bottom:16px}
label{display:block;font-weight:600;font-size:.9rem;margin:0 0 6px}
input,select{width:100%;font:inherit;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg);margin-bottom:14px}
button,.btn{display:inline-block;font:inherit;font-weight:600;padding:10px 14px;border-radius:8px;border:1px solid var(--accent);background:var(--accent);color:#fff;cursor:pointer;text-decoration:none;text-align:center}
.btn.secondary,button.secondary{background:transparent;color:var(--accent)}
button:disabled{opacity:.5;cursor:not-allowed}.row{display:flex;gap:8px;flex-wrap:wrap}.row>*{flex:1 1 140px}
dl{margin:0}dt{color:var(--muted);font-size:.85rem;margin-top:10px}dd{margin:2px 0 0}
.link{word-break:break-all;font-family:ui-monospace,monospace;font-size:.85rem;background:var(--bg);padding:8px;border-radius:6px;border:1px solid var(--line)}
.note{color:var(--muted);font-size:.85rem}.status{font-weight:700}.ok{color:var(--ok)}.warn{color:var(--warn)}.err{color:var(--err)}
ul{margin:4px 0 0;padding-left:20px}`;

export function layout(title: string, body: string, script = ""): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><title>${esc(title)}</title><style>${STYLE}</style></head>
<body><main>${body}</main>${script ? `<script>${script}</script>` : ""}</body></html>`;
}
