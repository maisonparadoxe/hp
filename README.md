# Liseuse

Site statique pour relire le livre sur téléphone : pages qu'on tourne (avec le bruit du papier), lecture à voix haute, sommaire, mode nuit, taille du texte, reprise là où on s'est arrêté. Le texte est chiffré : sans le mot de passe, le fichier `book.enc.json` est illisible.

## Mettre en ligne sur GitHub Pages

1. Sur github.com, créer un nouveau dépôt (par exemple `liseuse`). Il peut être public : le livre est chiffré. Un nom de dépôt neutre est plus discret.
2. Dans le dépôt : **Add file > Upload files**, glisser **tout le contenu** de ce dossier (y compris `book.enc.json`, `sw.js` et le fichier `.nojekyll`), puis **Commit changes**.
   Le dossier `outils` n'est pas nécessaire en ligne, mais il ne gêne pas.
3. **Settings > Pages** : Source = *Deploy from a branch*, Branch = `main`, dossier `/ (root)`, **Save**.
4. Une minute plus tard, le site est à l'adresse `https://VOTRE-NOM.github.io/liseuse/`.

Sur le téléphone : ouvrir l'adresse, taper le mot de passe (cocher « Se souvenir de cet appareil » pour ne plus le retaper). Dans le menu du navigateur, **Ajouter à l'écran d'accueil** donne une icône comme une appli, et le livre reste lisible sans connexion une fois ouvert.

## Utilisation

- Toucher le bord droit ou glisser vers la gauche : page suivante. Bord gauche ou glisser vers la droite : page précédente.
- Toucher le milieu : barre d'outils (sommaire, réglages, curseur dans le chapitre, lecture à voix haute).
- Lecture à voix haute : bouton ▶. Elle commence à la page affichée, surligne le paragraphe lu, tourne les pages et enchaîne les chapitres. L'écran reste allumé pendant la lecture (si l'écran se verrouille, la voix s'arrête : c'est une limite des navigateurs). La voix et la vitesse se règlent dans **Aa**. Les voix disponibles dépendent du téléphone ; sur Android, les voix Google « français (France) » sont les plus naturelles (Paramètres > Synthèse vocale).
- **Verrouiller et oublier cet appareil** (dans Aa) efface la clé mémorisée.

## Mettre à jour le texte du livre

Quand le manuscrit change, il faut regénérer `book.enc.json` (Python 3 et le paquet `cryptography` requis) :

```
python3 outils/build.py --source ../knowledge --sortie book.enc.json
```

Le mot de passe est demandé au clavier. Puis remplacer `book.enc.json` dans le dépôt GitHub. Après une mise à jour, le téléphone redemandera le mot de passe une fois.

Pour changer de mot de passe : relancer la même commande avec le nouveau.

## Musique (plus tard)

Chaque chapitre a déjà un champ `ambiance` (vide pour l'instant) et `app.js` contient la fonction `setAmbiance()` prévue pour lancer la bonne musique au changement de chapitre.

## Sécurité, honnêtement

Le chiffrement (AES-256, clé dérivée du mot de passe) est solide, mais il ne vaut que ce que vaut le mot de passe : quelqu'un qui récupère `book.enc.json` peut essayer des mots de passe sans limite. Un mot de passe long et personnel protège vraiment ; un mot connu se devine.
