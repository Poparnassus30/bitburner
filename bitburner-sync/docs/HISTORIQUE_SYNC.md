
# Journal technique — NEXUS Sync

## 2026-11-19 — Première synchronisation validée

### Environnement
- Bitburner v3.0.1
- Windows / PowerShell 5.1
- Python 3.13.14
- websockets 16.1.1
- Remote API : 127.0.0.1:12525, WebSocket non sécurisé (local)
- Dépôt : Poparnassus30/bitburner

### Architecture
- `nexus/` : scripts JavaScript du jeu
- `bitburner-sync/main.py` : outil Python de transfert
- `bitburner-sync/.sync-state.json` : empreintes de référence privées, non versionnées
- Git : historique des modifications de code

### Incidents constatés

**Incident 1 — Conflit artificiel dashboard.js**
- État : 15 identiques, 0 à envoyer, 1 alerte
- Un commentaire ajouté dans VS Code était absent du jeu
- SOURCE, HOTE et BASE avaient trois empreintes différentes
- Les fichiers locaux et distants ne différaient que du commentaire
- Formats vérifiés : LF, sans CRLF, saut de ligne final présent
- Le SHA-256 local sans commentaire correspondait exactement au fichier distant
- Cause du décalage initial de BASE : non encore identifiée

**Incident 2 — Encodage JSON**
- Modification manuelle de `.sync-state.json` depuis PowerShell 5.1
- `Set-Content -Encoding UTF8` a ajouté un BOM
- Erreur : Unexpected UTF-8 BOM
- Correction : réécriture du fichier en UTF-8 sans BOM

### Intervention effectuée
1. Sauvegarde de `.sync-state.json`
2. Vérification du contenu de `dashboard.js`
3. Vérification des SHA-256 et des fins de ligne
4. Actualisation contrôlée de la seule référence `dashboard.js`
5. Confirmation du statut : 15 identiques, 1 à envoyer, 0 alerte
6. Push vers Bitburner avec confirmation
7. Vérification de la présence du commentaire dans Bitburner
8. Vérification finale : 16 identiques, 0 à envoyer, 0 alerte

### Points à traiter
- Identifier pourquoi l'empreinte BASE était périmée
- Nettoyer les diagnostics temporaires
- Ajouter une commande diff
- Rendre l'enregistrement de l'état atomique et robuste
- Empêcher tout écrasement distant sans validation
- Documenter le comportement des scripts déjà en cours d'exécution
- Ajouter des tests de non-régression

### Règle de fonctionnement
VS Code est la source de développement.
Bitburner est la destination de déploiement.
Aucune modification distante ne doit être écrasée silencieusement.
