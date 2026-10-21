/* Liseuse : déchiffre le livre, le découpe en pages, le lit à voix haute. */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const CLE_STOCKEE = "liseuse.cle";
  const CLE_POSITION = "liseuse.position";
  const CLE_PREFS = "liseuse.prefs";

  const etat = {
    livre: null,
    chap: 0,       // index du chapitre affiché
    page: 0,       // page courante dans le chapitre
    nbPages: 1,
    largeur: 0,    // largeur d'une page (px)
    gouttiere: 44, // espace entre deux colonnes (px)
    paras: [],     // éléments <p> du chapitre, dans l'ordre
  };

  const prefs = Object.assign({
    taille: 19,
    theme: matchMedia("(prefers-color-scheme: dark)").matches ? "nuit" : "papier",
    son: true,
    voix: "",
    vitesse: 1,
  }, lire(CLE_PREFS) || {});

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
        ouvrirLivre(await dechiffrer(cle, fichier));
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
        ouvrirLivre(livre);
      } catch (e) {
        $("msg-verrou").textContent = "Mot de passe incorrect.";
        $("mdp").select();
      } finally {
        bouton.disabled = false;
      }
    });
    $("mdp").focus();
  }

  /* ---------- Mise en page ---------- */

  function ouvrirLivre(livre) {
    etat.livre = livre;
    document.title = livre.titre;
    $("verrou").hidden = true;
    $("liseuse").hidden = false;
    remplirSommaire();
    const pos = lire(CLE_POSITION) || { c: 0, p: -1 };
    const c = Math.min(Math.max(pos.c | 0, 0), livre.chapitres.length - 1);
    afficherChapitre(c, { para: pos.p });
  }

  function construireChapitre(ch) {
    const morceaux = [
      '<div class="entete-chapitre">',
      '<div class="num">' + echapper(ch.label) + "</div>",
      "<h1>" + echapper(ch.titre) + "</h1>",
      '<div class="orn">❦</div>',
      ch.num === 0 ? '<div class="titre-livre">' + echapper(etat.livre.titre) + "</div>" : "",
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
    $("barre-titre").textContent = ch.label;
    marquerSommaire();
    setAmbiance(ch.ambiance);
  }

  function paginer() {
    const flux = $("flux");
    const cadre = $("cadre");
    etat.largeur = cadre.clientWidth;
    etat.gouttiere = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--gouttiere")) || 44;
    flux.style.width = etat.largeur + "px";
    flux.style.columnWidth = etat.largeur + "px";
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
    const el = $("flux").querySelector('p[data-i="' + i + '"]');
    return el ? pageDeRect(el.getClientRects()) : 0;
  }

  // Premier paragraphe visible sur la page courante (pour mémoriser la position)
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
    memoriserPosition();
  }

  function memoriserPosition() {
    ecrire(CLE_POSITION, { c: etat.chap, p: blocVisible() });
  }

  function pageSuivante() {
    if (etat.page < etat.nbPages - 1) allerPage(etat.page + 1, true);
    else if (etat.chap < etat.livre.chapitres.length - 1) afficherChapitre(etat.chap + 1);
    else return false;
    sonPage();
    return true;
  }

  function pagePrecedente() {
    if (etat.page > 0) allerPage(etat.page - 1, true);
    else if (etat.chap > 0) afficherChapitre(etat.chap - 1, { fin: true });
    else { allerPage(0, true); return; }
    sonPage();
  }

  let attenteRedim = null;
  window.addEventListener("resize", () => {
    if (!etat.livre) return;
    clearTimeout(attenteRedim);
    attenteRedim = setTimeout(() => {
      const bloc = lecture.actif ? lecture.bloc : blocVisible();
      afficherChapitre(etat.chap, { para: bloc });
      if (lecture.actif) surligner(lecture.bloc);
    }, 200);
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

  const geste = { actif: false, x: 0, y: 0, dx: 0, t: 0 };
  const cadre = $("cadre");
  const zone = $("liseuse");

  zone.addEventListener("pointerdown", (ev) => {
    if (ev.target.closest(".panneau, #barre .barre-haut, #barre .barre-bas, #mini-lecteur")) return;
    geste.actif = true; geste.x = ev.clientX; geste.y = ev.clientY; geste.dx = 0; geste.t = Date.now();
    contexteAudio();
  });
  zone.addEventListener("pointermove", (ev) => {
    if (!geste.actif || !$("barre").hidden) return;
    geste.dx = ev.clientX - geste.x;
    if (Math.abs(geste.dx) > 8 && Math.abs(geste.dx) > Math.abs(ev.clientY - geste.y)) {
      const flux = $("flux");
      flux.classList.remove("anime");
      flux.style.transform = "translateX(" + (-etat.page * (etat.largeur + etat.gouttiere) + geste.dx) + "px)";
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
    if (!etat.livre || ev.target.tagName === "INPUT" || ev.target.tagName === "SELECT") return;
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
  $("btn-prec-chap").addEventListener("click", () => {
    arreterLecture();
    afficherChapitre(etat.page > 0 ? etat.chap : Math.max(etat.chap - 1, 0));
    sonPage();
  });
  $("btn-suiv-chap").addEventListener("click", () => {
    arreterLecture();
    if (etat.chap < etat.livre.chapitres.length - 1) { afficherChapitre(etat.chap + 1); sonPage(); }
  });

  function remplirSommaire() {
    const liste = $("liste-chapitres");
    liste.innerHTML = "";
    etat.livre.chapitres.forEach((ch, c) => {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.innerHTML = '<span class="n">' + (ch.num === 0 ? "Prologue" : "Ch. " + ch.num) + "</span><span>" + echapper(ch.titre) + "</span>";
      b.addEventListener("click", () => {
        arreterLecture();
        fermerPanneaux();
        afficherChapitre(c);
        sonPage();
      });
      li.appendChild(b);
      liste.appendChild(li);
    });
  }

  function marquerSommaire() {
    $("liste-chapitres").querySelectorAll("li").forEach((li, c) => li.classList.toggle("courant", c === etat.chap));
  }

  function appliquerPrefs() {
    document.documentElement.style.setProperty("--taille", prefs.taille + "px");
    document.documentElement.dataset.theme = prefs.theme;
    const couleurs = { papier: "#f4ecd8", clair: "#ffffff", nuit: "#15130f" };
    document.querySelector('meta[name="theme-color"]').content = couleurs[prefs.theme] || couleurs.papier;
    document.querySelectorAll("#choix-theme button").forEach((b) => b.classList.toggle("actif", b.dataset.theme === prefs.theme));
    $("opt-son").checked = prefs.son;
    $("vitesse").value = prefs.vitesse;
    $("val-vitesse").textContent = (+prefs.vitesse).toFixed(1).replace(".", ",");
    ecrire(CLE_PREFS, prefs);
  }

  function changerTaille(delta) {
    const bloc = blocVisible();
    prefs.taille = Math.min(Math.max(prefs.taille + delta, 14), 30);
    appliquerPrefs();
    afficherChapitre(etat.chap, { para: bloc });
  }
  $("btn-taille-moins").addEventListener("click", () => changerTaille(-1));
  $("btn-taille-plus").addEventListener("click", () => changerTaille(1));
  document.querySelectorAll("#choix-theme button").forEach((b) =>
    b.addEventListener("click", () => { prefs.theme = b.dataset.theme; appliquerPrefs(); }));
  $("opt-son").addEventListener("change", (ev) => { prefs.son = ev.target.checked; appliquerPrefs(); });
  $("vitesse").addEventListener("input", (ev) => { prefs.vitesse = +ev.target.value; appliquerPrefs(); });
  $("choix-voix").addEventListener("change", (ev) => { prefs.voix = ev.target.value; appliquerPrefs(); });

  $("btn-oublier").addEventListener("click", () => {
    arreterLecture();
    ecrire(CLE_STOCKEE, null);
    location.reload();
  });

  /* ---------- Lecture à voix haute ---------- */

  const synth = window.speechSynthesis;
  const lecture = { actif: false, bloc: -1, morceaux: [], n: 0, generation: 0, enCours: null, verrouEcran: null };

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
    synth.addEventListener ? synth.addEventListener("voiceschanged", remplirVoix) : (synth.onvoiceschanged = remplirVoix);
  } else {
    $("btn-lire").disabled = true;
    $("btn-lire").title = "Lecture à voix haute indisponible sur ce navigateur";
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
    lecture.bloc = i;
    surligner(i);
    const texte = enTexte(etat.livre.chapitres[etat.chap].blocs[i].x);
    lecture.morceaux = decouper(texte);
    lecture.n = 0;
    ecrire(CLE_POSITION, { c: etat.chap, p: i });
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
      if (pause) setTimeout(() => lireBloc(suivant), 900);
      else lireBloc(suivant);
      return;
    }
    // Fin du chapitre : on enchaîne sur le suivant
    if (etat.chap < etat.livre.chapitres.length - 1) {
      afficherChapitre(etat.chap + 1);
      sonPage();
      const ch = etat.livre.chapitres[etat.chap];
      const annonce = (ch.num === 0 ? "Prologue" : "Chapitre " + ch.num) + ". " + ch.titre + ".";
      setTimeout(() => {
        if (!lecture.actif) return;
        parler(annonce, () => setTimeout(() => {
          const l = blocsLisibles(etat.chap);
          if (l.length) lireBloc(l[0]); else arreterLecture();
        }, 700));
      }, 1200);
    } else {
      arreterLecture();
    }
  }

  async function demarrerLecture() {
    if (!synth) return;
    lecture.generation++;
    synth.cancel();
    lecture.actif = true;
    $("btn-lire").textContent = "■";
    $("btn-lire").title = "Arrêter la lecture";
    $("mini-lecteur").hidden = false;
    masquerBarre();
    garderEcranAllume();
    let depart = blocVisible();
    const liste = blocsLisibles(etat.chap);
    if (depart < 0) depart = liste[0];
    if (depart == null) { arreterLecture(); return; }
    lireBloc(depart);
  }

  function arreterLecture() {
    if (!lecture.actif) return;
    lecture.actif = false;
    lecture.generation++;
    if (synth) synth.cancel();
    surligner(-1);
    $("btn-lire").textContent = "▶";
    $("btn-lire").title = "Lire à voix haute";
    $("mini-lecteur").hidden = true;
    if (lecture.verrouEcran) { lecture.verrouEcran.release().catch(() => {}); lecture.verrouEcran = null; }
    memoriserPosition();
  }

  $("btn-lire").addEventListener("click", () => (lecture.actif ? arreterLecture() : demarrerLecture()));
  $("btn-mini-stop").addEventListener("click", arreterLecture);

  // Empêche l'écran de se mettre en veille pendant la lecture (sinon la voix s'arrête)
  async function garderEcranAllume() {
    if (!("wakeLock" in navigator) || lecture.verrouEcran) return;
    try {
      const v = await navigator.wakeLock.request("screen");
      v.addEventListener("release", () => { if (lecture.verrouEcran === v) lecture.verrouEcran = null; });
      lecture.verrouEcran = v;
    } catch (e) { /* pas grave */ }
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && lecture.actif) garderEcranAllume();
  });
  window.addEventListener("beforeunload", () => { if (synth) synth.cancel(); });

  /* ---------- Hors ligne ---------- */

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  demarrer();
})();
