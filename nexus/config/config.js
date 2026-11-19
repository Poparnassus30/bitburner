/** @param {NS} ns */

export const CONFIG = {
    source: "home",

    // Inspection du réseau toutes les 60 secondes
    refresh: 60000,

    // RAM réservée sur home
    reserveHome: 8,

    // Registre des déploiements
    registry: "nexus/data/registry.txt",

    // Mode simulation : aucune modification du réseau
    dryRun: true,

    // Serveurs autorisés pour le test.
    // Tableau vide = tous les serveurs.
    deployHosts: []
};
