import '@fontsource/chakra-petch/latin-500.css';
import '@fontsource/chakra-petch/latin-600.css';
import '@fontsource/chakra-petch/latin-700.css';
import '@fontsource/chakra-petch/latin-700-italic.css';
import '@fontsource/chakra-petch/thai-500.css';
import '@fontsource/chakra-petch/thai-600.css';
import '@fontsource/chakra-petch/thai-700.css';
import '@fontsource/chakra-petch/thai-700-italic.css';
import './ui/styles.css';
import { App } from './game/app';
import { installDebug } from './game/debug';
import { OnlineMode, serverUrl } from './game/online';

function boot(): void {
  try {
    const app = new App();
    installDebug(app);
    // Online play appears only when a match server is configured.
    const url = serverUrl();
    if (url) {
      const online = new OnlineMode(app, url);
      app.online = { available: true, open: () => online.open() };
    }
    app.start();
  } catch (err) {
    // Last resort: say something readable instead of a blank page.
    console.error(err);
    const el = document.getElementById('screen');
    if (el) {
      el.hidden = false;
      el.innerHTML =
        '<div class="screen__inner screen__inner--narrow"><h1 class="h1">LAST ROUND</h1><p class="lede">เกิดข้อผิดพลาดระหว่างเริ่มเกม กรุณาโหลดหน้านี้ใหม่ — The game failed to start. Please reload.</p></div>';
    }
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
