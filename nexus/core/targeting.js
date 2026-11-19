/** @param {NS} ns
 * NEXUS TARGETING V1 - Analyse seule, aucune attaque ni modification.
 */
import { discoverNetwork } from "/nexus/core/network.js";

export const VERSION = 1;

// Seuils de preparation. Ils pourront etre ajustes apres observation.
export const TARGETING = Object.freeze({
    securityTolerance: 5,
    moneyReadyRatio: 0.75,
    maximumHackFraction: 0.10
});

function finite(value, fallback = 0) {
    return Number.isFinite(value) ? value : fallback;
}

/**
 * Analyse une cible independamment de la machine qui executera le worker.
 * Les scores sont des estimations heuristiques, PAS des revenus garantis.
 */
export function inspectTarget(ns, host, settings = TARGETING) {
    const root = ns.hasRootAccess(host);
    const playerLevel = ns.getHackingLevel();
    const requiredLevel = ns.getServerRequiredHackingLevel(host);
    const maxMoney = ns.getServerMaxMoney(host);
    const money = ns.getServerMoneyAvailable(host);
    const minSecurity = ns.getServerMinSecurityLevel(host);
    const security = ns.getServerSecurityLevel(host);
    const maxRam = ns.getServerMaxRam(host);
    const usedRam = root ? ns.getServerUsedRam(host) : 0;
    const freeRam = root ? Math.max(0, maxRam - usedRam) : 0;
    const moneyRatio = maxMoney > 0 ? money / maxMoney : 0;
    const securityDelta = Math.max(0, security - minSecurity);

    let state = "INACCESSIBLE";
    let reason = "Acces root manquant";

    if (root && playerLevel < requiredLevel) {
        reason = "Niveau de hacking insuffisant";
    } else if (root && maxMoney <= 0) {
        state = "NON_FINANCIERE";
        reason = "Aucun argent exploitable";
    } else if (root && securityDelta > settings.securityTolerance) {
        state = "A_AFFAIBLIR";
        reason = "Securite au-dessus du seuil";
    } else if (root && moneyRatio < settings.moneyReadyRatio) {
        state = "A_RECONSTITUER";
        reason = "Reserve financiere insuffisante";
    } else if (root) {
        state = "EXPLOITABLE";
        reason = "Conditions de preparation satisfaites";
    }

    let chance = 0;
    let hackTime = 0;
    let fractionPerThread = 0;
    let estimatedDollarsPerSecond = 0;

    // Mesures utiles seulement pour les cibles hackables.
    if (root && playerLevel >= requiredLevel && maxMoney > 0) {
        chance = Math.max(0, Math.min(1, finite(ns.hackAnalyzeChance(host))));
        hackTime = Math.max(0, finite(ns.getHackTime(host)));
        fractionPerThread = Math.max(0, finite(ns.hackAnalyze(host)));

        // Estimation volontairement simple a 1 thread, au niveau actuel.
        // N'inclut pas les couts de grow/weaken ni les effets de concurrence.
        const share = Math.min(
            settings.maximumHackFraction,
            fractionPerThread,
            1
        );
        estimatedDollarsPerSecond = hackTime > 0
            ? money * share * chance / (hackTime / 1000)
            : 0;
    }

    return {
        host, root, requiredLevel, playerLevel,
        maxRam, usedRam, freeRam,
        money, maxMoney, moneyRatio,
        security, minSecurity, securityDelta,
        chance, hackTime, fractionPerThread,
        estimatedDollarsPerSecond,
        state, reason
    };
}

export function analyzeNetwork(ns, start = "home") {
    const hosts = discoverNetwork(ns, start);
    const targets = hosts.map(host => inspectTarget(ns, host));
    const executionHosts = targets.filter(
        item => item.root && item.freeRam > 0
    ).sort((a, b) => b.freeRam - a.freeRam);

    const priority = {
        EXPLOITABLE: 0,
        A_RECONSTITUER: 1,
        A_AFFAIBLIR: 2,
        INACCESSIBLE: 3,
        NON_FINANCIERE: 4
    };

    targets.sort((a, b) =>
        priority[a.state] - priority[b.state] ||
        b.estimatedDollarsPerSecond - a.estimatedDollarsPerSecond ||
        a.host.localeCompare(b.host)
    );

    return { targets, executionHosts };
}

export async function main(ns) {
    ns.disableLog("ALL");
    const { targets, executionHosts } = analyzeNetwork(ns);

    ns.tprint("NEXUS TARGETING V1 - ANALYSE EN LECTURE SEULE");
    ns.tprint(
        `Serveurs: ${targets.length} | Hosts RAM disponibles: ${executionHosts.length}`
    );

    const money = value => ns.format.number(value, 2);
    for (const t of targets) {
        ns.tprint(
            `[${t.state}] ${t.host} | $ ${money(t.money)}/${money(t.maxMoney)}` +
            ` | sec +${t.securityDelta.toFixed(2)}` +
            ` | chance ${(t.chance * 100).toFixed(1)}%` +
            ` | estim. $/s/thread ${money(t.estimatedDollarsPerSecond)}` +
            ` | RAM libre ${t.freeRam.toFixed(1)} GB`
        );
    }

    ns.tprint(
        "INFO: estimations heuristiques, aucun hack/grow/weaken/deploiement effectue."
    );
}
