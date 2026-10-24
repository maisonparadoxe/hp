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

- À la première ouverture, on choisit son marque-page parmi les quatre maisons (on peut en changer depuis l'accueil). Ensuite, chaque ouverture propose **Lire** ou **Écouter**.
- Le marque-page se pose tout seul quand on quitte le livre (bouton ‹ en haut, ou en changeant d'appli) : un ruban aux couleurs de la maison pend sur la page où l'on s'est arrêté, et l'accueil indique le chapitre.
- En mode **Écouter**, un lecteur en bas de l'écran permet pause, paragraphe précédent ou suivant, vitesse, et de repasser en lecture.

- Toucher le bord droit ou glisser vers la gauche : page suivante. Bord gauche ou glisser vers la droite : page précédente.
- Toucher le milieu : barre d'outils (sommaire, réglages, curseur dans le chapitre, lecture à voix haute).
- Lecture à voix haute : elle commence au marque-page ou à la page affichée, surligne le paragraphe lu, tourne les pages et enchaîne les chapitres. L'écran reste allumé pendant la lecture (si l'écran se verrouille, la voix s'arrête : c'est une limite des navigateurs). La voix et la vitesse se règlent dans **Aa**. Les voix disponibles dépendent du téléphone ; sur Android, les voix Google « français (France) » sont les plus naturelles (Paramètres > Synthèse vocale).
- **Verrouiller et oublier cet appareil** (dans Aa) efface la clé mémorisée.

## Effets

- Écran du mot de passe : la couverture, puis une phrase qui s'écrit à l'encre façon carte du Maraudeur. Toucher l'écran fait tout apparaître tout de suite.
- En ouvrant le livre (Lire ou Écouter) : un voyage dans la couverture (la lune, le visage, puis l'œil du loup), qui plonge vers la page. Toucher l'écran ou « Passer » l'abrège.
- Début de chapitre : le titre se dépose à l'encre, l'ornement se trace, la première lettre devient une lettrine aux couleurs de la maison.
- Papier vieilli et bords assombris ; en mode nuit, une lueur de bougie qui vacille à peine.
- Paillettes dorées au choix de la maison et à chaque fin de chapitre.
- La page se soulève et tourne en 3D, elle suit le doigt et retombe si on la lâche avant la moitié.
- Tout se coupe dans **Aa > Effets visuels** (coupé d'office si le téléphone demande moins d'animations).

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
