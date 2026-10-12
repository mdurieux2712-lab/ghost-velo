# Ghost Vélo 🚴‍♂️👻

Application iPhone pour **rouler contre son propre fantôme**. On enregistre un parcours une première fois. Ensuite, à chaque nouvelle sortie sur ce parcours, l'écran indique en temps réel l'avance ou le retard sur la référence :

- **vert** quand on est en avance, avec par exemple `+12 s` et `+85 m` ;
- **rouge** quand on est en retard.

L'app ne demande ni Mac, ni App Store, ni abonnement. C'est une application web installable (PWA) : on l'ouvre dans Safari, puis on l'ajoute à l'écran d'accueil.

---

## 1. Mettre l'app en ligne (≈ 10 minutes, gratuit)

L'iPhone n'autorise le GPS que pour une page servie en **HTTPS**. GitHub Pages fournit cet hébergement gratuitement.

1. Crée un compte sur **https://github.com** (gratuit).
2. En haut à droite, clique sur **+ → New repository**.
   - Repository name : `ghost-velo`
   - Choisis **Public** (obligatoire pour GitHub Pages gratuit)
   - Clique sur **Create repository**.
3. Sur la page du dépôt vide, clique sur **uploading an existing file**.
4. Glisse **le contenu** du dossier `ghost-velo` : `index.html`, `app.js`, `engine.js`, `sw.js`, `manifest.webmanifest`, `README.md` et le dossier `icons`. Il faut glisser les fichiers eux-mêmes, pas le .zip. Puis clique sur **Commit changes**.
   - Si le dossier `icons` ne passe pas par glisser-déposer, utilise **Add file → Upload files** une deuxième fois en glissant le dossier `icons` entier.
5. Va dans **Settings → Pages**.
   - Source : **Deploy from a branch**
   - Branch : **main**, dossier **/ (root)**, puis **Save**.
6. Patiente 1 à 2 minutes. L'adresse de l'app s'affiche en haut de la page :
   `https://TON-PSEUDO.github.io/ghost-velo/`

**Vérification depuis le PC :** ouvre cette adresse dans Chrome, appuie sur « Parcours démo », puis « ⋯ » → « Simuler une course » → « Accélérée ×10 ». Un cycliste virtuel parcourt la boucle et l'écran passe du vert au rouge.

## 2. Installer l'app sur l'iPhone

1. Sur l'iPhone, ouvre **Safari** (pas Chrome) et va à l'adresse de l'app.
2. Appuie sur le bouton **Partager** (le carré avec la flèche), puis **Sur l'écran d'accueil → Ajouter**.
3. Lance l'app **depuis son icône**. Les parcours seront alors bien conservés.
4. Au premier enregistrement, l'iPhone demande l'accès à la position : réponds **Autoriser**.
   - Si l'accès a été refusé, va dans Réglages → Confidentialité et sécurité → Service de localisation → **Sites web Safari**, choisis « Lorsque l'app est active » et active **Position exacte**.

## 3. Utilisation

**Créer un fantôme**

1. Appuie sur **● Enregistrer un parcours**.
2. Attends le message « PRÊT » : le GPS est calé.
3. Pars. Le chrono démarre tout seul dès que tu roules.
4. À l'arrivée, appuie **deux fois** sur « Arrêter », puis donne un nom au parcours.

**Rouler contre le fantôme**

1. Choisis le parcours, puis **▶ Rouler contre ce fantôme**.
2. Rejoins le point de départ. L'écran affiche la distance qui t'en sépare, puis « PRÊT ».
3. Élance-toi. Le chrono part quand tu franchis la ligne et s'arrête tout seul à l'arrivée.
4. Si tu bats le fantôme, tu peux faire de ce temps le nouveau fantôme.

**Autres fonctions**

- **Importer un GPX** : utilise une ancienne sortie comme fantôme. Sur Strava, ouvre une activité puis choisis « ⋯ → Exporter GPX ». Le fichier doit contenir les horaires, ce qui est le cas d'une activité mais pas d'un simple itinéraire.
- **⋯ → Exporter en GPX** : sauvegarde un parcours. Les données ne sont stockées que dans le téléphone.
- **⚙︎ Réglages** : active ou coupe les bips (quand on passe devant ou derrière) et l'annonce vocale à chaque kilomètre.

**À savoir**

- Garde **l'app ouverte, écran allumé**. Sur iPhone, une app web ne reçoit plus le GPS quand on change d'app ou qu'on verrouille l'écran. L'app empêche la mise en veille automatique ; en cas de problème, règle Réglages → Luminosité → Verrouillage auto sur « Jamais » le temps de la sortie.
- Le **bouton silencieux** de l'iPhone coupe les bips.
- L'écran étant allumé en permanence, pense à la batterie sur les longues sorties.

---

## 4. Comment ça marche (pour modifier le code)

| Fichier | Rôle |
|---|---|
| `engine.js` | Le calcul : projection GPS sur la trace, interpolation, enregistreur, détection départ et arrivée, lecture et écriture GPX. Aucun affichage. |
| `app.js` | Les écrans, le GPS, les bips et la voix, le stockage (IndexedDB), le simulateur. |
| `index.html` | La mise en page et le style. |
| `sw.js` | Permet à l'app de s'ouvrir sans réseau. |

**L'algorithme, à chaque position GPS :**

1. La position est **projetée orthogonalement** sur le segment le plus proche de la trace du fantôme. La recherche se limite à une fenêtre autour de la dernière position, ce qui évite de sauter sur l'autre sens d'un aller-retour.
2. On en déduit **D**, la distance parcourue le long de la trace.
3. On interpole l'instant **T_fantôme(D)** où le fantôme avait atteint cette distance.
4. **Δt = T_fantôme(D) − T_toi**, avec Δt > 0 quand on est en avance. L'écart en mètres vaut D_toi − D_fantôme(T).

**Mettre à jour l'app :** modifie les fichiers sur GitHub (bouton ✎ ou nouvel upload). Les iPhones récupèrent la nouvelle version au 2ᵉ lancement de l'app.

**Tester sur PC :** la simulation (« ⋯ → Simuler une course ») fonctionne sans GPS. Pour un serveur local, lance `python -m http.server` dans le dossier puis ouvre `http://localhost:8000`.

**Idées d'évolutions :** fond de carte (Leaflet + OpenStreetMap), meilleur temps par portion du parcours, plusieurs fantômes (record, dernier essai), export vers Strava.
