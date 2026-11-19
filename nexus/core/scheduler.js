/** @param {NS} ns
 * NEXUS SCHEDULER V3 - planification temporelle en lecture seule.
 * Un seul cycle et une seule phase de preparation sont proposes a la fois.
 * Aucun exec, kill, scp, hack, grow ou weaken n'est lance.
 */
import { analyzeNetwork, TARGETING } from "/nexus/core/targeting.js";
import { CONFIG } from "/nexus/config/config.js";

export const VERSION = 3;

// Cout theorique pour de futurs workers mono-operation.
// Remplacer par getScriptRam() lorsque ces workers existeront.
export const OPERATION_RAM = Object.freeze({
    HACK: 1.70, GROW: 1.75, WEAKEN: 1.75
});

const valid = (v, fallback = 0) =>
    Number.isFinite(v) && v >= 0 ? v : fallback;

function requiredThreads(amount, effect) {
    if (amount <= 0) return 0;
    return effect > 0 ? Math.ceil(amount / effect) : Infinity;
}

function activeTargets(ns, executionHosts) {
    const active = new Map();
    for (const machine of executionHosts) {
        for (const p of ns.ps(machine.host)) {
            // Reconnaissance du worker existant, sans le modifier.
            const file = String(p.filename).replace(/^\/+/, "");
            if (file !== "nexus/workers/hack.js") continue;
            const target = String(p.args?.[0] ?? "n00dles");
            active.set(target, (active.get(target) ?? 0) + p.threads);
        }
    }
    return active;
}

export function estimatePreparation(ns, target, options = {}) {
    const tolerance = options.securityTolerance ?? TARGETING.securityTolerance;
    const ratio = options.moneyReadyRatio ?? TARGETING.moneyReadyRatio;
    const minSecurity = target.minSecurity;
    const weakenEffect = valid(ns.weakenAnalyze(1, 1));
    const securityExcess = Math.max(0, target.security - minSecurity - tolerance);
    const weakenInitial = requiredThreads(securityExcess, weakenEffect);
    const desired = ratio * target.maxMoney;
    const multiplier = desired / Math.max(1, target.money);
    const growRaw = multiplier > 1
        ? ns.growthAnalyze(target.host, multiplier, 1) : 0;
    const growThreads = Number.isFinite(growRaw) && growRaw >= 0
        ? Math.ceil(growRaw) : Infinity;
    const growSecurity = Number.isFinite(growThreads)
        ? valid(ns.growthAnalyzeSecurity(growThreads, target.host, 1))
        : Infinity;
    const weakenAfterGrow = requiredThreads(growSecurity, weakenEffect);

    // Les phases sont successives : pas de compensation fictive simultanee.
    const stages = [
        { operation: "WEAKEN", threads: weakenInitial,
            durationMs: valid(ns.getWeakenTime(target.host)), label: "securite" },
        { operation: "GROW", threads: growThreads,
            durationMs: valid(ns.getGrowTime(target.host)), label: "argent" },
        { operation: "WEAKEN", threads: weakenAfterGrow,
            durationMs: valid(ns.getWeakenTime(target.host)), label: "compensation" }
    ];
    const prepRam = (weakenInitial + weakenAfterGrow) * OPERATION_RAM.WEAKEN +
        growThreads * OPERATION_RAM.GROW;
    return {
        host: target.host, state: target.state,
        money: target.money, maxMoney: target.maxMoney,
        scoreBase: target.estimatedDollarsPerSecond,
        stages, weakenInitial, growThreads, weakenAfterGrow, prepRam,
        valid: Number.isFinite(prepRam) && stages.every(
            s => Number.isFinite(s.threads) && s.durationMs > 0
        )
    };
}

/**
 * Recommandation instantanee, recalculable a chaque rafraichissement.
 * Ne simule pas une evolution fictive du solde/securite sur 100 cycles.
 */
export function planOperations(ns, options = {}) {
    const { targets, executionHosts } = analyzeNetwork(ns);
    const reserveHome = options.reserveHome ?? CONFIG.reserveHome;
    const active = activeTargets(ns, executionHosts);
    const pool = executionHosts.map(h => ({
        host: h.host,
        freeRam: Math.max(0, h.freeRam -
            (h.host === CONFIG.source ? reserveHome : 0))
    })).filter(h => h.freeRam > 0).sort(
        (a, b) => b.freeRam - a.freeRam || a.host.localeCompare(b.host)
    );
    const availableRam = pool.reduce((sum, h) => sum + h.freeRam, 0);
    const capacity = pool.reduce((sum, h) =>
        sum + Math.floor((h.freeRam + 1e-9) / OPERATION_RAM.WEAKEN), 0);

    const candidates = targets.filter(t =>
        t.root && t.maxMoney > 0 &&
        t.playerLevel >= t.requiredLevel &&
        t.estimatedDollarsPerSecond > 0
    ).map(t => {
        const prep = estimatePreparation(ns, t, options);
        const existingThreads = active.get(t.host) ?? 0;
        const totalThreads = prep.stages.reduce((s, p) => s + p.threads, 0);
        // Borne theorique basse sur le nombre de vagues de preparation.
        // Le vrai temps depend de la dynamique du serveur apres chaque vague.
        const waves = capacity > 0 ? Math.ceil(totalThreads / capacity) : Infinity;
        const weightedDuration = prep.stages.reduce((sum, s) => {
            const cycles = capacity > 0 ? Math.ceil(s.threads / capacity) : Infinity;
            return sum + cycles * s.durationMs;
        }, 0);
        // Heuristique de priorite : cout temporel de preparation et nombre
        // de vagues penalises. Ne pas appeler ce chiffre du profit net.
        const preparationSeconds = weightedDuration / 1000;
        const priority = prep.scoreBase /
            (1 + preparationSeconds / 60);
        return {
            ...prep, existingThreads, waves, preparationSeconds,
            priority: valid(priority), totalThreads
        };
    }).filter(t => t.valid).sort((a, b) =>
        b.priority - a.priority || a.host.localeCompare(b.host));

    // Un worker autonome vise deja cette cible : eviter des simulations
    // contradictoires sans connaissance de ses operations en cours.
    const eligible = candidates.filter(t => t.existingThreads === 0);
    const chosen = eligible.find(t => t.stages.some(s => s.threads > 0)) ?? null;
    const stage = chosen?.stages.find(s => s.threads > 0) ?? null;

    const placements = [];
    let remaining = stage?.threads ?? 0;
    let allocatedRam = 0;
    let totalThreads = 0;
    if (chosen && stage) {
        for (const h of pool) {
            const cost = OPERATION_RAM[stage.operation];
            const threads = Math.min(remaining, Math.floor((h.freeRam + 1e-9) / cost));
            if (threads < 1) continue;
            const ram = threads * cost;
            placements.push({
                host: h.host, target: chosen.host,
                operation: stage.operation, label: stage.label,
                threads, ram
            });
            remaining -= threads;
            totalThreads += threads;
            allocatedRam += ram;
            if (remaining === 0) break;
        }
    }

    return {
        mode: "SIMULATION", availableRam, allocatedRam, totalThreads,
        candidates, placements, chosen, stage,
        remainingThreads: remaining,
        activeTargets: [...active.entries()].map(([host, threads]) => ({ host, threads })),
        note: "V3 : une seule phase proposee pour ce cycle. Durees et RAM " +
            "indicatives; reevaluer apres chaque operation. Aucun processus modifie."
    };
}

export async function main(ns) {
    ns.disableLog("ALL");
    const plan = planOperations(ns);
    ns.tprint("NEXUS SCHEDULER V3 - SIMULATION");
    ns.tprint(
        `RAM libre apres reserve: ${plan.availableRam.toFixed(1)} Go | ` +
        `RAM simulee: ${plan.allocatedRam.toFixed(1)} Go`
    );
    for (const t of plan.candidates.slice(0, 8)) {
        ns.tprint(
            `${t.host}: W=${t.weakenInitial} G=${t.growThreads} ` +
            `W+=${t.weakenAfterGrow} | cycles min=${t.waves} ` +
            `| preparation ~${Math.round(t.preparationSeconds)}s ` +
            `| actif=${t.existingThreads} thr | priorite=${t.priority.toFixed(2)}`
        );
    }
    if (plan.chosen && plan.stage) {
        ns.tprint(
            `PROCHAIN CYCLE: ${plan.stage.operation} ${plan.chosen.host} ` +
            `(${plan.stage.label}) ${plan.totalThreads}/${plan.stage.threads} threads`
        );
    } else {
        ns.tprint("Aucune phase de preparation libre pour ce cycle.");
    }
    for (const p of plan.placements) {
        ns.tprint(`${p.host} -> ${p.target}: ${p.threads} ${p.operation}`);
    }
    ns.tprint(plan.note);
}
