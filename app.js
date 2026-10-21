/* Liseuse : déchiffre le livre, le découpe en pages, le lit à voix haute. */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const CLE_STOCKEE = "liseuse.cle";
  const CLE_MARQUE = "liseuse.marque";
  const CLE_ANCIENNE_POSITION = "liseuse.position";
  const CLE_PREFS = "liseuse.prefs";

  const MAISONS = {
    gryffondor:  { nom: "Gryffondor",  tissu: "#7f0909", liseres: "#d3a625", encre: "#8b1a1a", encreNuit: "#d9b04a" },
    serdaigle:   { nom: "Serdaigle",   tissu: "#0e1a40", liseres: "#946b2d", encre: "#243a78", encreNuit: "#c49a5e" },
    poufsouffle: { nom: "Poufsouffle", tissu: "#ecb939", liseres: "#372e29", encre: "#8a6410", encreNuit: "#ecb939" },
    serpentard:  { nom: "Serpentard",  tissu: "#1a472a", liseres: "#aaaaaa", encre: "#1d5e37", encreNuit: "#9cc2a8" },
  };

  const etat = {
    livre: null,
    chap: 0,        // index du chapitre affiché
    page: 0,        // page courante dans le chapitre
    nbPages: 1,
    largeur: 0,     // largeur d'une page, ou d'une double page (px)
    gouttiere: 40,  // espace entre deux colonnes (px)
    paras: [],      // éléments <p> du chapitre, dans l'ordre
    mode: "lire",   // "lire" ou "ecouter"
  };

  const prefs = Object.assign({
    taille: window.innerWidth < 370 ? 18 : 19,
    theme: matchMedia("(prefers-color-scheme: dark)").matches ? "nuit" : "papier",
    align: "justify",
    son: true,
    vibre: false,
    voix: "",
    vitesse: 1,
    maison: "",
  }, lire(CLE_PREFS) || {});

  // Le marque-page : { c: chapitre, p: paragraphe }
  let marque = lire(CLE_MARQUE) || lire(CLE_ANCIENNE_POSITION);

  /* ---------- Petits outils ---------- */

  function lire(cle) {
    try { return JSON.parse(localStorage.getItem(cle)); } catch (e) { return null; }
  }
  function ecrire(cle, valeur) {
    try {
      if (valeur === null) localStorage.removeItem(cle);
      else localStorage.setItem(cle, JSON.stringify(valeur));
    } catch (e) { /* stockage indisponible : tant pis */ }
  }
  const b64versOctets = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const octetsVersB64 = (o) => btoa(String.fromCharCode(...new Uint8Array(o)));
  const echapper = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const enHtml = (s) => echapper(s).replace(/\*([^*]+)\*/g, "<em>$1</em>");
  const enTexte = (s) => s.replace(/\*/g, "");
  const nomChapitre = (ch) => (ch.num === 0 ? "Prologue" : "Chapitre " + ch.num);

  let numRuban = 0;
  function svgRuban(maison) {
    const m = MAISONS[maison] || MAISONS.gryffondor;
    const id = "soie" + (++numRuban);
    return '<svg viewBox="0 0 20 100" preserveAspectRatio="none">' +
      '<defs><linearGradient id="' + id + '" x1="0" x2="1">' +
      '<stop offset="0" stop-color="#000" stop-opacity=".18"/>' +
      '<stop offset=".35" stop-color="#fff" stop-opacity=".16"/>' +
      '<stop offset=".6" stop-color="#fff" stop-opacity="0"/>' +
      '<stop offset="1" stop-color="#000" stop-opacity=".22"/></linearGradient></defs>' +
      '<path d="M0 0H20V100L10 89L0 100Z" fill="' + m.tissu + '"/>' +
      '<path d="M3 0H5.2V96.4L3 98.2ZM14.8 0H17V98.2L14.8 96.4Z" fill="' + m.liseres + '"/>' +
      '<path d="M0 0H20V100L10 89L0 100Z" fill="url(#' + id + ')"/></svg>';
  }

  /* ---------- Déchiffrement ---------- */

  async function chargerFichier() {
    const r = await fetch("book.enc.json", { cache: "no-cache" });
    if (!r.ok) throw new Error("Livre introuvable (" + r.status + ")");
    return r.json();
  }

  async function deriverCle(motDePasse, fichier, exportable) {
    const base = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(motDePasse), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", hash: "SHA-256", salt: b64versOctets(fichier.sel), iterations: fichier.iter },
      base, { name: "AES-GCM", length: 256 }, exportable, ["decrypt"]);
  }

  async function dechiffrer(cle, fichier) {
    const clair = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64versOctets(fichier.iv) }, cle, b64versOctets(fichier.data));
    return JSON.parse(new TextDecoder().decode(clair));
  }

  async function demarrer() {
    appliquerPrefs();
    if (!window.crypto || !crypto.subtle) {
      $("msg-verrou").textContent = "Ce navigateur ne peut pas ouvrir le livre (il faut une adresse en https).";
      return;
    }
    let fichier;
    try {
      fichier = await chargerFichier();
    } catch (e) {
      $("msg-verrou").textContent = "Impossible de charger le livre. Vérifiez la connexion.";
      return;
    }

    // Clé déjà mémorisée sur cet appareil ?
    const memo = lire(CLE_STOCKEE);
    if (memo) {
      try {
        const cle = await crypto.subtle.importKey("raw", b64versOctets(memo), "AES-GCM", false, ["decrypt"]);
        livreOuvert(await dechiffrer(cle, fichier));
        return;
      } catch (e) {
        ecrire(CLE_STOCKEE, null); // le livre a été reconstruit, ou la clé est abîmée
      }
    }

    $("form-verrou").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const bouton = $("btn-ouvrir");
      bouton.disabled = true;
      $("msg-verrou").textContent = "";
      try {
        const memoriser = $("memoriser").checked;
        const cle = await deriverCle($("mdp").value, fichier, memoriser);
        const livre = await dechiffrer(cle, fichier);
        if (memoriser) ecrire(CLE_STOCKEE, octetsVersB64(await crypto.subtle.exportKey("raw", cle)));
        $("mdp").value = "";
        $("mdp").blur();
        livreOuvert(livre);
      } catch (e) {
        $("msg-verrou").textContent = "Mot de passe incorrect.";
        $("mdp").select();
      } finally {
        bouton.disabled = false;
      }
    });
  }

  function livreOuvert(livre) {
    etat.livre = livre;
    document.title = livre.titre;
    document.querySelectorAll(".titre-livre").forEach((h) => (h.textContent = livre.titre));
    if (marque && !(marque.c >= 0 && marque.c < livre.chapitres.length)) marque = null;
    remplirSommaire();
    $("verrou").hidden = true;
    afficherAccueil();
  }

  /* ---------- Accueil ---------- */

  function afficherAccueil() {
    $("liseuse").hidden = true;
    $("accueil").hidden = false;
    if (!prefs.maison) {
      $("accueil-mode").hidden = true;
      $("accueil-maisons").hidden = false;
      return;
    }
    $("accueil-maisons").hidden = true;
    $("accueil-mode").hidden = false;
    const grand = $("grand-ruban");
    grand.innerHTML = svgRuban(prefs.maison);
    grand.style.animation = "none"; void grand.offsetWidth; grand.style.animation = "";

    const ou = $("ou-reprendre");
    if (marque && (marque.c > 0 || marque.p > 0)) {
      const ch = etat.livre.chapitres[marque.c];
      ou.innerHTML = "Votre marque-page vous attend<br><b>" + echapper(nomChapitre(ch)) + " · " + echapper(ch.titre) + "</b>";
    } else {
      ou.textContent = "Comment voulez-vous découvrir l'histoire ?";
    }
  }

  document.querySelectorAll(".maisons button").forEach((b) => {
    b.querySelector(".ruban-carte").innerHTML = svgRuban(b.dataset.maison);
    b.addEventListener("click", () => {
      prefs.maison = b.dataset.maison;
      appliquerPrefs();
      afficherAccueil();
    });
  });
  $("btn-changer-maison").addEventListener("click", () => {
    $("accueil-mode").hidden = true;
    $("accueil-maisons").hidden = false;
    document.querySelectorAll(".maisons button").forEach((b) => b.classList.toggle("choisie", b.dataset.maison === prefs.maison));
  });
  $("btn-mode-lire").addEventListener("click", () => ouvrirLiseuse("lire"));
  $("btn-mode-ecouter").addEventListener("click", () => ouvrirLiseuse("ecouter"));

  async function ouvrirLiseuse(mode) {
    contexteAudio(); // le son doit être débloqué par un geste
    $("accueil").hidden = true;
    $("liseuse").hidden = false;
    reglerMode(mode);
    await policesPretes();
    const m = marque || { c: 0, p: -1 };
    afficherChapitre(m.c, { para: m.p });
    if (mode === "ecouter") demarrerLecture(m.c === etat.chap ? m.p : -1);
  }

  function reglerMode(mode) {
    etat.mode = mode;
    document.body.classList.toggle("mode-ecouter", mode === "ecouter");
    $("lecteur").hidden = mode !== "ecouter";
    majLecteur();
  }

  function changerMode(mode) {
    if (mode === etat.mode) return;
    const bloc = lecture.actif ? lecture.bloc : blocVisible();
    if (mode === "lire") arreterLecture();
    reglerMode(mode);
    afficherChapitre(etat.chap, { para: bloc });
    if (mode === "ecouter") demarrerLecture(bloc);
  }

  /* ---------- Mise en page ---------- */

  // Attend la police du livre (sinon la pagination change quand elle arrive)
  function policesPretes() {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    const attente = Promise.all([
      document.fonts.load(prefs.taille + 'px "Literata"'),
      document.fonts.load("italic " + prefs.taille + 'px "Literata"'),
    ]).catch(() => {});
    return Promise.race([attente, new Promise((r) => setTimeout(r, 2500))]);
  }

  function construireChapitre(ch) {
    const morceaux = [
      '<div class="entete-chapitre">',
      '<div class="num">' + echapper(ch.label) + "</div>",
      "<h1>" + echapper(ch.titre) + "</h1>",
      '<div class="orn">❦</div>',
      ch.num === 0 ? '<div class="titre-livre-petit">' + echapper(etat.livre.titre) + "</div>" : "",
      "</div>",
    ];
    let premier = true, apresScene = false;
    ch.blocs.forEach((b, i) => {
      if (b.t === "break") {
        morceaux.push('<div class="scene" aria-hidden="true">❦</div>');
        apresScene = true;
        return;
      }
      const classe = premier ? "premier" : apresScene ? "apres-scene" : "";
      morceaux.push('<p data-i="' + i + '"' + (classe ? ' class="' + classe + '"' : "") + ">" + enHtml(b.x) + "</p>");
      premier = false; apresScene = false;
    });
    return morceaux.join("");
  }

  // options : { page, para, fin } pour savoir où se placer dans le chapitre
  function afficherChapitre(c, options) {
    options = options || {};
    const ch = etat.livre.chapitres[c];
    etat.chap = c;
    const flux = $("flux");
    flux.innerHTML = construireChapitre(ch);
    etat.paras = Array.from(flux.querySelectorAll("p[data-i]"));
    paginer();

    let page = 0;
    if (options.fin) page = etat.nbPages - 1;
    else if (options.para != null && options.para >= 0) page = pageDuBloc(options.para);
    else if (options.page != null) page = options.page;
    allerPage(page, false);

    $("pied-chap").textContent = ch.num === 0 ? ch.titre : ch.label + " · " + ch.titre;
    $("barre-titre").textContent = nomChapitre(ch) + " · " + ch.titre;
    marquerSommaire();
    majLecteur();
    setAmbiance(ch.ambiance);
  }

  function paginer() {
    const flux = $("flux");
    const cadre = $("cadre");
    const largeur = cadre.clientWidth;
    const gouttiere = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--gouttiere")) || 40;
    // Écran large (téléphone à l'horizontale, tablette) : deux pages côte à côte
    const double = largeur > 720 && largeur > cadre.clientHeight * 1.2;
    etat.largeur = largeur;
    etat.gouttiere = gouttiere;
    flux.style.width = largeur + "px";
    flux.style.columnWidth = (double ? (largeur - gouttiere) / 2 : largeur) + "px";
    flux.style.columnCount = double ? "auto" : "";
    flux.classList.remove("anime");
    flux.style.transform = "translateX(0)";
    const dernier = flux.lastElementChild;
    etat.nbPages = dernier ? pageDeRect(dernier.getClientRects(), true) + 1 : 1;
    $("curseur").max = Math.max(etat.nbPages - 1, 0);
  }

  // Numéro de page d'un rectangle (le premier, ou le dernier si fin=true)
  function pageDeRect(rects, fin) {
    if (!rects.length) return 0;
    const r = fin ? rects[rects.length - 1] : rects[0];
    const gauche = $("flux").getBoundingClientRect().left;
    return Math.max(0, Math.floor((r.left - gauche + 2) / (etat.largeur + etat.gouttiere)));
  }

  function pageDuBloc(i) {
    if (i == null || i < 0) return 0;
    const el = $("flux").querySelector('p[data-i="' + i + '"]');
    return el ? pageDeRect(el.getClientRects()) : 0;
  }

  function blocSurPage(i, page) {
    const el = $("flux").querySelector('p[data-i="' + i + '"]');
    if (!el) return false;
    const rects = el.getClientRects();
    return pageDeRect(rects) <= page && pageDeRect(rects, true) >= page;
  }

  // Premier paragraphe visible sur la page courante
  function blocVisible() {
    let candidat = null;
    for (const p of etat.paras) {
      const rects = p.getClientRects();
      const debut = pageDeRect(rects), fin = pageDeRect(rects, true);
      if (debut === etat.page) return +p.dataset.i;
      if (debut < etat.page && fin >= etat.page) candidat = +p.dataset.i;
      if (debut > etat.page) break;
    }
    return candidat != null ? candidat : -1;
  }

  function allerPage(n, anime) {
    n = Math.min(Math.max(n, 0), etat.nbPages - 1);
    etat.page = n;
    const flux = $("flux");
    flux.classList.toggle("anime", !!anime);
    flux.style.transform = "translateX(" + (-n * (etat.largeur + etat.gouttiere)) + "px)";
    $("pied-page").textContent = (n + 1) + " / " + etat.nbPages;
    $("curseur").value = n;
    $("curseur-txt").textContent = "p. " + (n + 1) + "/" + etat.nbPages;
    majRuban();
  }

  function retourPhysique() {
    if (prefs.vibre && navigator.vibrate) navigator.vibrate(8);
    sonPage();
  }

  function pageSuivante() {
    if (etat.page < etat.nbPages - 1) allerPage(etat.page + 1, true);
    else if (etat.chap < etat.livre.chapitres.length - 1) afficherChapitre(etat.chap + 1);
    else return false;
    retourPhysique();
    return true;
  }

  function pagePrecedente() {
    if (etat.page > 0) allerPage(etat.page - 1, true);
    else if (etat.chap > 0) afficherChapitre(etat.chap - 1, { fin: true });
    else { allerPage(0, true); return; }
    retourPhysique();
  }

  let attenteRedim = null;
  function repaginerPlusTard() {
    if (!etat.livre || $("liseuse").hidden) return;
    clearTimeout(attenteRedim);
    attenteRedim = setTimeout(() => {
      const bloc = lecture.actif ? lecture.bloc : blocVisible();
      afficherChapitre(etat.chap, { para: bloc });
      if (lecture.actif) surligner(lecture.bloc);
    }, 200);
  }
  window.addEventListener("resize", repaginerPlusTard);
  if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener("loadingdone", repaginerPlusTard);

  /* ---------- Marque-page ---------- */

  function poserMarque() {
    if (!etat.livre || $("liseuse").hidden) return;
    const p = lecture.actif || (etat.mode === "ecouter" && lecture.bloc >= 0 && lecture.chap === etat.chap && blocSurPage(lecture.bloc, etat.page))
      ? lecture.bloc : blocVisible();
    marque = { c: etat.chap, p: p };
    ecrire(CLE_MARQUE, marque);
    marquerSommaire();
    majRuban();
  }

  function majRuban() {
    const r = $("ruban");
    const visible = !!(marque && prefs.maison && marque.c === etat.chap && pageDuBloc(marque.p) === etat.page);
    r.classList.toggle("visible", visible);
  }

  $("btn-aller-marque").addEventListener("click", () => {
    if (!marque) return;
    arreterLecture();
    masquerBarre();
    afficherChapitre(marque.c, { para: marque.p });
    retourPhysique();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") poserMarque();
    else if (lecture.actif) garderEcranAllume();
  });
  window.addEventListener("pagehide", poserMarque);

  $("btn-fermer").addEventListener("click", () => {
    masquerBarre();
    arreterLecture();
    poserMarque();
    const r = $("ruban");
    r.classList.remove("visible");
    void r.offsetWidth;
    r.classList.add("visible");
    setTimeout(() => { reglerMode("lire"); afficherAccueil(); }, 650);
  });

  /* ---------- Son de page (synthétisé, aucun fichier audio) ---------- */

  let audio = null;
  function contexteAudio() {
    if (!audio) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audio = new AC();
    }
    if (audio.state === "suspended") audio.resume();
    return audio;
  }

  function sonPage() {
    if (!prefs.son) return;
    const ctx = contexteAudio();
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const duree = 0.32;
    const tampon = ctx.createBuffer(1, Math.floor(ctx.sampleRate * duree), ctx.sampleRate);
    const d = tampon.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (0.6 + 0.4 * Math.random());

    const source = ctx.createBufferSource();
    source.buffer = tampon;
    const filtre = ctx.createBiquadFilter();
    filtre.type = "bandpass";
    filtre.Q.value = 0.9;
    filtre.frequency.setValueAtTime(900, t0);
    filtre.frequency.exponentialRampToValueAtTime(3800, t0 + 0.12);
    filtre.frequency.exponentialRampToValueAtTime(1400, t0 + duree);
    const aigu = ctx.createBiquadFilter();
    aigu.type = "highpass";
    aigu.frequency.value = 300;
    const volume = ctx.createGain();
    volume.gain.setValueAtTime(0.0001, t0);
    volume.gain.exponentialRampToValueAtTime(0.22, t0 + 0.03);
    volume.gain.exponentialRampToValueAtTime(0.06, t0 + 0.11);
    volume.gain.exponentialRampToValueAtTime(0.16, t0 + 0.16);
    volume.gain.exponentialRampToValueAtTime(0.0001, t0 + duree);
    source.connect(filtre).connect(aigu).connect(volume).connect(ctx.destination);
    source.start(t0);
    source.stop(t0 + duree);
  }

  /* ---------- Musique d'ambiance (prévue pour plus tard) ---------- */

  // Chaque chapitre porte un champ "ambiance" (null pour l'instant).
  // Quand les musiques seront ajoutées, c'est ici qu'on lancera le bon morceau.
  function setAmbiance(nom) { /* rien pour le moment */ }

  /* ---------- Gestes : glisser et toucher ---------- */

  const geste = { actif: false, x: 0, y: 0 };
  const zone = $("liseuse");
  const HORS_GESTES = ".panneau, #barre .barre-haut, #barre .barre-bas, #lecteur";

  zone.addEventListener("pointerdown", (ev) => {
    if (ev.target.closest(HORS_GESTES)) return;
    geste.actif = true; geste.x = ev.clientX; geste.y = ev.clientY;
    contexteAudio();
  });
  zone.addEventListener("pointermove", (ev) => {
    if (!geste.actif || !$("barre").hidden) return;
    const dx = ev.clientX - geste.x;
    if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(ev.clientY - geste.y)) {
      const flux = $("flux");
      flux.classList.remove("anime");
      flux.style.transform = "translateX(" + (-etat.page * (etat.largeur + etat.gouttiere) + dx) + "px)";
    }
  });
  zone.addEventListener("pointerup", (ev) => {
    if (!geste.actif) return;
    geste.actif = false;
    const dx = ev.clientX - geste.x, dy = ev.clientY - geste.y;
    if (!$("barre").hidden) { masquerBarre(); return; }
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
      arreterLecture();
      if (dx < 0) { if (!pageSuivante()) allerPage(etat.page, true); }
      else pagePrecedente();
      return;
    }
    allerPage(etat.page, true); // annule un petit glissement
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) return;
    const tiers = window.innerWidth / 3;
    if (ev.clientX < tiers) { arreterLecture(); pagePrecedente(); }
    else if (ev.clientX > 2 * tiers) { arreterLecture(); pageSuivante(); }
    else afficherBarre();
  });
  zone.addEventListener("pointercancel", () => { geste.actif = false; allerPage(etat.page, true); });

  document.addEventListener("keydown", (ev) => {
    if (!etat.livre || $("liseuse").hidden || ev.target.tagName === "INPUT" || ev.target.tagName === "SELECT") return;
    if (ev.key === "ArrowRight" || ev.key === "PageDown" || ev.key === " ") { arreterLecture(); pageSuivante(); ev.preventDefault(); }
    else if (ev.key === "ArrowLeft" || ev.key === "PageUp") { arreterLecture(); pagePrecedente(); ev.preventDefault(); }
    else if (ev.key === "Escape") { fermerPanneaux(); masquerBarre(); }
  });

  /* ---------- Barre, sommaire, réglages ---------- */

  function afficherBarre() { $("barre").hidden = false; }
  function masquerBarre() { $("barre").hidden = true; }
  function fermerPanneaux() { document.querySelectorAll(".panneau").forEach((p) => (p.hidden = true)); }

  document.querySelectorAll("[data-ferme]").forEach((b) =>
    b.addEventListener("click", () => ($(b.dataset.ferme).hidden = true)));

  $("btn-sommaire").addEventListener("click", () => {
    masquerBarre();
    $("panneau-sommaire").hidden = false;
    const courant = $("liste-chapitres").querySelector(".courant");
    if (courant) courant.scrollIntoView({ block: "center" });
  });
  $("btn-reglages").addEventListener("click", () => { masquerBarre(); $("panneau-reglages").hidden = false; });
  $("curseur").addEventListener("input", (ev) => { arreterLecture(); allerPage(+ev.target.value, false); });
  $("btn-vers-ecouter").addEventListener("click", () => { masquerBarre(); changerMode("ecouter"); });

  function remplirSommaire() {
    const liste = $("liste-chapitres");
    liste.innerHTML = "";
    etat.livre.chapitres.forEach((ch, c) => {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.innerHTML = '<span class="n">' + (ch.num === 0 ? "Prologue" : "Ch. " + ch.num) + "</span><span>" + echapper(ch.titre) + "</span>";
      b.addEventListener("click", () => {
        const enEcoute = lecture.actif;
        arreterLecture();
        fermerPanneaux();
        if (marque && marque.c === c) afficherChapitre(c, { para: marque.p });
        else afficherChapitre(c);
        retourPhysique();
        if (enEcoute) demarrerLecture();
      });
      li.appendChild(b);
      liste.appendChild(li);
    });
  }

  function marquerSommaire() {
    $("liste-chapitres").querySelectorAll("li").forEach((li, c) => {
      li.classList.toggle("courant", c === etat.chap);
      const bouton = li.firstChild;
      let signet = bouton.querySelector(".signet");
      if (marque && marque.c === c && prefs.maison) {
        if (!signet) {
          signet = document.createElement("span");
          signet.className = "signet";
          signet.innerHTML = svgRuban(prefs.maison);
          bouton.appendChild(signet);
        }
      } else if (signet) signet.remove();
    });
  }

  function appliquerPrefs() {
    const racine = document.documentElement;
    racine.style.setProperty("--taille", prefs.taille + "px");
    racine.style.setProperty("--align", prefs.align);
    racine.dataset.theme = prefs.theme;
    const m = MAISONS[prefs.maison];
    if (m) racine.style.setProperty("--encre", prefs.theme === "nuit" ? m.encreNuit : m.encre);
    else racine.style.removeProperty("--encre");
    const couleurs = { papier: "#f4ecd8", clair: "#ffffff", nuit: "#14120f" };
    document.querySelector('meta[name="theme-color"]').content = couleurs[prefs.theme] || couleurs.papier;
    document.querySelectorAll("#choix-theme button").forEach((b) => b.classList.toggle("actif", b.dataset.theme === prefs.theme));
    document.querySelectorAll("#choix-align button").forEach((b) => b.classList.toggle("actif", b.dataset.align === prefs.align));
    $("opt-son").checked = prefs.son;
    $("opt-vibre").checked = prefs.vibre;
    $("vitesse").value = prefs.vitesse;
    $("val-vitesse").textContent = (+prefs.vitesse).toFixed(1).replace(".", ",");
    $("btn-vitesse").textContent = (+prefs.vitesse).toFixed(1).replace(".", ",").replace(",0", "") + "×";
    $("ruban").innerHTML = prefs.maison ? svgRuban(prefs.maison) : "";
    ecrire(CLE_PREFS, prefs);
  }

  function repaginerIci() {
    if (!etat.livre || $("liseuse").hidden) return;
    const bloc = lecture.actif ? lecture.bloc : blocVisible();
    afficherChapitre(etat.chap, { para: bloc });
    if (lecture.actif) surligner(lecture.bloc);
  }

  function changerTaille(delta) {
    prefs.taille = Math.min(Math.max(prefs.taille + delta, 14), 30);
    appliquerPrefs();
    policesPretes().then(repaginerIci);
  }
  $("btn-taille-moins").addEventListener("click", () => changerTaille(-1));
  $("btn-taille-plus").addEventListener("click", () => changerTaille(1));
  document.querySelectorAll("#choix-theme button").forEach((b) =>
    b.addEventListener("click", () => { prefs.theme = b.dataset.theme; appliquerPrefs(); }));
  document.querySelectorAll("#choix-align button").forEach((b) =>
    b.addEventListener("click", () => { prefs.align = b.dataset.align; appliquerPrefs(); repaginerIci(); }));
  $("opt-son").addEventListener("change", (ev) => { prefs.son = ev.target.checked; appliquerPrefs(); });
  $("opt-vibre").addEventListener("change", (ev) => {
    prefs.vibre = ev.target.checked; appliquerPrefs();
    if (prefs.vibre && navigator.vibrate) navigator.vibrate(8);
  });
  $("vitesse").addEventListener("input", (ev) => { prefs.vitesse = +ev.target.value; appliquerPrefs(); });
  $("vitesse").addEventListener("change", relancerParagraphe);
  $("choix-voix").addEventListener("change", (ev) => { prefs.voix = ev.target.value; appliquerPrefs(); relancerParagraphe(); });
  if (!navigator.vibrate) $("opt-vibre").closest(".reglage").hidden = true;

  // Plein écran (Android ; l'iPhone ne le permet pas, il faut « Ajouter à l'écran d'accueil »)
  const pleinEcranPossible = !!document.documentElement.requestFullscreen;
  if (!pleinEcranPossible) $("ligne-plein-ecran").hidden = true;
  $("opt-plein").addEventListener("change", (ev) => {
    if (ev.target.checked) document.documentElement.requestFullscreen().catch(() => (ev.target.checked = false));
    else if (document.fullscreenElement) document.exitFullscreen();
  });
  document.addEventListener("fullscreenchange", () => { $("opt-plein").checked = !!document.fullscreenElement; });

  $("btn-oublier").addEventListener("click", () => {
    arreterLecture();
    ecrire(CLE_STOCKEE, null);
    location.reload();
  });

  /* ---------- Lecture à voix haute ---------- */

  const synth = window.speechSynthesis;
  const lecture = { actif: false, chap: -1, bloc: -1, morceaux: [], n: 0, generation: 0, enCours: null, verrouEcran: null };

  function voixFrancaises() {
    if (!synth) return [];
    return synth.getVoices().filter((v) => /^fr/i.test(v.lang));
  }

  function remplirVoix() {
    const select = $("choix-voix");
    const voix = voixFrancaises();
    select.innerHTML = "";
    if (!voix.length) {
      select.innerHTML = "<option value=''>Voix française par défaut</option>";
      return;
    }
    voix.sort((a, b) => (b.lang === "fr-FR") - (a.lang === "fr-FR") || (b.localService - a.localService));
    voix.forEach((v) => {
      const o = document.createElement("option");
      o.value = v.name;
      o.textContent = v.name + (v.lang !== "fr-FR" ? " (" + v.lang + ")" : "");
      select.appendChild(o);
    });
    if (prefs.voix && voix.some((v) => v.name === prefs.voix)) select.value = prefs.voix;
  }
  if (synth) {
    remplirVoix();
    if (synth.addEventListener) synth.addEventListener("voiceschanged", remplirVoix);
    else synth.onvoiceschanged = remplirVoix;
  } else {
    $("btn-mode-ecouter").disabled = true;
    $("btn-mode-ecouter").querySelector("span").textContent = "Écouter (indisponible)";
    $("btn-vers-ecouter").hidden = true;
  }

  function voixChoisie() {
    const voix = voixFrancaises();
    return voix.find((v) => v.name === prefs.voix) || voix.find((v) => v.lang === "fr-FR") || voix[0] || null;
  }

  // Coupe un paragraphe en phrases (les longues utterances se bloquent sur certains navigateurs)
  function decouper(texte) {
    const phrases = texte.match(/[^.!?…»]+(?:[.!?…]+\s*»?|»|$)\s*/g) || [texte];
    const morceaux = [];
    let courant = "";
    for (const ph of phrases) {
      if ((courant + ph).length > 220 && courant) { morceaux.push(courant); courant = ""; }
      courant += ph;
    }
    if (courant.trim()) morceaux.push(courant);
    return morceaux;
  }

  function blocsLisibles(c) {
    return etat.livre.chapitres[c].blocs.map((b, i) => (b.t === "p" ? i : -1)).filter((i) => i >= 0);
  }

  function surligner(i) {
    etat.paras.forEach((p) => p.classList.toggle("lu", +p.dataset.i === i));
  }

  // Tourne la page si la partie du paragraphe en cours de lecture n'est pas visible
  function suivreLecture(i, fraction) {
    const el = $("flux").querySelector('p[data-i="' + i + '"]');
    if (!el) return;
    const rects = el.getClientRects();
    if (!rects.length) return;
    const r = rects[Math.min(Math.floor(fraction * rects.length), rects.length - 1)];
    const page = pageDeRect([r]);
    if (page !== etat.page) {
      allerPage(page, true);
      sonPage();
    }
  }

  function parler(texte, finie) {
    const u = new SpeechSynthesisUtterance(texte);
    const v = voixChoisie();
    if (v) u.voice = v;
    u.lang = v ? v.lang : "fr-FR";
    u.rate = prefs.vitesse;
    const gen = lecture.generation;
    u.onend = () => { if (gen === lecture.generation) finie(); };
    u.onerror = (e) => {
      if (gen !== lecture.generation) return;
      if (e.error === "interrupted" || e.error === "canceled") return;
      finie();
    };
    lecture.enCours = u; // garde une référence (sinon Chrome peut l'oublier en route)
    synth.speak(u);
  }

  function lireBloc(i) {
    if (!lecture.actif) return;
    lecture.chap = etat.chap;
    lecture.bloc = i;
    surligner(i);
    const texte = enTexte(etat.livre.chapitres[etat.chap].blocs[i].x);
    lecture.morceaux = decouper(texte);
    lecture.n = 0;
    majLecteur();
    lireMorceau(texte.length);
  }

  function lireMorceau(longueur) {
    if (!lecture.actif) return;
    const avant = lecture.morceaux.slice(0, lecture.n).join("").length;
    suivreLecture(lecture.bloc, longueur ? avant / longueur : 0);
    parler(lecture.morceaux[lecture.n], () => {
      lecture.n++;
      if (lecture.n < lecture.morceaux.length) lireMorceau(longueur);
      else blocSuivant();
    });
  }

  function blocSuivant() {
    const liste = blocsLisibles(etat.chap);
    const k = liste.indexOf(lecture.bloc);
    if (k >= 0 && k < liste.length - 1) {
      const suivant = liste[k + 1];
      const pause = etat.livre.chapitres[etat.chap].blocs[suivant - 1].t === "break";
      const gen = lecture.generation;
      if (pause) setTimeout(() => { if (gen === lecture.generation) lireBloc(suivant); }, 900);
      else lireBloc(suivant);
      return;
    }
    // Fin du chapitre : on enchaîne sur le suivant
    if (etat.chap < etat.livre.chapitres.length - 1) {
      afficherChapitre(etat.chap + 1);
      sonPage();
      const ch = etat.livre.chapitres[etat.chap];
      const annonce = nomChapitre(ch) + ". " + ch.titre + ".";
      const gen = lecture.generation;
      setTimeout(() => {
        if (!lecture.actif || gen !== lecture.generation) return;
        parler(annonce, () => setTimeout(() => {
          if (gen !== lecture.generation) return;
          const l = blocsLisibles(etat.chap);
          if (l.length) lireBloc(l[0]); else arreterLecture();
        }, 700));
      }, 1200);
    } else {
      arreterLecture();
    }
  }

  // depart : paragraphe par lequel commencer (sinon le premier de la page affichée)
  function demarrerLecture(depart) {
    if (!synth) return;
    lecture.generation++;
    synth.cancel();
    lecture.actif = true;
    garderEcranAllume();
    const liste = blocsLisibles(etat.chap);
    if (depart == null || depart < 0 || liste.indexOf(depart) < 0) depart = blocVisible();
    if (depart < 0) depart = liste[0];
    if (depart == null) { arreterLecture(); return; }
    lireBloc(depart);
  }

  function arreterLecture() {
    if (!lecture.actif) return;
    lecture.actif = false;
    lecture.generation++;
    if (synth) synth.cancel();
    if (etat.mode !== "ecouter") surligner(-1);
    if (lecture.verrouEcran) { lecture.verrouEcran.release().catch(() => {}); lecture.verrouEcran = null; }
    majLecteur();
  }

  function relancerParagraphe() {
    if (lecture.actif) demarrerLecture(lecture.bloc);
  }

  // Reprend là où la voix s'était arrêtée, si ce passage est encore à l'écran
  function reprendre() {
    if (lecture.chap === etat.chap && lecture.bloc >= 0 && blocSurPage(lecture.bloc, etat.page)) demarrerLecture(lecture.bloc);
    else demarrerLecture();
  }

  function sauterParagraphe(sens) {
    const liste = blocsLisibles(etat.chap);
    let k = lecture.chap === etat.chap ? liste.indexOf(lecture.bloc) : -1;
    if (k < 0) k = Math.max(liste.indexOf(blocVisible()), 0);
    else k = Math.min(Math.max(k + sens, 0), liste.length - 1);
    demarrerLecture(liste[k]);
  }

  function majLecteur() {
    if (!etat.livre) return;
    $("btn-lecture").classList.toggle("en-cours", lecture.actif);
    const ch = etat.livre.chapitres[etat.chap];
    $("lecteur-info").textContent = (lecture.actif ? "" : "En pause · ") + nomChapitre(ch) + " · " + ch.titre;
  }

  $("btn-lecture").addEventListener("click", () => (lecture.actif ? arreterLecture() : reprendre()));
  $("btn-para-prec").addEventListener("click", () => sauterParagraphe(-1));
  $("btn-para-suiv").addEventListener("click", () => sauterParagraphe(1));
  $("btn-vers-lire").addEventListener("click", () => changerMode("lire"));
  $("btn-vitesse").addEventListener("click", () => {
    const vitesses = [0.8, 1, 1.2, 1.4];
    const k = vitesses.indexOf(+prefs.vitesse);
    prefs.vitesse = vitesses[(k + 1) % vitesses.length];
    appliquerPrefs();
    relancerParagraphe();
  });

  // Empêche l'écran de se mettre en veille pendant la lecture (sinon la voix s'arrête)
  async function garderEcranAllume() {
    if (!("wakeLock" in navigator) || lecture.verrouEcran) return;
    try {
      const v = await navigator.wakeLock.request("screen");
      v.addEventListener("release", () => { if (lecture.verrouEcran === v) lecture.verrouEcran = null; });
      lecture.verrouEcran = v;
    } catch (e) { /* pas grave */ }
  }
  window.addEventListener("beforeunload", () => { if (synth) synth.cancel(); });

  /* ---------- Hors ligne ---------- */

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  demarrer();
})();
