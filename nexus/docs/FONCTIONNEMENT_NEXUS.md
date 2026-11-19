# NEXUS — Fonctionnement actuel et évolution envisagée

> **Document de référence technique — 19 novembre 2026**  
> État analysé : dépôt `Poparnassus30/bitburner`, branche `dev/sync-v0.2.0`.  
> **Important :** ce document décrit d'abord le **code réellement présent** dans le dépôt. La stratégie future est volontairement isolée dans la seconde partie. La configuration locale du jeu et les processus déjà en mémoire peuvent différer du contenu du dépôt.

## 1. Objectif et périmètre

**NEXUS** est un ensemble de scripts Netscript/JavaScript exécutés dans Bitburner. Son rôle actuel consiste à :

1. découvrir les serveurs du réseau ;
2. obtenir les accès `root` quand les outils nécessaires sont disponibles ;
3. repérer les machines disposant de RAM ;
4. installer et maintenir à jour un worker de hacking ;
5. superviser les ressources, processus, versions et caractéristiques financières des cibles.

Deux notions **distinctes** :

- **Serveur d'exécution (host)** : machine avec accès root et RAM utilisable pour exécuter un programme ;
- **Serveur cible (target)** : machine visée par `hack`, `grow` ou `weaken`. Elle n'a pas besoin d'héberger le worker.

Un serveur peu rentable comme cible peut rester utile comme **fournisseur de RAM**. Un serveur riche mais sans RAM peut rester une excellente **cible**.

## 2. Arborescence du code

```text
nexus/
├── master.js                    # Orchestration de l'inventaire et des déploiements
├── dashboard.js                 # Supervision console graphique (tail)
├── config/
│   ├── config.js                # Source, fréquence, réserve RAM, simulation
│   └── workers.js               # Catalogue des workers gérés
├── core/
│   ├── network.js               # Exploration du réseau
│   ├── access.js                # Ouverture des ports et nuke
│   ├── resources.js             # RAM libre, calcul du nombre de threads
│   ├── processes.js             # Processus et version exécutée
│   ├── targeting.js             # Squelette uniquement : non opérationnel
│   └── scheduler.js             # Squelette uniquement : non opérationnel
├── services/
│   ├── deployment.js            # Comparaison des versions et déploiement
│   ├── registry.js              # Journal des déploiements
│   └── versions.js              # Lecture et comparaison des versions
└── workers/
    └── hack.js                  # Boucle weaken/grow/hack
```

Dans Bitburner, le registre runtime est dans `nexus/data/registry.txt`. Il **n'est pas suivi par Git**.

## 3. Configuration enregistrée dans le dépôt

Fichier `nexus/config/config.js` :

| Paramètre | Valeur dans Git | Conséquence |
| --- | --- | --- |
| `source` | `home` | MASTER ne doit fonctionner que sur home |
| `refresh` | `60000` ms | Inspection toutes les 60 secondes |
| `reserveHome` | `8` Go | Réserve utilisée dans le calcul de threads sur home |
| `registry` | `nexus/data/registry.txt` | Registre persistant local au jeu |
| `dryRun` | `true` | Simulation par défaut dans ce code enregistré |
| `deployHosts` | `[]` | Tous les hosts autorisés (dans le code, tableau vide = aucun filtre) |

Fichier `nexus/config/workers.js` : **un seul worker actif** :

- `name` : `Hacking automatique` ;
- `file` : `/nexus/workers/hack.js` ;
- `enabled` : `true` ;
- `autoUpdate` : `true` ;
- `target` : **`n00dles`**, cible statique.

**Attention :** `dryRun: true` interdit de nouveaux changements, mais les workers **déjà exécutés continuent à travailler** indépendamment de MASTER. La configuration est importée au lancement : modifier `config.js` ne change pas automatiquement un processus MASTER déjà actif.

## 4. Séquence réelle de MASTER

Programme : `nexus/master.js`, `VERSION = 2`.

1. Désactive les logs automatiques de MASTER.
2. Refuse de fonctionner ailleurs que sur `home`.
3. Lit le registre avec `loadRegistry()` une fois au démarrage.
4. Lance une boucle infinie :
   - `discoverNetwork(ns, "home")` explore tous les voisins par parcours en largeur (BFS), sans doublons ;
   - applique éventuellement `deployHosts` ;
   - `acquireRoot()` vérifie les droits root ; en mode réel, essaie `BruteSSH.exe`, `FTPCrack.exe`, `relaySMTP.exe`, `HTTPWorm.exe`, `SQLInject.exe` selon les outils possédés, puis `nuke()` si les conditions sont réunies ;
   - ignore un serveur sans root ou avec `getServerMaxRam(host) <= 0` ;
   - passe chaque worker activé à `inspectWorker()` ;
   - attend 60 secondes et recommence.
5. Les erreurs sont affichées dans les logs, sans interrompre systématiquement la boucle générale.

**Limite actuelle :** le MASTER ne sélectionne pas de cible. Il utilise la cible du fichier de configuration. L'analyse financière du dashboard ne commande aucune décision de MASTER.

## 5. Ressources, déploiement et versions

### 5.1 Calcul des threads

`core/resources.js` calcule :

```text
RAM libre = max(0, RAM max - RAM utilisée - réserve éventuelle)
RAM récupérable = RAM occupée par les processus concernés par un remplacement
Threads possibles = floor((RAM libre + RAM récupérable) / coût RAM du worker)
```

La réserve ne s'applique que sur `home`. Les serveurs sans capacité d'au moins un thread ne reçoivent pas de worker.

### 5.2 Déploiement

`services/deployment.js` :

1. Lit la version source du worker depuis `home`.
2. Ignore une source absente ou V0.
3. Liste les processus exécutant le même chemin de worker sur le host.
4. Compare leur version annoncée dans les logs, ou celle enregistrée par PID dans le registre.
5. Détermine s'il manque un worker ou si une mise à jour est nécessaire.
6. Refuse une version exécutée supérieure à la source, et respecte `autoUpdate: false`.
7. Calcule la capacité RAM, préserve les arguments et les threads des processus existants.
8. En simulation, **affiche l'opération prévue sans copier, arrêter ou démarrer**.
9. En mode réel, copie le worker à distance si nécessaire, arrête les anciens processus concernés, lance les nouveaux, puis enregistre leurs PID, version, arguments et threads.

Le code actuel n'implémente **ni rollback automatique**, ni vérification de survie du worker après `ns.exec()`, ni stratégie d'allocation entre plusieurs cibles.

**Point technique à vérifier lors d'une évolution :** dans la version lue, l'appel `ns.scp(...)` de `deployment.js` n'est pas précédé de `await`, tandis que le résultat est traité comme une réussite booléenne. Vérifier et corriger cette séquence avant de durcir les déploiements.

### 5.3 Trois versions dans le dashboard

| Champ | Sens actuel | Origine |
| --- | --- | --- |
| `V.SOURCE` | Version de référence | Déclaration `export const VERSION = N` dans le fichier de home |
| `V.HOTE` | Version déclarée comme déployée | Registre MASTER (pour les hôtes distants) ; sur home, source |
| `V.EXEC` | Version de l'instance active | Log `MASTER_VERSION:N`, avec repli sur le registre par PID |

Sans `VERSION` dans le fichier, `versions.js` retourne V0. Une version `? ` indique l'absence d'information vérifiable selon la logique actuelle ; `V.HOTE` reste une **déclaration de déploiement**, pas une mesure cryptographique du contenu distant.

## 6. Worker réellement exécuté : hack.js V2

`nexus/workers/hack.js` annonce `MASTER_VERSION:2`, reçoit sa cible dans le premier argument (par défaut `n00dles`) puis boucle indéfiniment :

```text
Si sécurité actuelle > sécurité minimale + 5 :
    await ns.weaken(cible)
Sinon si argent disponible < 75 % de l'argent maximum :
    await ns.grow(cible)
Sinon :
    await ns.hack(cible)
Recommencer
```

**Conséquence :** le worker sait déjà réduire la sécurité et reconstituer l'argent, mais **chaque worker prend cette décision localement**, sans coordination centrale ni score global de rentabilité. L'algorithme ne gère pas encore la distribution optimale des threads entre hacking, croissance et affaiblissement.

## 7. Dashboard V5 : ce qui est réellement affiché

`nexus/dashboard.js` ouvre une fenêtre `tail` de 1450 × 750 et se rafraîchit toutes les **2 secondes**.

| Tableau | Informations |
| --- | --- |
| **01 — GÉNÉRAL** | Mode déclaré de MASTER, niveau de hacking, argent de home, nombre de serveurs/root, processus, threads, RAM et état des versions |
| **02 — SERVEURS** | Serveur, root, RAM maximale/utilisée/libre, occupation, nombre de processus et de threads |
| **03 — PROCESSUS** | Serveur, PID, chemin du programme, cible, threads, RAM consommée, V.SOURCE, V.HOTE, V.EXEC, état |
| **04 — FINANCES / CIBLES** | Argent actuel/maximal, remplissage, sécurité, niveau requis, chance de hack, threads actuellement dirigés vers la cible, root |

Le tableau financier est trié par **argent maximal décroissant**. Il ne sélectionne pas lui-même les cibles.

Le mode affiché `SIMULATION` / `DÉPLOIEMENT ACTIF` repose sur `CONFIG.dryRun` lu par le dashboard et sur la présence du processus MASTER : **il ne prouve pas forcément le mode réel de MASTER si les deux programmes n'ont pas été redémarrés après un changement de configuration**.

## 8. Infrastructure de développement et sauvegardes

```text
GitHub (versions, commits et tags)
     ↕ git pull / commit / push
VS Code (source de développement)
     ↓ bitburner-sync/main.py push
Bitburner home/nexus (code déployé)
     ↓ MASTER + services/deployment
Autres serveurs du jeu (workers exécutés)
```

`bitburner-sync` est **un outil Python distinct de NEXUS** : il lit, compare et transmet les sources via la Remote API WebSocket locale de Bitburner. Les opérations `import`, `status`, `diff` et `push` sont documentées et testées pendant le développement.

Conventions retenues :

- Modifier le code **dans VS Code**, pas dans l'éditeur Bitburner.
- Utiliser Git comme historique et restauration du **code**, pas comme sauvegarde complète de l'état du jeu.
- Avant d'écraser un fichier distant : contrôler la référence de synchronisation et afficher les conflits.
- Un `pushFile` n'implique pas le redémarrage automatique du MASTER ou du dashboard déjà en cours d'exécution.
- Les versions `VERSION=N` sont **manuelles**, distinctes des versions/tags Git.
- Préserver `nexus/data/registry.txt` hors du dépôt Git.

## 9. Limitations actuelles — inventaire explicite

| Sujet | État |
| --- | --- |
| Découverte de tous les serveurs | **Implémenté** |
| Acquisition root avec outils disponibles | **Implémenté** (désactivé en simulation pour nouveaux accès) |
| Utilisation de la RAM des hosts rootés | **Implémenté** pour un worker configuré |
| Mise à jour automatique des versions de workers | **Implémenté**, avec limites de robustesse |
| Supervision détaillée | **Implémenté** |
| Classement financier dans le dashboard | **Implémenté**, informatif |
| Sélection dynamique de la meilleure cible | **Non implémenté** |
| Optimisation du rendement réel $/s | **Non implémenté** |
| Répartition multi-cibles coordonnée | **Non implémenté** |
| Scheduler global hack/grow/weaken | **Non implémenté** |
| Gestion des tâches en cours, réservations de threads et rollback | **Non implémenté** |
| `core/targeting.js` et `core/scheduler.js` | **Fichiers présents, squelettes sans logique** |

---

# PARTIE II — Vision de développement (NON implémentée)

## 10. Objectif général

> NEXUS doit **observer à l'instant T**, exploiter les ressources des serveurs disponibles, identifier les **cibles attaquables et intéressantes**, puis réévaluer ses décisions à mesure que les conditions changent.

La rentabilité ne se réduit pas à `maxMoney`. Il faudra prendre en compte : argent actuel, argent maximal, chance de réussite, temps du hack, proportion volée par thread, sécurité, niveau requis, temps et coût en RAM de `grow` / `weaken` ainsi que capacité totale du réseau.

**Règle structurante :** ne jamais exclure de l'usage de calcul un host rooté sous prétexte qu'il n'a pas d'argent à voler.

## 11. Proposition d'états pour chaque cible

| État proposé | Détection | Action envisagée |
| --- | --- | --- |
| `INACCESSIBLE` | Pas de root / niveau insuffisant | Observer ; réévaluer l'accessibilité |
| `NON_FINANCIERE` | `maxMoney = 0` | Ne pas cibler pour l'argent ; exploiter sa RAM si disponible |
| `A_AFFAIBLIR` | Sécurité trop élevée par rapport à un seuil | Planifier `weaken`, ou attendre **si un affaiblissement est déjà en cours** |
| `A_RECONSTITUER` | Argent actuel insuffisant | Planifier `grow` et le `weaken` compensatoire |
| `EXPLOITABLE` | Conditions d'accès, de sécurité et d'argent satisfaisantes | Évaluer rendement et capacité, puis `hack` |
| `EN_OPERATION` | Travaux déjà assignés | Attendre leur résultat / ne pas doubler sans nécessité |
| `SURVEILLANCE` | Faible rentabilité relative ou ressources insuffisantes | Conserver en observation, réévaluer |

**Important :** une sécurité trop élevée **ne diminue pas automatiquement du seul fait d'attendre**. En pratique, il faut généralement réaliser `weaken`, sauf si des workers le font déjà. La décision intelligente est donc : **attendre un `weaken` déjà planifié, ou mobiliser des ressources pour l'obtenir**.

## 12. Répartition des responsabilités visée

- **`targeting.js`** : inventaire et états des cibles, admissibilité, indicateurs financiers, classement de rendement estimé.
- **`resources.js`** : vue complète et continuellement actualisée de la RAM réellement réservable par host.
- **`scheduler.js`** : choix des opérations, des serveurs d'exécution, des cibles, des threads et du moment d'exécution ; prise en compte des opérations déjà lancées.
- **`master.js`** : coordination, cycles de décision, supervision des erreurs et activation en simulation / réel.
- **Workers** : exécuter une opération assignée ; des workers spécialisés `hack`, `grow`, `weaken` pourront remplacer ou compléter la boucle autonome actuelle.
- **Dashboard** : rendre observables les décisions, tâches en cours, allocations, estimations et résultats, sans confondre métriques estimées et gains réels.

## 13. Cas de configuration à couvrir avant d'automatiser

1. Cible riche mais sécurité élevée : lancer ou attendre les `weaken` requis.
2. Cible riche mais vide : prévoir `grow`, ainsi que son impact sur la sécurité.
3. Cible accessible, prête, mais rendement inférieur à une autre : prioriser selon le rendement estimé **et le coût d'opportunité**.
4. Host rooté sans argent : l'utiliser comme machine d'exécution si sa RAM est disponible.
5. Cible sans RAM : l'attaquer depuis un autre host.
6. Peu de RAM globale : éviter les opérations trop fragmentées et conserver les réserves nécessaires.
7. Plusieurs cibles intéressantes : décider explicitement mono-cible ou multi-cibles selon la capacité.
8. Opération déjà en cours : éviter les doublons et la surcharge.
9. Nouveau root ou changement de niveau de hacking : recalculer les cibles éligibles.
10. Échec d'un worker / version obsolète : préserver l'observabilité, restaurer une capacité de calcul utilisable.

## 14. Méthode de développement proposée

**Phase A — Observation (aucun changement d'exécution)** : produire l'inventaire des hosts et cibles, les états et classements. Comparer les recommandations aux mesures du dashboard.

**Phase B — Planification simulée** : concevoir un scheduler qui affecte virtuellement les threads et les opérations, en contrôlant les contraintes et les missions déjà actives.

**Phase C — Exécution encadrée** : introduire des workers adaptés et des déploiements ciblés sur peu de serveurs, en gardant le comportement actuel comme référence.

**Phase D — Optimisation et mesure** : suivre le gain réel, la durée, les coûts RAM, la sécurité et le résultat de chaque mission ; faire évoluer la stratégie sur des indicateurs observés.

### Décision à conserver

**Ne pas coder la stratégie d'attaque avant d'avoir une vue d'ensemble fiable des hosts, des cibles et des tâches déjà actives.** Le principe est d'abord *analyser*, puis *planifier*, enfin *exécuter*.

---

## 15. Sources et traçabilité

Document établi après lecture de tous les scripts `nexus/` de la branche `dev/sync-v0.2.0`, le 19/11/2026. La seconde partie est une **spécification de travail proposée**, non une description du fonctionnement existant.

Références Git :

- `nexus-v1.0.0-signed` : référence initiale signée du code NEXUS ;
- `sync-v0.1.0-diagnostic` : synchroniseur et historique de diagnostic ;
- `dev/sync-v0.2.0` : branche de développement en cours.

Pour préserver cet état : conserver le présent document dans Git et effectuer la validation et le commit/tag signés depuis `POPARNASSUSWIN`.
