# Bitburner — NEXUS

Dépôt de développement des scripts Bitburner et d'un synchroniseur local pour Visual Studio Code.

## Environnement documenté

- **Jeu :** Bitburner **3.0.1**, build **3162fd2** (version vue dans les captures ; susceptible d'évoluer).
- **Plateforme :** Windows, application de bureau.
- **Langage :** JavaScript / Netscript.
- **Éditeur souhaité :** Visual Studio Code, sans extension de synchronisation tierce.
- **Ordinateur du jeu :** `home` ; dossiers virtuels, par exemple `nexus/core/`.
- **Remote API :** JSON-RPC 2.0 sur WebSocket. C'est **Bitburner qui se connecte** au serveur WebSocket fourni par notre outil.
- **Connexion de test :** `localhost:12525`, WSS désactivé sur une même machine.

## NEXUS — architecture dans le jeu

```text
nexus/
├── master.js              # Orchestrateur
├── dashboard.js           # Supervision
├── config/                # Configuration et workers
├── core/                  # Découverte, accès, ressources, processus, ciblage
├── services/              # Versions, déploiements, registre
├── workers/               # hack.js et futurs workers
└── data/                  # Registre (état local dans le jeu)
```

Historique des fonctions déjà testées : découverte de 70 serveurs, acquisition de root, déploiement de workers, simulation `dryRun`, colonnes V.SOURCE/V.HOTE/V.EXEC, mise à jour de V1 vers V2, dashboard NEXUS MASTER CONTROL. **Ces scripts NEXUS ne sont pas encore importés dans ce dépôt.**

Deux niveaux distincts : **VS Code → Bitburner home** via `bitburner-sync`, puis **home → serveurs du jeu** via `nexus/master.js`. Mettre à jour un fichier ne redémarre pas à lui seul un processus actif.

## Remote API : méthodes décrites dans Bitburner 3.0.1

| Méthode | Rôle |
| --- | --- |
| `pushFile` | Créer ou modifier un fichier |
| `getFile` | Lire le contenu d'un fichier |
| `getFileNames` | Lister les fichiers d'un serveur |
| `getAllFiles` | Récupérer tous les fichiers et contenus |
| `getFileMetadata`, `getAllFileMetadata` | Métadonnées de fichiers |
| `deleteFile` | Supprimer (non utilisé dans notre prototype) |
| `calculateRam` | Calculer le coût RAM |
| `getDefinitionFile` | Définitions Netscript |
| `getSaveFile` | Sauvegarde du jeu (non utilisé) |
| `getAllServers` | Liste des serveurs (non utilisé) |

Format de commande documenté :

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "pushFile",
  "params": {
    "filename": "nexus/exemple.js",
    "content": "export async function main(ns) { ns.tprint('Bonjour'); }",
    "server": "home"
  }
}
```

## NEXUS Sync : import initial puis envoi unidirectionnel

**VS Code est la source de référence** ; Bitburner sert à exécuter les scripts. Aucune modification automatique des scripts, aucune suppression, aucun redémarrage.

Depuis PowerShell, dans `D:\\github\\bitburner` :

```powershell
python -m venv .venv
.\\.venv\\Scripts\\python.exe -m pip install -r bitburner-sync\\requirements.txt
```

Pour la **première importation seulement** (écrit uniquement dans le dossier local `nexus/`, ne touche pas au jeu) :

```powershell
.\\.venv\\Scripts\\python.exe bitburner-sync\\main.py import
```

Chaque invocation lance un serveur WebSocket local : dans Bitburner, `Options → Remote API`, sélectionner `localhost`, port `12525`, WSS désactivé, puis `Connect`. Si Bitburner est déjà connecté, il suffit de laisser la reconnexion s'effectuer. Le programme demande `oui` avant de copier les scripts vers le dossier local.

**Avant de publier** les scripts importés : examiner les fichiers et les secrets ; ce dépôt est public. Créer alors le commit Git initial depuis VS Code / Git. Le registre `nexus/data/` et le script de test `nexus/sync-connection-test.js` ne sont pas importés.

Inspecter les différences (lecture seule) :

```powershell
.\\.venv\\Scripts\\python.exe bitburner-sync\\main.py status
```

Envoyer les fichiers modifiés depuis VS Code vers `home` (confirmation obligatoire) :

```powershell
.\\.venv\\Scripts\\python.exe bitburner-sync\\main.py push
```

Protection : le premier import enregistre un état de base **local** dans `bitburner-sync/.sync-state.json` (ignoré par Git). Avant chaque envoi, l'outil relit le contenu distant : si ce dernier a changé par rapport à cette base, l'opération est refusée. Les fichiers nouveaux sont créés uniquement s'ils n'existent pas déjà dans le jeu. Chaque fichier envoyé est relu et vérifié.

Ne jamais supprimer `.sync-state.json` après le premier import sans reconstruire explicitement une base commune. Ne pas partager cet état entre PC sans procédure de migration. Le transfert n'est pas atomique entre vérification et écriture : ne pas éditer les mêmes fichiers dans le jeu pendant un déploiement.

## Sécurité

- Écoute **seulement sur 127.0.0.1**.
- Pas d'extension VS Code ni d'accès cloud volontaire.
- Pas de suppression ni de synchronisation automatique.
- `localhost` ne constitue pas une authentification : un autre processus local peut tenter une connexion.
- Un programme Python a les droits de son utilisateur Windows ; la limitation logique des fichiers n'est **pas une isolation système**.
- Vérifier les dépendances et conserver une sauvegarde du jeu avant les évolutions de la synchronisation.
- Le dépôt est actuellement public : **ne jamais y publier de secrets ou sauvegardes personnelles**.

## Feuille de route

1. Tester `getFileNames` en lecture seule, puis `pushFile` sur un fichier dédié.
2. Contrôler le résultat dans le jeu.
3. Importer les fichiers NEXUS en préservant leur contenu.
4. Ajouter une synchronisation manuelle sélective, une comparaison avant envoi et des protections contre l'écrasement.
5. Reprendre `core/targeting.js` et le scheduler, indépendamment du transport des fichiers.
