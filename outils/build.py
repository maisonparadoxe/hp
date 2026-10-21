#!/usr/bin/env python3
"""Construit book.enc.json (le livre chiffré) à partir des fichiers .txt du manuscrit.

Usage :
    python3 outils/build.py --source ../knowledge --sortie book.enc.json
Le mot de passe est demandé au clavier (ou lu dans la variable BOOK_PASSWORD).
"""
import argparse, base64, getpass, glob, json, os, re

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

TITRE = "Les Ombres du désespoir"
ITERATIONS = 310000


def lire_chapitre(chemin):
    blocs = [b.strip() for b in re.split(r"\n\s*\n", open(chemin, encoding="utf-8").read())]
    blocs = [b for b in blocs if b]
    entete = blocs.pop(0)
    m = re.match(r"(?:CHAPITRE\s+(\d+)|PROLOGUE)\s*[-–]\s*(.+)", entete)
    if not m:
        raise SystemExit(f"En-tête inattendu dans {chemin} : {entete!r}")
    numero = int(m.group(1)) if m.group(1) else 0
    contenu = []
    for b in blocs:
        if re.match(r"^Fin du (chapitre|prologue)", b, re.I):
            continue
        if b == "---":
            if contenu and contenu[-1] != {"t": "break"}:
                contenu.append({"t": "break"})
            continue
        contenu.append({"t": "p", "x": " ".join(b.split("\n"))})
    while contenu and contenu[-1] == {"t": "break"}:
        contenu.pop()
    return {
        "num": numero,
        "label": "Prologue" if numero == 0 else f"Chapitre {numero}",
        "titre": m.group(2).strip(),
        "ambiance": None,  # réservé pour la musique de fond (plus tard)
        "blocs": contenu,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True)
    ap.add_argument("--sortie", default="book.enc.json")
    a = ap.parse_args()

    fichiers = sorted(glob.glob(os.path.join(a.source, "Chapitre*.txt")))
    prologue = os.path.join(a.source, "Prologue.txt")
    if os.path.exists(prologue):
        fichiers.insert(0, prologue)
    chapitres = [lire_chapitre(f) for f in fichiers]
    livre = {"titre": TITRE, "chapitres": chapitres}

    mdp = os.environ.get("BOOK_PASSWORD") or getpass.getpass("Mot de passe : ")
    sel, iv = os.urandom(16), os.urandom(12)
    cle = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=sel, iterations=ITERATIONS).derive(mdp.encode("utf-8"))
    donnees = AESGCM(cle).encrypt(iv, json.dumps(livre, ensure_ascii=False).encode("utf-8"), None)
    b64 = lambda x: base64.b64encode(x).decode()
    json.dump({"v": 1, "iter": ITERATIONS, "sel": b64(sel), "iv": b64(iv), "data": b64(donnees)},
              open(a.sortie, "w"))
    mots = sum(len(b["x"].split()) for c in chapitres for b in c["blocs"] if b["t"] == "p")
    print(f"{len(chapitres)} parties, {mots} mots, écrit dans {a.sortie}")


if __name__ == "__main__":
    main()
