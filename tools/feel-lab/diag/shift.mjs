import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.addInitScript(() => localStorage.setItem('tumble-model', 'char-tycoon'));
await page.goto('http://127.0.0.1:5273/?lowfx&nointro', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => { const l=document.getElementById('loading'); return l && getComputedStyle(l).display==='none'; }, { timeout: 180000 });
await page.waitForTimeout(1200);
await page.click('#btn-perso');
await page.waitForTimeout(700);
for (const [sx, sy] of [[2.4, 0], [3.0, -0.25], [3.4, -0.35]]) {
  await page.evaluate(([x, y]) => {
    const g = window.__probeGame?.(); if (!g) return;
    g.view.camera.position.set(g.lobby.cameraPos.x + x, g.lobby.cameraPos.y + y, g.lobby.cameraPos.z);
    g.view.camera.lookAt(g.lobby.cameraLook.x + x, g.lobby.cameraLook.y + y, g.lobby.cameraLook.z);
  }, [sx, sy]);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `shots/shift-${sx}.png` });
}
await browser.close();
console.log('captures shift');
