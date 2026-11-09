/**
 * "Stuur naar …": a bookmark that sends the page you're on (an advertisement on Huislijn, Pararius, a makelaar…)
 * to the app. It submits a form into a new tab, which works even where the site's security headers block scripts
 * from talking to other sites. The main content is sent, not the menus around it.
 */
export function bookmarklet(appUrl: string) {
  const code = `(()=>{const m=document.querySelector('main,article,[role=main]')||document.body;const f=document.createElement('form');f.method='post';f.action=${JSON.stringify(`${appUrl}/api/pagina`)};f.target='_blank';f.acceptCharset='utf-8';const a=(n,v)=>{const i=document.createElement('input');i.type='hidden';i.name=n;i.value=v||'';f.appendChild(i)};a('url',location.href);a('title',document.title);a('text',(m.innerText||document.body.innerText||'').slice(0,60000));const o=document.querySelector('meta[property="og:image"]');a('image',o&&o.content);document.body.appendChild(f);f.submit();f.remove()})()`;
  return `javascript:${encodeURIComponent(code)}`;
}
