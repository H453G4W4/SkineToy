import { esc, layout } from "./html.js";

export function generatorPage(currencies: string[], banner: string | null): string {
  const options = currencies.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  const body = `
<h1>Rewarble Checkout Link Generator</h1>
${banner ? `<div class="card"><span class="status warn">Merchant not ready</span><p class="note">${esc(banner)}</p></div>` : ""}
<form id="f" class="card" autocomplete="off">
  <label for="amount">Amount (Rewarble face value)</label>
  <input id="amount" name="amount" inputmode="decimal" placeholder="170.00" required pattern="^\\d+(\\.\\d{1,2})?$">
  <label for="currency">Currency</label>
  <select id="currency" name="currency" ${currencies.length ? "" : "disabled"}>${options || `<option>—</option>`}</select>
  <button id="go" type="submit" ${currencies.length ? "" : "disabled"}>Generate Checkout Link</button>
</form>
<section id="out" class="card" hidden aria-live="polite"></section>`;
  return layout("Rewarble Checkout Generator", body, CLIENT);
}

const CLIENT = `
const f=document.getElementById('f'),out=document.getElementById('out'),go=document.getElementById('go');
const h=(s)=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
async function run(amount,currency){
  go.disabled=true;
  try{
    const r=await fetch('/api/generate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({amount,currency})});
    render(await r.json(),currency);
  }catch(e){out.hidden=false;out.innerHTML='<span class="status err">Network error</span>';}
  finally{go.disabled=false;}
}
function render(d,currency){
  out.hidden=false;let html='';
  const cls=d.status==='READY'?'ok':(d.status==='EXACT_AMOUNT_UNAVAILABLE'||d.status==='MERCHANT_INITIALIZER_NOT_AVAILABLE'?'warn':'err');
  html+='<div class="status '+cls+'">'+h(d.status.replace(/_/g,' '))+'</div>';
  if(d.message)html+='<p class="note">'+h(d.message)+'</p>';
  html+='<dl>';
  if(d.requestedAmount)html+='<dt>Requested</dt><dd>'+h(d.requestedAmount)+' '+h(d.currency)+'</dd>';
  if(d.composition)html+='<dt>Composition</dt><dd><ul>'+d.composition.map(c=>'<li>'+h(c.faceValue)+' '+h(d.currency)+' ×'+c.quantity+'</li>').join('')+'</ul></dd>';
  if(d.merchant)html+='<dt>Merchant</dt><dd>'+h(d.merchant==='skine'?'Skine':d.merchant)+'</dd>';
  html+='</dl>';
  if(d.nearest&&d.nearest.length){html+='<p>Nearest supported totals:</p><div class="row">'+d.nearest.map(n=>'<button class="secondary" data-amt="'+h(n)+'">'+h(n)+' '+h(d.currency)+'</button>').join('')+'</div>';}
  if(d.url){html+='<dt class="note" style="margin-top:12px">Checkout link</dt><div class="link" id="u">'+h(d.url)+'</div><div class="row" style="margin-top:10px"><button id="copy">Copy Checkout Link</button><a class="btn secondary" href="'+h(d.url)+'" target="_blank" rel="noopener noreferrer">Open Checkout</a></div>';}
  if(d.note)html+='<p class="note">'+h(d.note)+'</p>';
  out.innerHTML=html;
  out.querySelectorAll('[data-amt]').forEach(b=>b.onclick=()=>{document.getElementById('amount').value=b.dataset.amt;run(b.dataset.amt,currency);});
  const c=document.getElementById('copy');if(c)c.onclick=async()=>{try{await navigator.clipboard.writeText(d.url);c.textContent='Copied';}catch{c.textContent='Copy failed';}};
}
f.onsubmit=(e)=>{e.preventDefault();run(f.amount.value,f.currency.value);};`;

export function errorPage(title: string, message: string, status: string): string {
  return layout(title, `<h1>${esc(title)}</h1><div class="card"><span class="status err">${esc(status)}</span><p>${esc(message)}</p></div>`);
}

/** Browser-native initializer: the visitor's own browser performs a top-level POST to the merchant's public form. */
export function autoPostPage(action: string, fields: [string, string][], merchantName: string): string {
  const inputs = fields.map(([n, v]) => `<input type="hidden" name="${esc(n)}" value="${esc(v)}">`).join("");
  return layout(
    "Opening checkout…",
    `<h1>Opening ${esc(merchantName)} checkout…</h1>
<form id="go" class="card" method="post" action="${esc(action)}">${inputs}
<p class="note">If nothing happens, press continue.</p><button type="submit">Continue to checkout</button></form>`,
    "document.getElementById('go').submit();",
  );
}
