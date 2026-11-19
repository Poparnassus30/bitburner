/** @param {NS} ns
 * NEXUS SCHEDULER V1 - simulation seule, sans actions sur le jeu.
 *
 * Ce plan exploite uniquement la RAM libre mesuree au moment de l'analyse.
 * Les scripts existants ne sont jamais consideres comme recuperables.
 */
import { analyzeNetwork } from "/nexus/core/targeting.js";
import { CONFIG } from "/nexus/config/config.js";
import { WORKERS } from "/nexus/config/workers.js";

export const VERSION = 1;

export function planOperations(ns, options = {}) {
    const { targets, executionHosts } = analyzeNetwork(ns);
    const candidates = targets.filter(t =>
        t.root &&
        t.maxMoney > 0 &&
        t.playerLevel >= t.requiredLevel &&
        Number.isFinite(t.estimatedDollarsPerSecond) &&
        t.estimatedDollarsPerSecond > 0
    );

    // Classement heuristique. La preparation recoit une penalite
    // provisoire; le rendement net reel necessitera des mesures.
    const penalty = {
        EXPLOITABLE: 1,
        A_RECONSTITUER: 0.65,
        A_AFFAIBLIR: 0.45
    };

    const ranked = candidates.map(t => ({
        ...t,
        operation: t.state === "A_AFFAIBLIR" ? "WEAKEN"
            : t.state === "A_RECONSTITUER" ? "GROW"
            : "HACK",
        score: t.estimatedDollarsPerSecond * (penalty[t.state] ?? 0)
    })).filter(t => t.score > 0)
        .sort((a, b) => b.score - a.score ||
            a.host.localeCompare(b.host));

    const worker = WORKERS.find(w => w.enabled);
    const script = worker?.file ?? null;
    const scriptRam = script
        ? ns.getScriptRam(script, CONFIG.source)
        : 0;

    const placements = [];
    const reserveHome = options.reserveHome ?? CONFIG.reserveHome;
    const maxTargets = Math.max(1, Math.floor(options.maxTargets ?? 3));
    const selected = ranked.slice(0, maxTargets);

    let availableRam = 0;
    let allocatedRam = 0;
    let totalThreads = 0;

    for (const host of executionHosts) {
        const reserve = host.host === CONFIG.source ? reserveHome : 0;
        const free = Math.max(0, host.freeRam - reserve);
        availableRam += free;

        if (!scriptRam || scriptRam <= 0 || !selected.length) continue;

        const threads = Math.floor((free + 1e-9) / scriptRam);
        if (threads < 1) continue;

        // Plan simple par host : chaque host vise une seule cible.
        // On alterne entre les meilleurs candidats pour visualiser
        // la repartition; ce n'est PAS encore un batch HGW.
        const target = selected[placements.length % selected.length];
        placements.push({
            host: host.host,
            target: target.host,
            operation: target.operation,
            threads,
            ram: threads * scriptRam,
            score: target.score
        });
        totalThreads += threads;
        allocatedRam += threads * scriptRam;
    }

    return {
        mode: "SIMULATION",
        script,
        scriptRam,
        availableRam,
        allocatedRam,
        totalThreads,
        candidates: ranked,
        placements,
        note: "Threads = capacite theorique en equivalents du worker actuel; " +
            "pas une reservation ni un plan HGW execute."
    };
}

export async function main(ns) {
    ns.disableLog("ALL");
    const plan = planOperations(ns);
    ns.tprint("NEXUS SCHEDULER V1 - SIMULATION / AUCUNE EXECUTION");
    ns.tprint(
        `RAM libre apres reserve: ${plan.availableRam.toFixed(1)} GB | ` +
        `RAM planifiee: ${plan.allocatedRam.toFixed(1)} GB | ` +
        `Threads equivalents: ${plan.totalThreads}`
    );
    for (const item of plan.placements) {
        ns.tprint(
            `${item.host}: ${item.threads} threads -> ` +
            `${item.operation} ${item.target}`
        );
    }
    ns.tprint(plan.note);
}
