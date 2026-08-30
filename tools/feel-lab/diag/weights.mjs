/** Distribution des poids de skinning : quel os domine chaque sommet ?
 *  Si un seul os (Hips/Root) domine tout, le maillage est rigide malgre un squelette correct. */
import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
await page.goto('http://127.0.0.1:5273/?lowfx', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => { const l=document.getElementById('loading'); return l && getComputedStyle(l).display==='none'; }, { timeout: 180000 });
await page.waitForTimeout(1200);
const res = await page.evaluate(() => {
  const a = window.__probeLobbyAvatar?.(); if (!a?.model) return { err: 'pas de modele' };
  let out = null;
  a.model.traverse((o) => {
    if (!o.isSkinnedMesh || out || o.userData.isOutline) return;
    const g = o.geometry, idx = g.attributes.skinIndex, w = g.attributes.skinWeight;
    if (!idx || !w) return void (out = { err: 'PAS D ATTRIBUT skinIndex/skinWeight' });
    const names = o.skeleton.bones.map((b) => b.name);
    const dom = new Map(); let zeroW = 0;
    for (let i = 0; i < idx.count; i++) {
      let best = -1, bw = 0, sum = 0;
      for (const c of ['x','y','z','w']) { const ww = w[`get${c.toUpperCase()}`](i); sum += ww; if (ww > bw) { bw = ww; best = idx[`get${c.toUpperCase()}`](i); } }
      if (sum < 0.001) { zeroW++; continue; }
      const n = names[best] ?? `#${best}`;
      dom.set(n, (dom.get(n) ?? 0) + 1);
    }
    const top = [...dom.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8)
      .map(([n, c]) => `${n}: ${(100 * c / idx.count).toFixed(1)}%`);
    out = { mesh: o.name, sommets: idx.count, sansPoids: zeroW, osDistincts: dom.size, top };
  });
  return out ?? { err: 'aucun SkinnedMesh' };
});
await browser.close();
console.log(JSON.stringify(res, null, 2));
