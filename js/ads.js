// Publicité Google AdMob — uniquement dans l'appli Android (Capacitor).
// Sur le site web (navigateur) rien n'est chargé et aucune pub ne s'affiche.
//
// IDENTIFIANTS : tant que USE_TEST_ADS est vrai, ce sont les annonces de TEST de
// Google qui s'affichent (elles portent la mention « Test Ad »). Avant de
// publier : renseigner BANNER_ID avec l'ID du bloc d'annonces LadyQueen (créé
// dans AdMob) et passer USE_TEST_ADS à false. L'ID de l'appli AdMob se règle
// dans android/app/src/main/AndroidManifest.xml (meta-data APPLICATION_ID).
const USE_TEST_ADS = true;
const BANNER_ID = "ca-app-pub-3940256099942544/9214589741"; // bannière adaptative — ID de test Google

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

export async function initAds() {
  if (!isNativeApp()) return;
  const AdMob = window.Capacitor.Plugins && window.Capacitor.Plugins.AdMob;
  if (!AdMob) return;
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
    AdMob.addListener("bannerAdFailedToLoad", () => reserveBannerSpace(0));

    await AdMob.initialize({});
    await new Promise((r) => setTimeout(r, 800));
    await showBanner(AdMob);
  } catch (e) {
    reserveBannerSpace(0); // AdMob unavailable: the page uses the whole screen
  }
}
