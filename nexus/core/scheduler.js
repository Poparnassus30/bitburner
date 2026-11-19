/** @param {NS} ns
 * NEXUS SCHEDULER V2 - estimation des preparations et simulation de RAM.
 * Aucune instruction hack/grow/weaken, scp, exec ou kill ici.
 */
import { analyzeNetwork, TARGETING } from "/nexus/core/targeting.js";
import { CONFIG } from "/nexus/config/config.js";

export const VERSION = 2;

// Cout theorique des scripts mono-operation standard (GB / thread).
// A confirmer quand les vrais workers seront crees et mesures.
export const OPERATION_RAM = Object.freeze({
    HACK: 1.70,
    GROW: 1.75,
    WEAKEN: 1.75
});

const safe = (value, fallback = 0) =>
    Number.isFinite(value) && value >= 0 ? value : fallback;

const threadsNeeded = (amount, effect) =>
    amount <= 0 ? 0 :
        effect > 0 ? Math.ceil(amount / effect) : Infinity;

export function estimatePreparation(ns, target, options = {}) {
    const securityTolerance = options.securityTolerance ??
        TARGETING.securityTolerance;
    const readyRatio = options.moneyReadyRatio ??
        TARGETING.moneyReadyRatio;
    const hackFraction = options.hackFraction ?? 0.10;
    const weakenEffect = safe(ns.weakenAnalyze(1, 1));
    const desiredMoney = target.maxMoney * readyRatio;
    const securityToRemove = Math.max(
        0, target.security - (target.minSecurity + securityTolerance)
    );

    const weakenInitial = threadsNeeded(securityToRemove, weakenEffect);
    const multiplier = desiredMoney > 0
        ? desiredMoney / Math.max(1, target.money)
        : 1;
    let growThreads = 0;
    if (multiplier > 1) {
        const raw = ns.growthAnalyze(target.host, multiplier, 1);
        growThreads = Number.isFinite(raw) && raw >= 0
            ? Math.ceil(raw)
            : Infinity;
    }

    // Chaque grow augmente la securite ; l'ajout doit etre affaibli.
    const growSecurity = Number.isFinite(growThreads)
        ? safe(ns.growthAnalyzeSecurity(growThreads, target.host, 1))
        : Infinity;
    const weakenAfterGrow = threadsNeeded(growSecurity, weakenEffect);

    // Ne pas promettre de hack reel sur une cible non prete.
    const hackThreads = target.state === "EXPLOITABLE" &&
        target.fractionPerThread > 0
        ? Math.max(1, Math.floor(hackFraction / target.fractionPerThread))
        : 0;

    const prepThreads = weakenInitial + growThreads + weakenAfterGrow;
    const prepRam = (weakenInitial + weakenAfterGrow) * OPERATION_RAM.WEAKEN +
        growThreads * OPERATION_RAM.GROW;
    const prepTimeMs = Math.max(
        weakenInitial + weakenAfterGrow > 0 ? safe(ns.getWeakenTime(target.host)) : 0,
        growThreads > 0 ? safe(ns.getGrowTime(target.host)) : 0
    );
    const hackTimeMs = safe(target.hackTime);

    // Score indicatif : gain theorique d'UN thread / duree totale de
    // preparation + hack. Penalisation du cout de preparation en RAM.
    // Ce n'est PAS un rendement net de batch.
    const denominator = Math.max(1, (prepTimeMs + hackTimeMs) / 1000);
    const score = target.estimatedDollarsPerSecond > 0
        ? target.estimatedDollarsPerSecond * (hackTimeMs / 1000) /
            denominator / (1 + prepRam / 64)
        : 0;

    return {
        host: target.host,
        state: target.state,
        weakenInitial, growThreads, weakenAfterGrow, hackThreads,
        prepThreads, prepRam, prepTimeMs, hackTimeMs,
        score: safe(score),
        finite: Number.isFinite(prepRam) && Number.isFinite(prepThreads)
    };
}

/**
 * Simule une allocation sur la RAM ACTUELLEMENT libre.
 * On n'ecrase jamais les processus existants, et on conserve la
 * reserve de home. Les placements sont une capacite theorique :
 * les vrais workers mono-operation n'existent pas encore.
 */
export function planOperations(ns, options = {}) {
    const { targets, executionHosts } = analyzeNetwork(ns);
    const reserveHome = options.reserveHome ?? CONFIG.reserveHome;
    const maxTargets = Math.max(1, Math.floor(options.maxTargets ?? 3));

    const pool = executionHosts.map(host => ({
        host: host.host,
        freeRam: Math.max(
            0, host.freeRam - (host.host === CONFIG.source ? reserveHome : 0)
        )
    })).filter(host => host.freeRam > 0)
        .sort((a, b) => b.freeRam - a.freeRam);

    const availableRam = pool.reduce((sum, h) => sum + h.freeRam, 0);
    const candidates = targets.filter(t =>
        t.root && t.maxMoney > 0 &&
        t.playerLevel >= t.requiredLevel &&
        t.estimatedDollarsPerSecond > 0
    ).map(t => estimatePreparation(ns, t, options))
        .filter(p => p.finite)
        .sort((a, b) => b.score - a.score ||
            a.host.localeCompare(b.host));

    const selected = candidates.slice(0, maxTargets);
    const placements = [];
    const targetsPlan = [];
    let allocatedRam = 0;
    let totalThreads = 0;

    for (const target of selected) {
        // L'ordre est intentionnel : affaiblir, reconstituer, compenser.
        const stages = [
            ["WEAKEN", target.weakenInitial],
            ["GROW", target.growThreads],
            ["WEAKEN", target.weakenAfterGrow]
        ];
        const assigned = { WEAKEN: 0, GROW: 0 };
        let remainingTotal = 0;

        for (const [operation, required] of stages) {
            let remaining = required;
            const cost = OPERATION_RAM[operation];
            for (const host of pool) {
                if (remaining <= 0) break;
                const possible = Math.floor((host.freeRam + 1e-9) / cost);
                const threads = Math.min(remaining, possible);
                if (threads < 1) continue;
                const ram = threads * cost;
                host.freeRam = Math.max(0, host.freeRam - ram);
                placements.push({
                    host: host.host,
                    target: target.host,
                    operation, threads, ram
                });
                assigned[operation] += threads;
                allocatedRam += ram;
                totalThreads += threads;
                remaining -= threads;
            }
            remainingTotal += remaining;
        }
        targetsPlan.push({
            ...target,
            assigned,
            remainingThreads: remainingTotal,
            complete: remainingTotal === 0
        });
    }

    return {
        mode: "SIMULATION",
        availableRam, allocatedRam, totalThreads,
        candidates, targetsPlan, placements,
        note: "Couts RAM theoriques (H 1.70 / G 1.75 / W 1.75 GB). " +
            "Preparation seulement; pas de hack planifie ni d'execution."
    };
}

export async function main(ns) {
    ns.disableLog("ALL");
    const plan = planOperations(ns);
    ns.tprint("NEXUS SCHEDULER V2 - SIMULATION / AUCUNE EXECUTION");
    ns.tprint(
        `RAM libre: ${plan.availableRam.toFixed(1)} GB | ` +
        `RAM affectee: ${plan.allocatedRam.toFixed(1)} GB | ` +
        `Threads: ${plan.totalThreads}`
    );
    for (const target of plan.targetsPlan) {
        ns.tprint(
            `${target.host} [${target.state}] | ` +
            `W:${target.weakenInitial} G:${target.growThreads} ` +
            `W+:${target.weakenAfterGrow} | ` +
            `Restant: ${target.remainingThreads} | ` +
            `score: ${target.score.toFixed(2)}`
        );
    }
    for (const item of plan.placements) {
        ns.tprint(
            `${item.host} -> ${item.target}: ${item.operation} ` +
            `${item.threads} threads (${item.ram.toFixed(1)} GB)`
        );
    }
    ns.tprint(plan.note);
}
