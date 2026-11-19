
/** @param {NS} ns */
import {
    normalizePath
} from "/nexus/core/processes.js";

import { CONFIG } from "/nexus/config/config.js";
import { WORKERS } from "/nexus/config/workers.js";
import { inspectTarget } from "/nexus/core/targeting.js";
import { planOperations } from "/nexus/core/scheduler.js";

import {
    discoverNetwork
} from "/nexus/core/network.js";

import {
    getSourceVersion
} from "/nexus/services/versions.js";

import {
    getExecutionVersion
} from "/nexus/core/processes.js";

import {
    loadRegistry,
    getDeployment
} from "/nexus/services/registry.js";

export const VERSION = 9;

export async function main(ns) {
    ns.disableLog("ALL");

    ns.ui.openTail();
    ns.ui.setTailTitle("NEXUS - MASTER CONTROL");
    ns.ui.resizeTail(1450, 750);

    const REFRESH = 2000;

    // ==========================================
    // OUTILS
    // ==========================================

    const left = (v, n) =>
        String(v).slice(0, n).padEnd(n);

    const right = (v, n) =>
        String(v).padStart(n);

    const fmt = v => ns.format.number(v, 2);
    const ram = v => v.toFixed(1);
    const line = () => "-".repeat(125);

    const pct = (a, b) =>
        b > 0
            ? (a / b * 100).toFixed(0) + "%"
            : "—";

    const version = v =>
        v === null || v === undefined
            ? "?"
            : "V" + v;

    // ==========================================
    // BOUCLE PRINCIPALE
    // ==========================================

    while (true) {
        const discovered = discoverNetwork(ns);
        const registry = loadRegistry(
            ns, CONFIG.registry
        );

        const servers = [];
        const processes = [];
        const financial = [];
        const targetAnalysis = [];

        const targets = new Set();
        const targetThreads = new Map();

        let rootCount = 0;
        let totalRam = 0;
        let usedRam = 0;
        let totalThreads = 0;
        let workerThreads = 0;

        let updated = 0;
        let outdated = 0;
        let unknown = 0;

        // ======================================
        // INVENTAIRE SERVEURS / PROCESSUS
        // ======================================

        for (const host of discovered) {
            const root = ns.hasRootAccess(host);
            const maxRam = ns.getServerMaxRam(host);

            if (!root) {
                servers.push({
                    host,
                    root: false,
                    maxRam,
                    used: 0,
                    count: 0,
                    threads: 0
                });
                continue;
            }

            rootCount++;

            const used = ns.getServerUsedRam(host);
            const scripts = ns.ps(host);
            const threads = scripts.reduce(
                (sum, p) => sum + p.threads, 0
            );

            totalRam += maxRam;
            usedRam += used;
            totalThreads += threads;

            servers.push({
                host,
                root: true,
                maxRam,
                used,
                count: scripts.length,
                threads
            });

            for (const p of scripts) {
                const worker = WORKERS.find(
                    w => normalizePath(w.file) ===
                    normalizePath(p.filename)
                );

                const managed = Boolean(worker);

                const target = managed
                    ? String(p.args[0] ?? worker.target)
                    : "—";

                if (managed) {
                    targets.add(target);
                    workerThreads += p.threads;
                    targetThreads.set(
                        target,
                        (targetThreads.get(target) ?? 0) +
                        p.threads
                    );
                }

                let sourceVersion = null;
                let hostVersion = null;
                let execVersion = null;
                let status = "—";

                if (managed) {
                    sourceVersion = getSourceVersion(
                        ns, worker.file
                    );

                    const deployment = getDeployment(
                        registry, host, worker.file
                    );

                    // Sur home, le fichier local est
                    // directement lisible.
                    hostVersion = host === "home"
                        ? sourceVersion
                        : deployment?.hostVersion ?? null;

                    execVersion = getExecutionVersion(
                        ns, p.pid
                    );

                    // Le registre peut donner une
                    // information complémentaire pour
                    // un processus lancé par MASTER.
                    if (execVersion === null) {
                        const record =
                            deployment?.processes?.find(
                                entry => entry.pid === p.pid
                            );

                        execVersion =
                            record?.version ?? null;
                    }

                    if (
                        sourceVersion === null ||
                        hostVersion === null ||
                        execVersion === null
                    ) {
                        status = "INCONNU";
                        unknown++;

                    } else if (
                        hostVersion > sourceVersion ||
                        execVersion > sourceVersion
                    ) {
                        status = "ANOMALIE";
                        unknown++;

                    } else if (
                        hostVersion < sourceVersion
                    ) {
                        status = "DEPLOYER";
                        outdated++;

                    } else if (
                        execVersion < sourceVersion
                    ) {
                        status = "REDEMARRER";
                        outdated++;

                    } else {
                        status = "A JOUR";
                        updated++;
                    }
                }

                processes.push({
                    host,
                    pid: p.pid,
                    file: p.filename,
                    target,
                    threads: p.threads,
                    usedRam:
                        ns.getScriptRam(p.filename, host) *
                        p.threads,
                    managed,
                    sourceVersion,
                    hostVersion,
                    execVersion,
                    status
                });
            }
        }

        // ======================================
        // ANALYSE FINANCIERE
        // ======================================

        for (const host of discovered) {
            const maxMoney = ns.getServerMaxMoney(host);
            if (maxMoney <= 0) continue;

            const money = ns.getServerMoneyAvailable(host);
            const root = ns.hasRootAccess(host);
            const required =
                ns.getServerRequiredHackingLevel(host);

            const chance =
                root && ns.getHackingLevel() >= required
                    ? ns.hackAnalyzeChance(host) * 100
                    : 0;

            financial.push({
                host,
                money,
                maxMoney,
                security: ns.getServerSecurityLevel(host),
                required,
                chance,
                root,
                threads: targetThreads.get(host) ?? 0
            });
        }

        // ======================================
        // TARGETING (ANALYSE SEULE)
        // ======================================

        for (const host of discovered) {
            try {
                targetAnalysis.push(inspectTarget(ns, host));
            } catch (error) {
                ns.print(
                    `TARGETING ERROR ${host}: ${String(error)}`
                );
            }
        }

        const targetPriority = {
            EXPLOITABLE: 0,
            A_RECONSTITUER: 1,
            A_AFFAIBLIR: 2,
            INACCESSIBLE: 3,
            NON_FINANCIERE: 4
        };

        targetAnalysis.sort((a, b) =>
            (targetPriority[a.state] ?? 99) -
                (targetPriority[b.state] ?? 99) ||
            b.estimatedDollarsPerSecond -
                a.estimatedDollarsPerSecond ||
            a.host.localeCompare(b.host)
        );

        // ======================================
        // TRI
        // ======================================

        servers.sort((a, b) =>
            Number(b.root) - Number(a.root) ||
            a.host.localeCompare(b.host)
        );

        processes.sort((a, b) =>
            a.host.localeCompare(b.host) ||
            a.file.localeCompare(b.file) ||
            a.pid - b.pid
        );

        financial.sort(
            (a, b) => b.maxMoney - a.maxMoney
        );

        // ======================================
        // AFFICHAGE
        // ======================================

        const out = [];

        out.push("NEXUS - MASTER CONTROL V9");
        out.push("=".repeat(125));
        out.push("");

        // 01 - GENERAL

        out.push("01 - GENERAL");
        out.push(line());
        const masterRunning = ns.ps("home").some(
            p => p.filename.replace(/^\/+/, "") === "nexus/master.js"
        );

        const mode = !masterRunning
            ? "MASTER ARRETE"
            : CONFIG.dryRun
                ? "SIMULATION"
                : "DEPLOIEMENT ACTIF";

        out.push(`NEXUS MASTER : ${mode}`);
        out.push("");

        out.push(
            `Hacking: ${ns.getHackingLevel()}` +
            `   Argent: $${fmt(
                ns.getServerMoneyAvailable("home")
            )}` +
            `   Root: ${rootCount}/${discovered.length}`
        );

        out.push(
            `Processus: ${processes.length}` +
            `   Threads: ${totalThreads}` +
            `   Workers threads: ${workerThreads}` +
            `   Cibles: ${targets.size}`
        );

        out.push(
            `RAM: ${ram(usedRam)}/${ram(totalRam)} GB` +
            `   Occupation: ${pct(usedRam, totalRam)}`
        );

        out.push(
            `Versions: ${updated} a jour | ` +
            `${outdated} a modifier | ` +
            `${unknown} inconnus`
        );

        out.push("");

        // 02 - SERVEURS

        out.push("02 - SERVEURS");
        out.push(line());

        out.push(
            left("SERVEUR", 25) +
            right("ROOT", 7) +
            right("RAM MAX", 12) +
            right("RAM UTIL.", 12) +
            right("RAM LIBRE", 12) +
            right("OCCUP.", 10) +
            right("PROC.", 9) +
            right("THR.", 8)
        );

        out.push(line());

        for (const s of servers) {
            const free = Math.max(
                0, s.maxRam - s.used
            );

            out.push(
                left(s.host, 25) +
                right(s.root ? "YES" : "NO", 7) +
                right(ram(s.maxRam), 12) +
                right(s.root ? ram(s.used) : "—", 12) +
                right(s.root ? ram(free) : "—", 12) +
                right(s.root
                    ? pct(s.used, s.maxRam)
                    : "—", 10) +
                right(s.root ? s.count : "—", 9) +
                right(s.root ? s.threads : "—", 8)
            );
        }

        out.push("");

        // 03 - PROCESSUS

        out.push("03 - PROCESSUS");
        out.push(line());

        out.push(
            left("SERVEUR", 19) +
            right("PID", 6) + " " +
            left("PROGRAMME", 27) +
            left("CIBLE", 17) +
            right("THR", 5) +
            right("RAM", 8) +
            right("V.SOURCE", 10) +
            right("V.HOTE", 9) +
            right("V.EXEC", 9) +
            right("ETAT", 13)
        );

        out.push(line());

        for (const p of processes) {
            out.push(
                left(p.host, 19) +
                right(p.pid, 6) + " " +
                left(p.file, 27) +
                left(p.target, 17) +
                right(p.threads, 5) +
                right(ram(p.usedRam), 8) +
                right(
                    p.managed
                        ? version(p.sourceVersion)
                        : "—", 10
                ) +
                right(
                    p.managed
                        ? version(p.hostVersion)
                        : "—", 9
                ) +
                right(
                    p.managed
                        ? version(p.execVersion)
                        : "—", 9
                ) +
                right(p.status, 13)
            );
        }

        out.push("");

        // 04 - FINANCES / CIBLES

        out.push("04 - FINANCES / CIBLES");
        out.push(line());

        out.push(
            left("SERVEUR", 23) +
            right("ACTUEL", 13) +
            right("MAXIMUM", 13) +
            right("REMPL.", 10) +
            right("SEC.", 9) +
            right("LVL", 7) +
            right("CHANCE", 10) +
            right("THR.", 7) +
            right("ROOT", 7)
        );

        out.push(line());

        for (const f of financial) {
            out.push(
                left(f.host, 23) +
                right("$" + fmt(f.money), 13) +
                right("$" + fmt(f.maxMoney), 13) +
                right(pct(f.money, f.maxMoney), 10) +
                right(f.security.toFixed(2), 9) +
                right(f.required, 7) +
                right(f.chance.toFixed(0) + "%", 10) +
                right(f.threads, 7) +
                right(f.root ? "YES" : "NO", 7)
            );
        }

        out.push("");
        out.push(line());
        // 05 - TARGETING / ANALYSE STRATEGIQUE

        out.push("");
        out.push("05 - TARGETING / ANALYSE STRATEGIQUE (LECTURE SEULE)");
        out.push(line());

        const exploitable = targetAnalysis.filter(
            t => t.state === "EXPLOITABLE"
        ).length;
        const preparation = targetAnalysis.filter(
            t => t.state === "A_RECONSTITUER" ||
                 t.state === "A_AFFAIBLIR"
        ).length;
        const ramHosts = targetAnalysis.filter(
            t => t.root && t.freeRam > 0
        ).length;

        out.push(
            `Cibles exploitables: ${exploitable} | ` +
            `A preparer: ${preparation} | ` +
            `Hosts avec RAM libre: ${ramHosts}`
        );
        out.push(
            "Estimation $/s/thread: heuristique instantanee, " +
            "hors couts grow/weaken."
        );
        out.push("");

        out.push(
            left("CIBLE", 23) +
            left("ETAT", 18) +
            right("ARGENT", 14) +
            right("MAX", 14) +
            right("SEC.+", 9) +
            right("CHANCE", 9) +
            right("TEMPS", 10) +
            right("EST.$/S", 14)
        );
        out.push(line());

        const financialTargets = targetAnalysis.filter(
            t => t.maxMoney > 0
        );
        const visibleTargets = financialTargets.slice(0, 15);

        for (const t of visibleTargets) {
            out.push(
                left(t.host, 23) +
                left(t.state, 18) +
                right("$" + fmt(t.money), 14) +
                right("$" + fmt(t.maxMoney), 14) +
                right(t.securityDelta.toFixed(2), 9) +
                right((t.chance * 100).toFixed(1) + "%", 9) +
                right(t.hackTime > 0
                    ? (t.hackTime / 1000).toFixed(1) + "s"
                    : "—", 10) +
                right("$" + fmt(t.estimatedDollarsPerSecond), 14)
            );
        }

        if (visibleTargets.length === 0) {
            out.push("Aucune cible financiere detectee.");
        }
        if (financialTargets.length > 15) {
            out.push("Affichage limite aux 15 premieres cibles.");
        }

        out.push("");
        out.push(line());
        // 06 - SCHEDULER V3 / PLANIFICATION PAR CYCLE

        out.push("");
        out.push("06 - SCHEDULER V3 / PROCHAIN CYCLE (SIMULATION)");
        out.push(line());

        try {
            const plan = planOperations(ns);
            out.push(
                `RAM libre apres reserve: ${ram(plan.availableRam)} GB | ` +
                `RAM affectee virtuellement: ${ram(plan.allocatedRam)} GB | ` +
                `Threads: ${plan.totalThreads}`
            );
            out.push("W=weaken G=grow W+=compensatoire | PRIORITE V3");
            out.push("");
            out.push(
                left("CIBLE", 23) +
                left("ETAT", 18) +
                right("W", 8) +
                right("G", 8) +
                right("W+", 8) +
                right("PREP GB", 12) +
                right("TOTAL", 9) +
                right("PRIORITE", 12)
            );
            out.push(line());
            for (const target of plan.candidates.slice(0, 10)) {
                out.push(
                    left(target.host, 23) +
                    left(target.state, 18) +
                    right(target.weakenInitial, 8) +
                    right(target.growThreads, 8) +
                    right(target.weakenAfterGrow, 8) +
                    right(ram(target.prepRam), 12) +
                    right(target.totalThreads, 9) +
                    right(target.priority.toFixed(2), 12)
                );
            }
            if (!plan.candidates.length) {
                out.push("Aucune cible eligible pour cette simulation.");
            }
            out.push("");
            out.push(
                left("HOST", 23) +
                left("OP.", 10) +
                left("CIBLE", 23) +
                right("THR", 7) +
                right("RAM GB", 12)
            );
            out.push(line());
            for (const item of plan.placements.slice(0, 20)) {
                out.push(
                    left(item.host, 23) +
                    left(item.operation, 10) +
                    left(item.target, 23) +
                    right(item.threads, 7) +
                    right(ram(item.ram), 12)
                );
            }
            if (plan.placements.length > 20) {
                out.push("Affichage des 20 premieres affectations.");
            }
            out.push("");
            out.push(plan.chosen ? ('PROCHAIN CYCLE: ' + plan.stage.operation + ' ' + plan.chosen.host + ' | ' + plan.totalThreads + '/' + plan.stage.threads + ' threads') : 'Aucune cible disponible.');
            out.push(plan.note);
            out.push(
                "Simulation basee sur la RAM libre: aucune instance existante arretee."
            );
        } catch (error) {
            out.push(`ERREUR PLANIFICATION V3: ${String(error)}`);
        }

        out.push("");
        out.push(line());
        out.push("V.SOURCE = Version de reference sur home");
        out.push("V.HOTE   = Version declaree du fichier hote");
        out.push("V.EXEC   = Version du processus actif");
        out.push("? = Version inconnue");
        out.push("TARGETING = Analyse seulement. Aucune commande envoyee aux workers.");
        out.push("Actualisation : 2 secondes");

        ns.clearLog();
        ns.print(out.join("\n"));

        await ns.sleep(REFRESH);
    }
}
