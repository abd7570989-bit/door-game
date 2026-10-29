// Desktop wrapper for "لا تفتح الباب | DO NOT OPEN THE DOOR".
// Opens the game in its own window. The game runs entirely offline: every request
// to the internet is blocked, so nothing is downloaded and nothing is sent anywhere.
const { app, BrowserWindow, Menu, session, shell } = require("electron");
const path = require("path");

const SMOKE_TEST = process.argv.includes("--smoke-test");

if (SMOKE_TEST) {
  // CI machines have no GPU; allow software WebGL there only.
  app.commandLine.appendSwitch("enable-unsafe-swiftshader");
}
// The game starts audio and its intro video from code.
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 800,
    minHeight: 450,
    backgroundColor: "#000000",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });
  Menu.setApplicationMenu(null);

  // Stay on the game page; open any web link in the real browser instead.
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("file://")) {
      event.preventDefault();
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  // F11 toggles full screen. Esc is left to the game (it uses it for pointer lock / menus).
  win.webContents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && input.key === "F11") {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    }
  });

  win.once("ready-to-show", () => {
    if (!SMOKE_TEST) win.show();
  });
  win.loadFile(path.join(__dirname, "app", "index.html"));
  if (SMOKE_TEST) runSmokeTest(win);
}

// Used by the build pipeline: load the game, confirm it booted, then exit.
function runSmokeTest(w) {
  const errors = [];
  w.webContents.on("console-message", (details) => {
    const level = details.level !== undefined ? details.level : details;
    if (level === "error" || level === 3) errors.push(details.message || String(details));
  });
  w.webContents.on("did-finish-load", async () => {
    const deadline = Date.now() + 60000;
    let state = {};
    while (Date.now() < deadline) {
      try {
        state = await w.webContents.executeJavaScript(`({
          three: typeof THREE !== "undefined" && THREE.REVISION,
          booted: typeof BOOTED !== "undefined" && BOOTED,
          errorShown: !!document.querySelector("#errorScreen:not(.hidden)"),
          errorDetail: (document.getElementById("errC") || {}).textContent || "",
          fontsReady: document.fonts.status,
          kufi: document.fonts.check('16px "Noto Kufi Arabic"'),
          title: document.title,
        })`);
        if (state.booted || state.errorShown) break;
      } catch (e) {
        state = { exception: String(e) };
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    const ok = state.three === "128" && state.booted === true && !state.errorShown;
    const report = JSON.stringify({ ok, ...state, blockedRequests, consoleErrors: errors.slice(0, 5) });
    console.log("SMOKE " + report);
    // Windows GUI apps have no console, so the build pipeline reads the result from a file.
    if (process.env.GAME_SMOKE_OUT) require("fs").writeFileSync(process.env.GAME_SMOKE_OUT, report);
    app.exit(ok ? 0 : 1);
  });
}

let blockedRequests = 0;

app.whenReady().then(() => {
  // Offline by design: refuse every network request. Local files, data: and blob: URLs still work.
  session.defaultSession.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] },
    (details, callback) => {
      blockedRequests++;
      callback({ cancel: true });
    });
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
    callback(["pointerLock", "fullscreen"].includes(permission));
  });
  createWindow();
});

app.on("second-instance", () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.on("window-all-closed", () => app.quit());
