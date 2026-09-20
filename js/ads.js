// Publicité Google AdMob — uniquement dans l'appli Android (Capacitor).
// Sur le site web (navigateur) rien n'est chargé et aucune pub ne s'affiche.
//
// IDENTIFIANTS : REAL_BANNER_ID est le bloc d'annonces « Bannière bas » de LadyQueen
// (AdMob). Tant que USE_TEST_ADS est vrai, on utilise le bloc de TEST de Google
// (mention « Test Ad ») et un petit message de diagnostic s'affiche en bas :
// à garder pour tous les essais, car cliquer sur de vraies annonces de sa propre
// appli est interdit par AdMob (et un bloc neuf met des heures à diffuser). On
// ne passe à false que pour la version publiée. L'ID de l'appli AdMob se règle
// dans android/app/src/main/AndroidManifest.xml (meta-data APPLICATION_ID).
const USE_TEST_ADS = true;
const REAL_BANNER_ID = "ca-app-pub-4987258009555198/9157890974";
const TEST_BANNER_ID = "ca-app-pub-3940256099942544/9214589741"; // bannière de test Google
const BANNER_ID = USE_TEST_ADS ? TEST_BANNER_ID : REAL_BANNER_ID;

// Test builds only: a line at the bottom of the screen says what the ads are doing.
function debugMsg(text) {
  if (!USE_TEST_ADS) return;
  let el = document.getElementById("adDebug");
  if (!el) {
    el = document.createElement("div");
    el.id = "adDebug";
    el.style.cssText = "position:fixed;left:0;right:0;top:0;z-index:99998;padding:2px 6px;font:11px/1.3 monospace;color:#fff;background:rgba(160,30,30,.85);pointer-events:none;";
    document.body.appendChild(el);
  }
  el.textContent = "PUB (test) : " + text;
}

function isNativeApp() {
  return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
}

// The banner sits on top of the bottom of the screen: the page keeps that strip
// free (body padding, see .has-ad-banner in css/style.css).
function reserveBannerSpace(heightPx) {
  const root = document.documentElement;
  if (heightPx > 0) {
    root.style.setProperty("--ad-banner-h", Math.ceil(heightPx) + "px");
    document.body.classList.add("has-ad-banner");
  } else {
    root.style.removeProperty("--ad-banner-h");
    document.body.classList.remove("has-ad-banner");
  }
}

async function showBanner(AdMob) {
  await AdMob.showBanner({
    adId: BANNER_ID,
    adSize: "ADAPTIVE_BANNER",
    position: "BOTTOM_CENTER",
    margin: 0,
    isTesting: USE_TEST_ADS,
  });
}

let bannerAnswered = false;
let retries = 0;
const RETRY_DELAYS = [20, 40, 80, 160, 300]; // seconds
const MAX_RETRIES = RETRY_DELAYS.length;

export async function initAds() {
  if (!isNativeApp()) return;
  const AdMob = window.Capacitor.Plugins && window.Capacitor.Plugins.AdMob;
  if (!AdMob) { debugMsg("module AdMob introuvable"); return; }
  debugMsg("demarrage…");
  try {
    // RGPD consent (Google UMP): asked at first launch where the law requires it.
    let privacyOptionsRequired = false;
    try {
      const info = await Promise.race([
        AdMob.requestConsentInfo(),
        new Promise((r) => setTimeout(() => r({ status: "TIMEOUT" }), 3000)),
      ]);
      if (info && info.isConsentFormAvailable && info.status === "REQUIRED") {
        await Promise.race([AdMob.showConsentForm(), new Promise((r) => setTimeout(r, 8000))]);
      }
      privacyOptionsRequired = !!(info && info.privacyOptionsRequirementStatus === "REQUIRED");
    } catch (e) { /* consent form unavailable: ads carry on with the user's stored choice */ }

    // "Gérer mes choix publicitaires" (in the © bubble): offered where the law
    // requires a way to change the consent given.
    const row = document.getElementById("adConsentRow");
    const btn = document.getElementById("adConsentBtn");
    if (row && btn && privacyOptionsRequired) {
      row.hidden = false;
      btn.onclick = async () => {
        try {
          if (AdMob.showPrivacyOptionsForm) await AdMob.showPrivacyOptionsForm();
          else await AdMob.showConsentForm();
        } catch (e) { /* nothing to show */ }
      };
    }

    AdMob.addListener("bannerAdSizeChanged", (size) => reserveBannerSpace(size && size.height));
    AdMob.addListener("bannerAdLoaded", () => { bannerAnswered = true; debugMsg("banniere chargee"); });
    AdMob.addListener("bannerAdFailedToLoad", (err) => {
      bannerAnswered = true;
      reserveBannerSpace(0);
      debugMsg("banniere refusee, code " + (err && err.code) + " " + (err && err.message ? err.message : "") + (retries < MAX_RETRIES ? " — nouvel essai dans " + RETRY_DELAYS[retries] + " s" : ""));
      // An occasional refusal ("Unable to obtain a JavascriptEngine") is a hiccup of the phone's
      // WebView: ask again a few times, with growing pauses, instead of giving up.
      if (retries < MAX_RETRIES) {
        const wait = RETRY_DELAYS[retries++] * 1000;
        setTimeout(async () => {
          try { await AdMob.removeBanner(); } catch (e) { /* nothing to remove */ }
          try { bannerAnswered = false; await showBanner(AdMob); } catch (e) { debugMsg("erreur : " + (e && (e.message || e))); }
        }, wait);
      }
    });

    await AdMob.initialize({});
    debugMsg("initialise, demande de banniere…");
    await new Promise((r) => setTimeout(r, 800));
    await showBanner(AdMob);
    debugMsg("banniere demandee, attente de la reponse…");
    setTimeout(() => { if (!bannerAnswered) debugMsg("aucune reponse d'AdMob apres 15 s"); }, 15000);
  } catch (e) {
    reserveBannerSpace(0); // AdMob unavailable: the page uses the whole screen
    debugMsg("erreur : " + (e && (e.message || e)));
  }
}
