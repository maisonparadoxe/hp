#!/usr/bin/env python3
"""Prépare les illustrations des chapitres pour la liseuse.

Usage :
    python3 outils/illustrations.py --source ../illustrations [--chiffrer]
Chaque fichier chapitreNN.png (NN = numéro du chapitre) devient images/illustrations/chapitreNN.webp,
ou chapitreNN.bin avec --chiffrer : chiffré avec la même clé que le livre (même mot de passe,
même sel que book.enc.json), pour que seuls les lecteurs qui ont ouvert le livre puissent le voir.
Le mot de passe est demandé au clavier (ou lu dans la variable BOOK_PASSWORD).
"""
import argparse, base64, getpass, glob, io, json, os, re

from PIL import Image

SORTIE = "images/illustrations"
HAUTEUR_MAX = 1400


def cle_du_livre(livre):
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
    fichier = json.load(open(livre))
    mdp = os.environ.get("BOOK_PASSWORD") or getpass.getpass("Mot de passe : ")
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32,
                     salt=base64.b64decode(fichier["sel"]), iterations=fichier["iter"])
    cle = kdf.derive(mdp.encode("utf-8"))
    # Vérifie le mot de passe en ouvrant le livre
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    try:
        AESGCM(cle).decrypt(base64.b64decode(fichier["iv"]), base64.b64decode(fichier["data"]), None)
    except Exception:
        raise SystemExit("Mot de passe incorrect pour " + livre)
    return cle


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True)
    ap.add_argument("--chiffrer", action="store_true")
    ap.add_argument("--livre", default="book.enc.json")
    a = ap.parse_args()

    cle = cle_du_livre(a.livre) if a.chiffrer else None
    os.makedirs(SORTIE, exist_ok=True)
    for ancien in glob.glob(os.path.join(SORTIE, "chapitre*.*")):
        os.remove(ancien)
    liste = {}
    for chemin in sorted(glob.glob(os.path.join(a.source, "chapitre*.png"))):
        num = int(re.search(r"(\d+)", os.path.basename(chemin)).group(1))
        im = Image.open(chemin).convert("RGB")
        if im.height > HAUTEUR_MAX:
            im = im.resize((round(im.width * HAUTEUR_MAX / im.height), HAUTEUR_MAX), Image.LANCZOS)
        tampon = io.BytesIO()
        im.save(tampon, "WEBP", quality=80, method=6)
        donnees = tampon.getvalue()
        nom = "chapitre%02d" % num
        if cle:
            from cryptography.hazmat.primitives.ciphers.aead import AESGCM
            iv = os.urandom(12)
            donnees = iv + AESGCM(cle).encrypt(iv, donnees, None)
            nom += ".bin"
        else:
            nom += ".webp"
        open(os.path.join(SORTIE, nom), "wb").write(donnees)
        liste[str(num)] = nom
        print(nom, len(donnees) // 1024, "Ko")
    json.dump(liste, open(os.path.join(SORTIE, "liste.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
